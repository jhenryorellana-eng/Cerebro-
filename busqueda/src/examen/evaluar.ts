import type { Asignacion, Corte, Paquete, TipoCorte } from "../contrato/paquete.js";
import { normalizar } from "../normalizar.js";
import type { ReglaExamen, Respuesta } from "./respuestas.js";

export type ResultadoItem = "acierto" | "error_detectado" | "error_peligroso" | "sin_dato" | "sin_paquete";

export interface Evaluacion {
  id: string;
  tipo: Respuesta["tipo"];
  estado: string;
  resultado: ResultadoItem;
  detalle: string;
}

export interface Informe {
  total: number;
  aciertos: number;
  erroresPeligrosos: number;
  porTipo: Record<string, { total: number; aciertos: number }>;
  aprobado: boolean;
  items: Evaluacion[];
}

/** Para comparar nombres de corte: sin mayúsculas, sin puntuación, «&» = «and». */
export function nombreComparable(s: string): string {
  return normalizar(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Parcial = Pick<Evaluacion, "resultado" | "detalle">;

/** Un valor incorrecto es peligroso si algún elemento incorrecto está verificado; si no, lo detectaron los filtros. */
function errorSegun(verificado: boolean, detalle: string): Parcial {
  return { resultado: verificado ? "error_peligroso" : "error_detectado", detalle };
}

function evaluarMarco(r: Extract<Respuesta, { tipo: "marco" }>, p: Paquete): Parcial {
  if (p.framework.status === "sin_dato") return { resultado: "sin_dato", detalle: "marco sin dato" };
  const valor = p.framework[r.campo];
  if (valor === null) return { resultado: "sin_dato", detalle: `${r.campo} sin dato` };
  if (valor === r.esperado) return { resultado: "acierto", detalle: `${r.campo} = ${String(valor)}` };
  return errorSegun(p.framework.status === "verificado", `${r.campo} = ${String(valor)}, esperado ${String(r.esperado)}`);
}

function evaluarViaEdad(r: Extract<Respuesta, { tipo: "via_edad" }>, p: Paquete): Parcial {
  const vias = p.routes.filter((v) => r.categorias.includes(v.category) && v.status !== "sin_dato");
  if (vias.length === 0) return { resultado: "sin_dato", detalle: `sin vía de ${r.categorias.join(" o ")}` };
  const coincide = (v: (typeof vias)[number]) =>
    v.ageLimitExclusive === r.esperado.ageLimitExclusive && (r.esperado.ageBasis === undefined || v.ageBasis === r.esperado.ageBasis);
  // Un error verificado se publicaría solo: pesa más que cualquier acierto a revisión.
  const verificadaMala = vias.find((v) => v.status === "verificado" && !coincide(v));
  if (verificadaMala) {
    return {
      resultado: "error_peligroso",
      detalle: `${verificadaMala.key} verificada con menor de ${verificadaMala.ageLimitExclusive ?? "?"} (${verificadaMala.ageBasis ?? "sin base"}); esperado menor de ${r.esperado.ageLimitExclusive}`,
    };
  }
  const buena = vias.find(coincide);
  if (buena) return { resultado: "acierto", detalle: `${buena.key}: menor de ${buena.ageLimitExclusive} (${buena.ageBasis ?? "sin base"})` };
  const malas = vias.map((v) => `${v.key}: ${v.ageLimitExclusive ?? "?"} (${v.ageBasis ?? "sin base"})`).join("; ");
  return errorSegun(vias.some((v) => v.status === "verificado"), `esperado menor de ${r.esperado.ageLimitExclusive}; hay ${malas}`);
}

function asignacionesDe(p: Paquete, fips: string, tipoCorte?: string): { a: Asignacion; corte: Corte | undefined; tipo: TipoCorte | undefined }[] {
  const cortes = new Map(p.courts.map((c) => [c.key, c]));
  const tipos = new Map(p.courtTypes.map((t) => [t.key, t]));
  return p.assignments
    .filter((a) => a.territory.code === fips && a.status !== "sin_dato")
    .map((a) => ({ a, corte: cortes.get(a.courtKey), tipo: tipos.get(a.courtTypeKey) }))
    .filter((x) => tipoCorte === undefined || (x.tipo !== undefined && nombreComparable(x.tipo.officialName).includes(nombreComparable(tipoCorte))));
}

function evaluarAsignacion(r: Extract<Respuesta, { tipo: "asignacion" }>, p: Paquete): Parcial {
  const candidatas = asignacionesDe(p, r.fips, r.tipoCorte);
  if (candidatas.length === 0) return { resultado: "sin_dato", detalle: `sin asignación de ${r.tipoCorte} para ${r.fips}` };
  const validos = new Set([r.corte, ...r.aceptadas].map(nombreComparable));
  const coincide = ({ corte }: (typeof candidatas)[number]) => {
    if (!corte) return false;
    const nombres = [corte.canonicalName, ...corte.aliases].map(nombreComparable);
    const nombreOk = nombres.some((n) => validos.has(n));
    const distritoOk = r.distrito === undefined || (corte.district !== null && nombreComparable(corte.district).includes(nombreComparable(r.distrito)));
    return nombreOk && distritoOk;
  };
  // Un error verificado se publicaría solo: pesa más que cualquier acierto a revisión.
  const verificadaMala = candidatas.find((c) => c.a.status === "verificado" && !coincide(c));
  if (verificadaMala) {
    return {
      resultado: "error_peligroso",
      detalle: `${verificadaMala.a.key} verificada → ${verificadaMala.corte?.canonicalName ?? "(corte inexistente)"}; esperado ${r.corte}`,
    };
  }
  const buena = candidatas.find(coincide);
  if (buena) return { resultado: "acierto", detalle: `${buena.a.key} → ${buena.corte!.canonicalName}` };
  const malas = candidatas.map(({ a, corte }) => `${a.key} → ${corte?.canonicalName ?? "(corte inexistente)"} [${corte?.district ?? "sin distrito"}]`).join("; ");
  return errorSegun(candidatas.some(({ a }) => a.status === "verificado"), `esperado ${r.corte}; hay ${malas}`);
}

function cumpleRegla(regla: ReglaExamen, p: Paquete): { cumple: boolean; detalle: string } {
  switch (regla.nombre) {
    case "min_tipos_asignados": {
      const porTerritorio = new Map<string, Set<string>>();
      for (const a of p.assignments) {
        const k = `${a.territory.kind}:${a.territory.code}`;
        porTerritorio.set(k, (porTerritorio.get(k) ?? new Set()).add(a.courtTypeKey));
      }
      const maximo = Math.max(0, ...[...porTerritorio.values()].map((s) => s.size));
      return { cumple: maximo >= regla.minimo, detalle: `máximo de tipos de corte en un territorio: ${maximo}` };
    }
    case "nombre_corte_no_coincide": {
      const patron = new RegExp(regla.patron, "i");
      const malas = asignacionesDe(p, regla.fips).filter(({ a, corte }) => a.status === "verificado" && corte !== undefined && patron.test(corte.canonicalName));
      return { cumple: malas.length === 0, detalle: malas.map(({ corte }) => corte!.canonicalName).join("; ") || "ninguna corte verificada coincide" };
    }
    case "cita_debe_nombrar": {
      const evidencias = new Map(p.evidence.map((e) => [e.key, e]));
      const texto = nombreComparable(regla.texto);
      const malas = asignacionesDe(p, regla.fips).filter(
        ({ a }) => a.status === "verificado" && !a.evidenceKeys.some((k) => nombreComparable(evidencias.get(k)?.quote ?? "").includes(texto)),
      );
      return { cumple: malas.length === 0, detalle: malas.map(({ a }) => `${a.key} sin cita que diga «${regla.texto}»`).join("; ") || "ok" };
    }
    case "via_no_verificada_con": {
      const malas = p.routes.filter(
        (v) =>
          v.status === "verificado" &&
          (regla.categoria === undefined || v.category === regla.categoria) &&
          (regla.edad === undefined || v.ageLimitExclusive === regla.edad) &&
          (regla.base === undefined || v.ageBasis === regla.base),
      );
      return { cumple: malas.length === 0, detalle: malas.map((v) => v.key).join("; ") || "ninguna vía verificada coincide" };
    }
  }
}

function evaluarUna(r: Respuesta, p: Paquete): Parcial {
  switch (r.tipo) {
    case "marco":
      return evaluarMarco(r, p);
    case "via_edad":
      return evaluarViaEdad(r, p);
    case "asignacion":
      return evaluarAsignacion(r, p);
    case "regla": {
      const { cumple, detalle } = cumpleRegla(r.regla, p);
      return { resultado: cumple ? "acierto" : "error_peligroso", detalle };
    }
  }
}

/** Compara cada respuesta conocida con el paquete de su estado. Puro: no lee archivos. */
export function evaluar(respuestas: Respuesta[], paquetes: ReadonlyMap<string, Paquete>): Informe {
  const items: Evaluacion[] = respuestas.map((r) => {
    const p = paquetes.get(r.estado);
    const parcial: Parcial = p ? evaluarUna(r, p) : { resultado: "sin_paquete", detalle: `no hay paquete de ${r.estado}` };
    return { id: r.id, tipo: r.tipo, estado: r.estado, ...parcial };
  });
  const porTipo: Informe["porTipo"] = {};
  for (const i of items) {
    const t = (porTipo[i.tipo] ??= { total: 0, aciertos: 0 });
    t.total++;
    if (i.resultado === "acierto") t.aciertos++;
  }
  const aciertos = items.filter((i) => i.resultado === "acierto").length;
  return {
    total: items.length,
    aciertos,
    erroresPeligrosos: items.filter((i) => i.resultado === "error_peligroso").length,
    porTipo,
    aprobado: items.length > 0 && aciertos === items.length,
    items,
  };
}
