// src/v3/refutar.ts
import { z } from "zod";
import { citaDesdeCaptura } from "../comprobar.js";
import type { Paquete } from "../contrato/paquete.js";
import type { Captura } from "../navegador.js";
import { bloqueTextos } from "../tareas/extraer.js";
import { CitaPropuesta } from "./esquemas.js";
import type { ResultadoFiltro } from "./filtros.js";
import { REGLAS_CITA } from "./prompts.js";

/** Lo que devuelve el verificador (Opus): por afirmación, si la contradice algo de los textos y con qué cita. */
export const RefutacionPropuesta = z.strictObject({
  items: z.array(z.strictObject({ key: z.string(), refutada: z.boolean(), explicacion: z.string(), citations: z.array(CitaPropuesta) })),
  notes: z.string(),
});
export type RefutacionPropuesta = z.infer<typeof RefutacionPropuesta>;

export interface Afirmacion {
  key: string;
  texto: string;
}

/** Las reglas del paquete (spec §6.3: F6 solo para reglas), dichas como afirmaciones que se pueden contradecir. */
export function afirmacionesParaRefutar(p: Paquete): Afirmacion[] {
  const tipos = new Map(p.courtTypes.map((t) => [t.key, t.officialName]));
  const f = p.framework;
  const ley = f.hasSijsStatute === true ? "hay" : f.hasSijsStatute === false ? "no hay" : "no se sabe si hay";
  const a: Afirmacion[] = [
    { key: f.key, texto: `En ${p.state}, la mayoría de edad es ${f.majorityAge ?? "desconocida"}; ${ley} una ley estatal propia sobre los hallazgos SIJS; la competencia de estas cortes se reparte por ${f.assignmentUnit}.` },
  ];
  for (const t of p.courtTypes) a.push({ key: t.key, texto: `«${t.officialName}» es un tipo de corte de ${p.state} que ve casos de menores (custodia, tutela, dependencia o hallazgos SIJS).` });
  for (const r of p.routes) {
    a.push({
      key: r.key,
      texto: `La vía «${r.officialName}» (${r.category}) se presenta ante la «${tipos.get(r.courtTypeKey) ?? r.courtTypeKey}», y la orden tiene que dictarse antes de que el menor cumpla ${r.ageLimitExclusive ?? "?"} años (base: ${r.ageBasis ?? "sin base"}; ${r.statute ?? "sin artículo"}).`,
    });
  }
  for (const q of p.filingRequirements) {
    a.push({ key: q.key, texto: `Requisito (${q.kind}) ante la «${tipos.get(q.courtTypeKey) ?? q.courtTypeKey}»: ${q.text}${q.amountUsd !== null ? ` (${q.amountUsd} USD)` : ""}.` });
  }
  return a;
}

export function promptRefutar(estado: string, nombre: string, afirmaciones: Afirmacion[], capturas: Captura[]): string {
  return [
    `TAREA — Verificador que REFUTA: afirmaciones sobre ${nombre} (${estado}) que otro modelo extrajo de estas páginas oficiales.`,
    "Tu trabajo es el contrario al del extractor: busca en los textos algo que CONTRADIGA cada afirmación (otra edad, otra corte, una excepción, una ley derogada o sustituida, otro importe). No la confirmes ni la mejores.",
    "items: uno por afirmación, con su key EXACTA. refutada = true solo si encontraste una contradicción; entonces citations con la frase LITERAL que la contradice y explicacion en una frase. Si los textos no la contradicen, refutada = false, citations [] y explicacion breve.",
    "Afirmaciones:",
    ...afirmaciones.map((x) => `${x.key}: ${x.texto}`),
    ...REGLAS_CITA.slice(0, 2),
    "notes: en español, máximo 5 frases.",
    "",
    bloqueTextos(capturas),
  ].join("\n");
}

/** F6 por afirmación: verde solo si el verificador respondió y no la refutó. Cualquier refutación la manda a revisión. */
export function resultadosF6(afirmaciones: Afirmacion[], r: RefutacionPropuesta, capturas: Map<string, Captura>): Map<string, ResultadoFiltro> {
  const salida = new Map<string, ResultadoFiltro>();
  for (const a of afirmaciones) {
    const propios = r.items.filter((i) => i.key === a.key);
    const item = propios[0];
    if (!item) {
      salida.set(a.key, { filtro: "F6", ok: false, detalle: "el verificador no respondió a esta afirmación" });
      continue;
    }
    if (propios.length > 1) {
      // Una clave repetida es una respuesta ambigua: nunca verde, y si alguna refuta, se dice.
      const algunaRefuta = propios.some((i) => i.refutada);
      salida.set(a.key, { filtro: "F6", ok: false, detalle: `respuesta ambigua: el verificador repitió esta afirmación ${propios.length} veces${algunaRefuta ? " y al menos una la refuta" : ""}` });
      continue;
    }
    if (!item.refutada) {
      if (item.citations.length > 0) {
        salida.set(a.key, { filtro: "F6", ok: false, detalle: "respuesta incoherente: no refutada pero con citas" });
        continue;
      }
      salida.set(a.key, { filtro: "F6", ok: true });
      continue;
    }
    const comprobadas = item.citations.map((c) => citaDesdeCaptura(c.url, c.quote, capturas)).filter((c) => c.found);
    const detalle = `refutada: ${item.explicacion}${comprobadas.length === 0 ? " (sin cita comprobada)" : ""}`;
    salida.set(a.key, { filtro: "F6", ok: false, detalle: detalle.slice(0, 300) });
  }
  return salida;
}
