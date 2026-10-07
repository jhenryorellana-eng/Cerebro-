import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Paquete } from "./tipos.js";

export interface Esperado {
  condados: number;
  tipoCorteIncluye: string;
  edad: number;
  venueIncluye?: string;
  preguntaSedesEn?: string;
  corteDeCondado?: { fips: string; incluye: string };
}

export interface EvaluacionPiloto {
  estado: string;
  aprobado: boolean;
  fallos: string[];
  metricas: { coberturaCondados: number; aristasBajas: number; preguntasAbiertas: number };
}

export function evaluarPiloto(p: Paquete, esperado: Esperado): EvaluacionPiloto {
  const fallos: string[] = [];
  /** Minúsculas y «&» = «and», para comparar nombres de corte sin falsos negativos. */
  const comparable = (s: string): string => s.toLowerCase().replace(/&/g, "and");
  const etiqueta = new Map(p.nodes.map((n) => [n.id, comparable(n.label)]));
  const util = (c: string): boolean => c !== "low";

  const tipoOk = p.edges.some(
    (a) => a.rel === "route_filed_in" && util(a.confidence) && (etiqueta.get(a.to) ?? "").includes(comparable(esperado.tipoCorteIncluye)),
  );
  if (!tipoOk) fallos.push(`No hay vía que se presente en «${esperado.tipoCorteIncluye}» con confianza media o alta`);

  const edadOk = p.edges.some((a) => a.rel === "allows_route" && util(a.confidence) && a.attrs.ageLimitExclusive === esperado.edad);
  if (!edadOk) fallos.push(`No hay vía con edad límite ${esperado.edad} y confianza media o alta`);

  if (esperado.venueIncluye) {
    const venue = comparable(esperado.venueIncluye);
    const venueOk = p.edges.some(
      (a) => a.rel === "allows_route" && util(a.confidence) && comparable(String(a.attrs.venueRule ?? "")).includes(venue),
    );
    if (!venueOk) fallos.push(`No hay vía con regla de sede que mencione «${esperado.venueIncluye}» y confianza media o alta`);
  }

  const conCorte = new Set(p.edges.filter((a) => a.rel === "county_served_by" && util(a.confidence)).map((a) => a.from)).size;
  const cobertura = conCorte / esperado.condados;
  if (cobertura < 0.95) fallos.push(`Cobertura de condados ${(cobertura * 100).toFixed(1)} % (< 95 %)`);

  if (
    esperado.preguntaSedesEn &&
    !p.openQuestions.some((q) => q.county === esperado.preguntaSedesEn && q.reason === "multiple_branches_no_official_rule")
  ) {
    fallos.push(`El condado ${esperado.preguntaSedesEn} debía quedar como «varias sedes, sin regla oficial»`);
  }

  if (esperado.corteDeCondado) {
    const { fips, incluye } = esperado.corteDeCondado;
    const ok = p.edges.some((a) => a.rel === "county_served_by" && a.from === `county:${fips}` && (etiqueta.get(a.to) ?? "").includes(comparable(incluye)));
    if (!ok) fallos.push(`El condado ${fips} debía ir a una corte que contenga «${incluye}»`);
  }

  const contradichas = p.edges.filter((a) => util(a.confidence) && a.evidence.some((ev) => ev.secondPassVerified === false));
  if (contradichas.length > 0) {
    fallos.push(`${contradichas.length} conexiones con confianza media/alta tienen una cita que la re-verificación no encontró`);
  }

  return {
    estado: p.state,
    aprobado: fallos.length === 0,
    fallos,
    metricas: {
      coberturaCondados: cobertura,
      aristasBajas: p.edges.filter((a) => a.confidence === "low").length,
      preguntasAbiertas: p.openQuestions.length,
    },
  };
}

function main(): void {
  const esperados = JSON.parse(readFileSync("data/esperado-piloto.json", "utf8")) as Record<string, Esperado>;
  const resultados: EvaluacionPiloto[] = [];
  for (const [estado, esperado] of Object.entries(esperados)) {
    const ruta = join("salida", estado, "paquete.json");
    if (!existsSync(ruta)) {
      console.log(`· ${estado}: sin paquete todavía`);
      continue;
    }
    const r = evaluarPiloto(Paquete.parse(JSON.parse(readFileSync(ruta, "utf8"))), esperado);
    resultados.push(r);
    console.log(`${r.aprobado ? "✔" : "✘"} ${estado}: cobertura ${(r.metricas.coberturaCondados * 100).toFixed(1)} %, ${r.metricas.aristasBajas} bajas, ${r.metricas.preguntasAbiertas} preguntas`);
    for (const f of r.fallos) console.log(`   - ${f}`);
  }
  writeFileSync(join("salida", "piloto.json"), JSON.stringify(resultados, null, 2));
}

const esEntrada = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esEntrada) main();
