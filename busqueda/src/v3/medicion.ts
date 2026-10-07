import type { Condado } from "../condados.js";
import type { Paquete } from "../contrato/paquete.js";

/** Las clases de datos de un paquete, en el orden del contrato. */
export const CLASES = ["marco", "tipos", "vias", "cortes", "sedes", "asignaciones", "formularios", "requisitos"] as const;
export type Clase = (typeof CLASES)[number];

export interface ResumenClase {
  total: number;
  verificados: number;
  /** Cuántos datos pasan cada filtro («F3» → 12). */
  pasan: Record<string, number>;
}
export type Resumen = Record<Clase, ResumenClase>;

interface Dato {
  key: string;
  status: string;
  filters: { filtro: string; ok: boolean }[];
  evidenceKeys: string[];
}

function datosDe(p: Paquete): Record<Clase, Dato[]> {
  return {
    marco: [p.framework],
    tipos: p.courtTypes,
    vias: p.routes,
    cortes: p.courts,
    sedes: p.courthouses,
    asignaciones: p.assignments,
    formularios: p.forms,
    requisitos: p.filingRequirements,
  };
}

/** Por clase: cuántos datos hay, cuántos salen verificados y cuántos pasan cada filtro. */
export function resumir(p: Paquete): Resumen {
  const salida = {} as Resumen;
  for (const clase of CLASES) {
    const datos = datosDe(p)[clase];
    const pasan: Record<string, number> = {};
    for (const d of datos) for (const f of d.filters) if (f.ok) pasan[f.filtro] = (pasan[f.filtro] ?? 0) + 1;
    salida[clase] = { total: datos.length, verificados: datos.filter((d) => d.status === "verificado").length, pasan };
  }
  return salida;
}

export interface Medicion {
  estado: string;
  /** null si no había paquete con el que comparar. */
  antes: Resumen | null;
  despues: Resumen;
  /** Claves que ahora salen verificadas y antes no (o no existían). */
  nuevos: string[];
  /** Claves que antes salían verificadas y ahora no. */
  perdidos: string[];
}

export function medir(estado: string, antes: Paquete | null, despues: Paquete): Medicion {
  const verificados = (p: Paquete | null) =>
    new Set(p ? CLASES.flatMap((c) => datosDe(p)[c]).filter((d) => d.status === "verificado").map((d) => d.key) : []);
  const a = verificados(antes);
  const d = verificados(despues);
  return {
    estado,
    antes: antes ? resumir(antes) : null,
    despues: resumir(despues),
    nuevos: [...d].filter((k) => !a.has(k)).sort(),
    perdidos: [...a].filter((k) => !d.has(k)).sort(),
  };
}

const FILTROS_TABLA = ["F1", "F3", "F5", "F7"] as const;

/** Tabla en markdown: por estado y clase, verificados y filtros que pasan, antes → después. */
export function informeMedicion(ms: readonly Medicion[]): string {
  const par = (antes: number | undefined, despues: number) => (antes === undefined || antes === despues ? `${despues}` : `${antes} → ${despues}`);
  const lineas = [
    "# Medición de la fábrica v3",
    "",
    "Verificados y filtros que pasan, antes → después (antes = los paquetes de la carpeta base).",
    "",
    "| Estado | Clase | Verificados / total | F1 | F3 | F5 | F7 |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const m of ms) {
    for (const c of CLASES) {
      const d = m.despues[c];
      const a = m.antes?.[c];
      if (d.total === 0 && (a?.total ?? 0) === 0) continue;
      const filtros = FILTROS_TABLA.map((f) => par(a ? (a.pasan[f] ?? 0) : undefined, d.pasan[f] ?? 0));
      lineas.push(`| ${m.estado} | ${c} | ${par(a?.verificados, d.verificados)} / ${d.total} | ${filtros.join(" | ")} |`);
    }
  }
  lineas.push("", "| Estado | Pasan a verificado | Dejan de estar verificados |", "|---|---|---|");
  for (const m of ms) lineas.push(`| ${m.estado} | ${m.nuevos.length} | ${m.perdidos.length} |`);
  return `${lineas.join("\n")}\n`;
}

/**
 * Para revisar a mano lo que pasa a verificado: cada dato con lo que afirma y todas sus citas (quién las sacó y de qué
 * página). Una cita que no prueba el dato es un fallo de la fábrica, no un detalle.
 */
export function auditoria(p: Paquete, claves: readonly string[], condados: readonly Condado[]): string {
  const evidencias = new Map(p.evidence.map((e) => [e.key, e]));
  const cortes = new Map(p.courts.map((c) => [c.key, c.canonicalName]));
  const nombres = new Map(condados.map((c) => [c.fips, c.name]));
  const todos = new Map(CLASES.flatMap((clase) => datosDe(p)[clase].map((d) => [d.key, { clase, d }] as const)));
  const lineas = [
    `# ${p.state}: datos que pasan a verificado (${claves.length})`,
    "",
    "Comprueba que cada cita pruebe el dato: el condado como condado, ligado a su corte o a su distrito, en una página oficial.",
    "",
  ];
  for (const k of claves) {
    const x = todos.get(k);
    if (!x) continue;
    lineas.push(`## ${k} (${x.clase})`, "");
    const a = p.assignments.find((y) => y.key === k);
    if (a) lineas.push(`${nombres.get(a.territory.code) ?? a.territory.code} → ${cortes.get(a.courtKey) ?? a.courtKey}`, "");
    const s = p.courthouses.find((y) => y.key === k);
    if (s) {
      // El territorio también se revisa: en una tabla de una sola línea, el condado de delante de una sede puede ser de la anterior.
      const atiende = !s.serves ? "sin territorio" : s.serves.kind === "condado" ? s.serves.codes.map((f) => nombres.get(f) ?? f).join(", ") : `${s.serves.kind} ${s.serves.codes.join(", ")}`;
      lineas.push(`${s.name}, ${s.street ?? "sin calle"}, ${s.cityStateZip ?? "sin ciudad"} (${cortes.get(s.courtKey) ?? s.courtKey})`, "", `Atiende: ${atiende}`, "");
    }
    for (const ek of x.d.evidenceKeys) {
      const ev = evidencias.get(ek);
      if (ev) lineas.push(`- «${ev.quote}» — ${ev.url} (${ev.extractedBy})`);
    }
    lineas.push("");
  }
  return `${lineas.join("\n")}\n`;
}
