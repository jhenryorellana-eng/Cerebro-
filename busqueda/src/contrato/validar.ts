import type { Paquete } from "./paquete.js";
import type { Filtro } from "./vocabularios.js";

export type CodigoProblema =
  | "clave_duplicada"
  | "clave_de_otro_estado"
  | "referencia_rota"
  | "evidencia_de_otro_dato"
  | "campo_inexistente"
  | "dominio_no_coincide"
  | "tipo_no_coincide"
  | "asignacion_duplicada"
  | "verificado_sin_evidencia"
  | "verificado_sin_fuente_a"
  | "verificado_sin_filtros"
  | "verificado_con_filtro_fallido"
  | "campo_clave_sin_evidencia"
  | "verificado_incompleto"
  | "edad_definicion_general_verificada"
  | "sede_sin_territorio"
  | "territorio_invalido"
  | "unidad_incoherente";

export interface Problema {
  codigo: CodigoProblema;
  clave: string;
  detalle: string;
}

export type TipoElemento = "marco" | "tipoCorte" | "via" | "corte" | "sede" | "asignacion" | "formulario" | "requisito";

interface Controlado {
  tipo: TipoElemento;
  el: { key: string; status: string; filters: { filtro: string; ok: boolean }[]; evidenceKeys: string[] } & Record<string, unknown>;
}

/** Filtros que exige cada tipo de dato para quedar verificado (spec §6.3, tabla de autoaprobación). */
const REGLAS: Filtro[] = ["F1", "F2", "F3", "F5", "F6", "F7"];
const ASIGNACIONES: Filtro[] = ["F1", "F3", "F5", "F7"];
export const FILTROS_REQUERIDOS: Record<TipoElemento, Filtro[]> = {
  marco: REGLAS,
  tipoCorte: REGLAS,
  via: REGLAS,
  requisito: REGLAS,
  corte: ASIGNACIONES,
  sede: ASIGNACIONES,
  asignacion: ASIGNACIONES,
  formulario: ["F1", "F5", "F7"],
};

/** Campos que un dato verificado debe tener respaldados por evidencia A propia (spec §5.3: evidencia por campo). */
function camposClave(c: Controlado): string[] {
  switch (c.tipo) {
    case "marco":
      return ["majorityAge", ...(c.el.hasSijsStatute === true ? ["hasSijsStatute"] : [])];
    case "tipoCorte":
      return ["officialName"];
    case "via":
      return ["courtTypeKey", "ageLimitExclusive"];
    case "corte":
      return ["canonicalName"];
    case "sede":
      return ["name"];
    case "asignacion":
      return ["courtKey"];
    case "formulario":
      return ["officialUrl"];
    case "requisito":
      return ["text"];
  }
}

const primerSegmento = (campo: string) => campo.split(".")[0]!;

/**
 * Comprobaciones que Zod no puede expresar: referencias entre elementos, coherencia de tipos y territorios,
 * y las reglas de verificación del contrato (spec §5.3 y §6.3). Devuelve todos los problemas, no solo el primero.
 * `condados`: FIPS de los condados del estado del paquete (Census); si se pasa, un FIPS de fuera es inválido.
 */
export function validarPaquete(p: Paquete, opciones: { condados?: ReadonlySet<string> } = {}): Problema[] {
  const problemas: Problema[] = [];
  const falla = (codigo: CodigoProblema, clave: string, detalle: string) => problemas.push({ codigo, clave, detalle });

  const de = (tipo: TipoElemento, lista: object[]): Controlado[] => lista.map((el) => ({ tipo, el: el as Controlado["el"] }));
  const controlados: Controlado[] = [
    ...de("marco", [p.framework]),
    ...de("tipoCorte", p.courtTypes),
    ...de("via", p.routes),
    ...de("corte", p.courts),
    ...de("sede", p.courthouses),
    ...de("asignacion", p.assignments),
    ...de("formulario", p.forms),
    ...de("requisito", p.filingRequirements),
  ];

  const prefijo = `${p.state.toLowerCase()}:`;
  const vistas = new Set<string>();
  for (const clave of [...controlados.map((c) => c.el.key), ...p.evidence.map((e) => e.key), ...p.openItems.map((o) => o.key)]) {
    if (vistas.has(clave)) falla("clave_duplicada", clave, "la clave aparece en más de un elemento");
    vistas.add(clave);
    if (!clave.startsWith(prefijo)) falla("clave_de_otro_estado", clave, `las claves del paquete de ${p.state} empiezan por «${prefijo}»`);
  }

  const tipos = new Set(p.courtTypes.map((t) => t.key));
  const vias = new Set(p.routes.map((r) => r.key));
  const cortes = new Map(p.courts.map((c) => [c.key, c]));
  const sedes = new Map(p.courthouses.map((s) => [s.key, s]));
  const evidencias = new Map(p.evidence.map((e) => [e.key, e]));
  const elementos = new Map(controlados.map((c) => [c.el.key, c]));

  const referencia = (clave: string, existe: boolean, que: string, destino: string) => {
    if (!existe) falla("referencia_rota", clave, `${que} → ${destino} no existe`);
  };

  for (const r of p.routes) referencia(r.key, tipos.has(r.courtTypeKey), "courtTypeKey", r.courtTypeKey);
  for (const c of p.courts) referencia(c.key, tipos.has(c.courtTypeKey), "courtTypeKey", c.courtTypeKey);
  for (const s of p.courthouses) referencia(s.key, cortes.has(s.courtKey), "courtKey", s.courtKey);
  for (const a of p.assignments) {
    referencia(a.key, tipos.has(a.courtTypeKey), "courtTypeKey", a.courtTypeKey);
    referencia(a.key, cortes.has(a.courtKey), "courtKey", a.courtKey);
    for (const s of a.courthouseKeys) referencia(a.key, sedes.has(s), "courthouseKeys", s);
  }
  for (const f of p.forms) {
    referencia(f.key, tipos.has(f.courtTypeKey), "courtTypeKey", f.courtTypeKey);
    for (const r of f.routeKeys) referencia(f.key, vias.has(r), "routeKeys", r);
  }
  for (const q of p.filingRequirements) {
    referencia(q.key, tipos.has(q.courtTypeKey), "courtTypeKey", q.courtTypeKey);
    if (q.routeKey !== null) referencia(q.key, vias.has(q.routeKey), "routeKey", q.routeKey);
  }
  for (const e of p.evidence) {
    const respaldado = elementos.get(e.supports.key);
    referencia(e.key, respaldado !== undefined, "supports.key", e.supports.key);
    if (respaldado && !Object.hasOwn(respaldado.el, primerSegmento(e.supports.field))) {
      falla("campo_inexistente", e.key, `${e.supports.key} no tiene el campo «${e.supports.field}»`);
    }
    let host = "";
    try {
      host = new URL(e.url).hostname.toLowerCase();
    } catch {
      host = "";
    }
    if (host !== e.domain.toLowerCase()) falla("dominio_no_coincide", e.key, `domain «${e.domain}» no es el host de ${e.url}`);
  }
  for (const o of p.openItems) {
    if (o.itemKey !== null) referencia(o.key, elementos.has(o.itemKey), "itemKey", o.itemKey);
    if (o.kind === "pregunta") {
      for (const op of o.options) for (const k of op.evidenceKeys) referencia(o.key, evidencias.has(k), "options.evidenceKeys", k);
    }
  }

  for (const c of controlados) {
    const { el } = c;
    const propias = el.evidenceKeys.map((k) => evidencias.get(k));
    el.evidenceKeys.forEach((k, i) => {
      const e = propias[i];
      if (!e) falla("referencia_rota", el.key, `evidenceKeys → ${k} no existe`);
      else if (e.supports.key !== el.key) falla("evidencia_de_otro_dato", el.key, `${k} respalda a ${e.supports.key}`);
    });
    if (el.status !== "verificado") continue;

    if (el.evidenceKeys.length === 0) falla("verificado_sin_evidencia", el.key, "un dato verificado necesita evidencia");
    const deNivelA = propias.filter((e) => e !== undefined && e.tier === "A" && e.supports.key === el.key);
    if (el.evidenceKeys.length > 0 && deNivelA.length === 0) {
      falla("verificado_sin_fuente_a", el.key, "ninguna de sus evidencias es de nivel A");
    }
    const fallidos = el.filters.filter((f) => !f.ok).map((f) => f.filtro);
    if (fallidos.length > 0) falla("verificado_con_filtro_fallido", el.key, `filtros fallidos: ${fallidos.join(", ")}`);
    const aprobados = new Set(el.filters.filter((f) => f.ok).map((f) => f.filtro));
    const faltan = FILTROS_REQUERIDOS[c.tipo].filter((f) => !aprobados.has(f));
    if (faltan.length > 0) falla("verificado_sin_filtros", el.key, `faltan los filtros ${faltan.join(", ")} (spec §6.3)`);
    for (const campo of camposClave(c)) {
      if (!deNivelA.some((e) => primerSegmento(e!.supports.field) === campo)) {
        falla("campo_clave_sin_evidencia", el.key, `el campo «${campo}» no tiene evidencia A propia`);
      }
    }
  }

  for (const r of p.routes) {
    if (r.status !== "verificado") continue;
    if (r.ageBasis === "definicion_general") {
      falla("edad_definicion_general_verificada", r.key, "una edad sacada de una definición general siempre va a revisión");
    }
    if (r.ageLimitExclusive === null || r.ageBasis === null || r.statute === null) {
      falla("verificado_incompleto", r.key, "una vía verificada necesita edad, base de la edad y ley");
    }
  }
  for (const c of p.courts) {
    if (c.status === "verificado" && c.caption.length === 0) falla("verificado_incompleto", c.key, "una corte verificada necesita su encabezado");
  }
  if (p.framework.status === "verificado" && (p.framework.majorityAge === null || p.framework.hasSijsStatute === null)) {
    falla("verificado_incompleto", p.framework.key, "un marco verificado necesita la mayoría de edad y saber si hay ley SIJS");
  }

  const verificadas = new Set<string>();
  for (const a of p.assignments) {
    const corte = cortes.get(a.courtKey);
    if (corte && corte.courtTypeKey !== a.courtTypeKey) falla("tipo_no_coincide", a.key, `la corte ${corte.key} es de otro tipo`);
    for (const s of a.courthouseKeys) {
      const sede = sedes.get(s);
      if (sede && sede.courtKey !== a.courtKey) falla("tipo_no_coincide", a.key, `la sede ${s} es de otra corte`);
    }
    const territorio = `${a.territory.kind}:${a.territory.code}|${a.courtTypeKey}`;
    if (a.status === "verificado") {
      if (verificadas.has(territorio)) falla("asignacion_duplicada", a.key, `ya hay una asignación verificada para ${territorio}`);
      verificadas.add(territorio);
      if (a.courthouseRule === "unica" && a.courthouseKeys.length !== 1) {
        falla("verificado_incompleto", a.key, "la regla «unica» exige exactamente una sede");
      }
      if (["por_zip", "por_pueblo", "a_eleccion"].includes(a.courthouseRule) && a.courthouseKeys.length === 0) {
        falla("verificado_incompleto", a.key, `la regla «${a.courthouseRule}» necesita sus sedes`);
      }
    }
    const necesita = a.courthouseRule === "por_zip" ? "zip" : a.courthouseRule === "por_pueblo" ? "pueblo" : null;
    if (necesita) {
      for (const s of a.courthouseKeys) {
        if (sedes.get(s)?.serves?.kind !== necesita) falla("sede_sin_territorio", a.key, `la sede ${s} no dice qué ${necesita} atiende`);
      }
    }
    if (a.territory.kind !== p.framework.assignmentUnit) {
      falla("unidad_incoherente", a.key, `el estado asigna por ${p.framework.assignmentUnit}, no por ${a.territory.kind}`);
    }
    if (a.territory.kind === "condado") {
      const valido = /^\d{5}$/.test(a.territory.code) && (!opciones.condados || opciones.condados.has(a.territory.code));
      if (!valido) falla("territorio_invalido", a.key, `FIPS ${a.territory.code} no es un condado de ${p.state} en el Census`);
    }
    if (a.territory.kind === "estado_unico" && a.territory.code !== p.state) {
      falla("territorio_invalido", a.key, `estado único ${a.territory.code} en el paquete de ${p.state}`);
    }
  }

  return problemas;
}
