import { citaDesdeCaptura } from "../comprobar.js";
import { construirSedes, type SedesDeUnTipo } from "./construirSedes.js";
import type { Condado } from "../condados.js";
import { Paquete, type Asignacion, type Condicion, type Corte, type Evidencia, type Pendiente, type TipoCorte, type Via } from "../contrato/paquete.js";
import { validarPaquete, type CodigoProblema } from "../contrato/validar.js";
import { CONTRATO_VERSION, VERSION_ESQUEMA_PAQUETE } from "../contrato/vocabularios.js";
import type { Cita } from "../esquemas.js";
import { esDominioOficial } from "../fuentes.js";
import { capturasUnicas, type CapturaGuardada } from "./capturasGuardadas.js";
import { urlCanonica } from "../paquete.js";
import type { InfoPdf } from "../pdf.js";
import { aplicarEncabezados } from "./construirEncabezados.js";
import { construirFormularios } from "./construirFormularios.js";
import { construirRequisitos } from "./construirRequisitos.js";
import type {
  CitaPropuesta,
  CortesPropuestasV3,
  EncabezadosPropuestos,
  FormulariosPropuestos,
  MarcoPropuesto,
  RequisitosPropuestos,
  ViasPropuestas,
} from "./esquemas.js";
import { estadoDe, EXTRAIDO_POR_LIGADURA, slug, type CtxNivel, type EntradaCorte } from "./nivel.js";
import { nucleoCondado } from "../tareas/extraer.js";
import {
  esTipoDeCondado,
  f1,
  f1Asignacion,
  f2Campos,
  f2Via,
  f3,
  f3Ligadura,
  f5Asignacion,
  f5Bien,
  f5Corte,
  f5Via,
  f7,
  hayDuda,
  nombraAlguno,
  type ResultadoFiltro,
} from "./filtros.js";
import { LectorDeCondados, ordinalDeCorte } from "./condadosEnTexto.js";
import { IndiceLigaduras, type PaginaLigable } from "./ligaduras.js";
import { nombreEstado } from "../estados.js";

export { slug } from "./nivel.js";

/** Las propuestas del nivel 2 para un tipo de corte: un resultado por lote de condados. */
export interface CortesDeUnTipo {
  tipoPropuesto: string;
  lotes: CortesPropuestasV3[];
}

export interface EntradaConstruccion {
  estado: string;
  generadoEn: string;
  version: string;
  modelos: Record<string, string>;
  dominios: string[];
  condados: Condado[];
  capturas: Map<string, CapturaGuardada>;
  marco: MarcoPropuesto;
  vias: ViasPropuestas;
  cortes: CortesDeUnTipo[];
  /** Nombre del estado, para los huecos {state} del encabezado. */
  nombre?: string;
  /** Nivel 3: sedes y regla de sede, por tipo de corte (clave de paquete) y lote. */
  sedes?: SedesDeUnTipo[];
  /** Nivel 4: formularios, y lo que el código sabe de cada PDF capturado (por URL y URL final). */
  formularios?: FormulariosPropuestos;
  pdfs?: Map<string, InfoPdf>;
  /** Nivel 5. */
  requisitos?: RequisitosPropuestos;
  /** Nivel 6: encabezados de corte y títulos del caso. */
  encabezados?: EncabezadosPropuestos;
  /** F6: resultado del verificador que refuta, por clave de regla. */
  refutaciones?: Map<string, ResultadoFiltro>;
}

/** Separa «Juvenile Court (jurisdicción concurrente…)» en nombre y aclaración: el contrato no admite paréntesis. */
export function separarAclaracion(nombre: string): { nombre: string; aclaracion: string | null } {
  const aclaraciones = [...nombre.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]!.trim()).filter(Boolean);
  const limpio = nombre.replace(/\([^()]*\)/g, " ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  return { nombre: limpio, aclaracion: aclaraciones.length > 0 ? aclaraciones.join("; ") : null };
}

/** Lo que el validador no deja verificado y basta con mandar a revisión; cualquier otro problema es un fallo de la fábrica. */
const DEGRADABLES: ReadonlySet<CodigoProblema> = new Set<CodigoProblema>([
  "verificado_sin_evidencia",
  "verificado_sin_fuente_a",
  "verificado_sin_filtros",
  "verificado_con_filtro_fallido",
  "campo_clave_sin_evidencia",
  "verificado_incompleto",
  "edad_definicion_general_verificada",
  "asignacion_duplicada",
]);

/** Lo que el validador no deja verificado pasa a revisión; cualquier otro problema es un fallo de la fábrica. */
export function ajustar(p: Paquete, condados: ReadonlySet<string>): Paquete {
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const problemas = validarPaquete(p, { condados });
    if (problemas.length === 0) return p;
    const otros = problemas.filter((x) => !DEGRADABLES.has(x.codigo));
    if (otros.length > 0) throw new Error(`Paquete de ${p.state}: ${otros.map((x) => `${x.codigo} ${x.clave} (${x.detalle})`).join("; ")}`);
    const bajar = new Set(problemas.map((x) => x.clave));
    for (const el of [p.framework, ...p.courtTypes, ...p.routes, ...p.courts, ...p.courthouses, ...p.assignments, ...p.forms, ...p.filingRequirements]) {
      if (bajar.has(el.key) && el.status === "verificado") el.status = "a_revisar";
    }
  }
  throw new Error(`Paquete de ${p.state}: no converge tras bajar a revisión lo no verificable`);
}

/** Propuestas de la IA + capturas guardadas → paquete v2 del contrato, con sus filtros y validado. */
export function construirPaquete(e: EntradaConstruccion): Paquete {
  const st = e.estado.toLowerCase();
  const evidencias: Evidencia[] = [];
  const pendientes: Pendiente[] = [];
  let nEv = 0;
  let nNota = 0;
  const nota = (itemKey: string | null, texto: string) => {
    if (texto.trim()) pendientes.push({ kind: "nota", key: `${st}:nota:${++nNota}`, itemKey, text: texto.trim() });
  };

  /** Comprueba las citas propuestas contra las capturas; solo las encontradas crean evidencia, firmada por `extraidoPor`. */
  const citar = (
    itemKey: string,
    campo: string,
    propuestas: CitaPropuesta[],
    extraidoPor = e.modelos.extraer ?? "desconocido",
  ): { citas: Cita[]; claves: string[] } => {
    const citas = propuestas.map((c) => citaDesdeCaptura(c.url, c.quote, e.capturas));
    const claves: string[] = [];
    for (const c of citas) {
      if (!c.found || !c.url.startsWith("https://")) continue;
      const key = `${st}:ev:${++nEv}`;
      evidencias.push({
        key,
        supports: { key: itemKey, field: campo },
        url: c.url,
        domain: new URL(c.url).hostname.toLowerCase(),
        tier: esDominioOficial(c.url, e.dominios) ? "A" : "B",
        quote: c.quote,
        snippet: c.snippet,
        pageSha256: c.pageSha256.replace(/-/g, ""),
        capturePath: c.screenshotPath,
        retrievedAt: e.capturas.get(c.url)?.fecha ?? e.generadoEn,
        extractedBy: extraidoPor,
      });
      claves.push(key);
    }
    return { citas, claves };
  };
  const lector = new LectorDeCondados(e.condados, e.nombre ?? nombreEstado(e.estado));
  // Las páginas oficiales capturadas, para las segundas fuentes que busca el código (ligaduras de condados, direcciones).
  // Una misma página capturada con dos URL (www., barra final, redirección) es una sola fuente: cuenta su captura más
  // reciente, o F3 la contaría dos veces.
  const oficiales = capturasUnicas(e.capturas).filter((c) => c.problema === null && c.url.startsWith("https://") && esDominioOficial(c.url, e.dominios));
  const vistas = new Set<string>();
  const unaPorPagina = new Set(
    [...oficiales]
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .filter((c) => {
        const urls = [c.url, c.finalUrl].map(urlCanonica);
        if (urls.some((u) => vistas.has(u))) return false;
        for (const u of urls) vistas.add(u);
        return true;
      }),
  );
  const paginas: PaginaLigable[] = oficiales
    .filter((c) => unaPorPagina.has(c))
    .map((c) => ({ url: c.url, sha: c.sha256.replace(/-/g, "").toLowerCase(), texto: c.texto }));
  const ctx: CtxNivel = {
    st,
    estado: e.estado,
    nombreEstado: e.nombre ?? e.estado,
    condados: e.condados,
    lector,
    paginas,
    citar,
    comprobar: (ps) => ps.map((c) => citaDesdeCaptura(c.url, c.quote, e.capturas)),
    nota,
    oficial: (url) => esDominioOficial(url, e.dominios),
  };
  /** F6 solo existe si el verificador corrió: sin él las reglas nunca se verifican (§6.3). */
  const f6De = (key: string): ResultadoFiltro[] => {
    const r = e.refutaciones?.get(key);
    return r ? [r] : [];
  };

  // ── Nivel 0: marco ──────────────────────────────────────────────────────────────────────────────
  const m = e.marco;
  const kMarco = `${st}:marco`;
  const eMay = citar(kMarco, "majorityAge", m.majorityAge.citations);
  const eSijs = citar(kMarco, "hasSijsStatute", m.hasSijsStatute.citations);
  const eUnidad = citar(kMarco, "assignmentUnit", m.assignmentUnit.citations);
  const mayoria = m.majorityAge.value !== null && m.majorityAge.value >= 18 && m.majorityAge.value <= 21 ? m.majorityAge.value : null;
  const dudasMarco = [...m.majorityAge.dudas, ...m.hasSijsStatute.dudas, ...m.assignmentUnit.dudas];
  if (m.majorityAge.value === null) dudasMarco.push("mayoría de edad sin dato en las páginas oficiales guardadas");
  else if (mayoria === null) dudasMarco.push(`mayoría de edad fuera de rango: ${m.majorityAge.value}`);
  if (m.hasSijsStatute.value === null) dudasMarco.push("no se sabe si el estado tiene ley SIJS propia");
  if (m.assignmentUnit.value === null) dudasMarco.push("unidad de asignación desconocida: se asume condado");
  const notasGlobales = [m.notes, e.vias.notes, ...e.cortes.flatMap((t) => t.lotes.map((l) => l.notes))].filter((n) => n.trim());
  const filtrosMarco = [
    f1([...eMay.citas, ...eSijs.citas, ...eUnidad.citas]),
    f2Campos([eMay.citas, ...(m.hasSijsStatute.value === true ? [eSijs.citas] : []), eUnidad.citas]),
    f3(eMay.citas),
    f5Bien(),
    ...f6De(kMarco),
    f7(dudasMarco, notasGlobales),
  ];
  for (const d of dudasMarco) nota(kMarco, d);
  for (const n of notasGlobales) if (hayDuda(n)) nota(null, n);
  const hayDato = mayoria !== null || m.hasSijsStatute.value !== null || m.assignmentUnit.value !== null;
  const framework: Paquete["framework"] = {
    key: kMarco,
    status: estadoDe("marco", filtrosMarco, hayDato),
    filters: filtrosMarco,
    evidenceKeys: [...eMay.claves, ...eSijs.claves, ...eUnidad.claves],
    // Lo que no se encontró va en null (contrato 2.1.0). La unidad no admite null porque la exigen las asignaciones:
    // sin dato se asume condado, con su duda anotada.
    majorityAge: mayoria,
    hasSijsStatute: m.hasSijsStatute.value,
    assignmentUnit: m.assignmentUnit.value ?? "condado",
  };

  // Tipos de corte
  const tipos = new Map<string, string>();
  const courtTypes: TipoCorte[] = [];
  for (const t of m.courtTypes) {
    const { nombre, aclaracion } = separarAclaracion(t.officialName);
    if (!nombre) continue;
    const key = `${st}:tipo:${slug(t.key || nombre)}`;
    tipos.set(t.key, key);
    tipos.set(nombre.toLowerCase(), key);
    if (courtTypes.some((x) => x.key === key)) continue;
    const ev = citar(key, "officialName", t.citations);
    const filtros = [f1(ev.citas), f2Campos([ev.citas]), f3(ev.citas), f5Bien(), ...f6De(key), f7(t.dudas, [])];
    for (const d of t.dudas) nota(key, d);
    const notaTipo = [t.note, aclaracion].filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" · ");
    courtTypes.push({ key, status: estadoDe("tipoCorte", filtros, true), filters: filtros, evidenceKeys: ev.claves, officialName: nombre, note: notaTipo || null });
  }
  const tipoDe = (propuesto: string) =>
    tipos.get(propuesto) ?? tipos.get(propuesto.toLowerCase()) ?? tipos.get(separarAclaracion(propuesto).nombre.toLowerCase());

  // ── Nivel 1: vías ───────────────────────────────────────────────────────────────────────────────
  const routes: Via[] = [];
  for (const v of e.vias.routes) {
    const tipoKey = tipoDe(v.courtTypeKey);
    const key = `${st}:via:${slug(v.key || v.officialName)}`;
    if (!tipoKey) {
      nota(null, `Vía «${v.officialName}» descartada: su tipo de corte «${v.courtTypeKey}» no está en el marco.`);
      continue;
    }
    if (routes.some((r) => r.key === key)) {
      nota(null, `Vía «${v.officialName}» repetida: se conserva la primera.`);
      continue;
    }
    const eNombre = citar(key, "officialName", v.officialNameCitations);
    const eTipo = citar(key, "courtTypeKey", v.courtTypeCitations);
    const eEdad = citar(key, "ageLimitExclusive", v.ageCitations);
    const dudas = [...v.dudas];
    const edad = v.ageLimitExclusive !== null && v.ageLimitExclusive >= 18 && v.ageLimitExclusive <= 22 ? v.ageLimitExclusive : null;
    if (v.ageLimitExclusive !== null && edad === null) dudas.push(`edad fuera de rango: ${v.ageLimitExclusive}`);
    const conditions: Condicion[] = [];
    for (const c of v.conditions) {
      if (c.code === "residencia_minima_meses") {
        if (c.months !== null && c.months > 0) conditions.push({ code: c.code, months: c.months });
        else dudas.push("residencia mínima sin número de meses");
      } else conditions.push({ code: c.code });
    }
    const datos = { category: v.category, ageLimitExclusive: edad, ageBasis: v.ageBasis, statute: v.statute };
    const filtros = [
      f1([...eNombre.citas, ...eTipo.citas, ...eEdad.citas]),
      f2Via(datos),
      f3(eEdad.citas),
      f5Via(datos, { majorityAge: mayoria, hasSijsStatute: m.hasSijsStatute.value }),
      ...f6De(key),
      f7(dudas, []),
    ];
    for (const d of dudas) nota(key, d);
    routes.push({
      key,
      status: estadoDe("via", filtros, true),
      filters: filtros,
      evidenceKeys: [...eNombre.claves, ...eTipo.claves, ...eEdad.claves],
      category: v.category,
      officialName: v.officialName.trim() || "sin nombre",
      courtTypeKey: tipoKey,
      ageLimitExclusive: edad,
      ageBasis: v.ageBasis,
      statute: v.statute,
      conditions,
      whoMayFile: v.whoMayFile.map((w) => w.trim()).filter(Boolean),
      venueRule: v.venueRule,
      // El título del nivel 1 no trae cita que lo pruebe: solo lo pone el nivel 6 (aplicarEncabezados).
      caseStyle: null,
      preferenceRank: null,
    });
  }

  // ── Nivel 2: cortes y asignaciones, por cada tipo de corte ──────────────────────────────────────
  const condadosDelEstado = new Set(e.condados.map((c) => c.fips));
  const unidad = framework.assignmentUnit;
  if (unidad === "pueblo") nota(null, "El estado asigna por pueblo: las asignaciones se hacen en el nivel de sedes (subproyecto 2b).");
  const cortes = new Map<string, EntradaCorte>();
  const asignaciones = new Map<
    string,
    { tipoKey: string; fips: string; cortes: Set<string>; citas: Cita[]; claves: string[]; dudas: string[]; notas: string[] }
  >();
  /** Qué condados asignó el nivel 2 a cada corte: un encabezado que nombra otro condado del estado no es de esa corte. */
  const condadosDeCorte = new Map<string, Set<string>>();
  for (const grupo of e.cortes) {
    const tipoKey = tipoDe(grupo.tipoPropuesto);
    if (!tipoKey) {
      nota(null, `Cortes del tipo «${grupo.tipoPropuesto}» descartadas: el tipo no está en el marco.`);
      continue;
    }
    const sufijo = tipoKey.split(":").pop()!;
    for (const lote of grupo.lotes) {
      const delLote = new Map<string, string>();
      for (const c of lote.courts) {
        // El nombre de una corte se queda entero, aclaraciones incluidas: «District Court (Arlington County)» y
        // «District Court (Fairfax County)» son dos cortes (el contrato solo prohíbe paréntesis en los tipos).
        const nombre = c.canonicalName.replace(/\s+/g, " ").trim();
        if (!nombre) continue;
        const key = `${st}:corte:${sufijo}:${slug(nombre)}`;
        delLote.set(c.key, key);
        const ev = citar(key, "canonicalName", c.citations);
        const aliases = c.aliases.map((a) => a.trim()).filter((a) => a && a !== nombre);
        const previa = cortes.get(key);
        if (previa) {
          previa.corte.aliases = [...new Set([...previa.corte.aliases, ...aliases])];
          if (!previa.corte.district && c.district) previa.corte.district = c.district;
          previa.corte.evidenceKeys.push(...ev.claves);
          previa.citas.push(...ev.citas);
          previa.dudas.push(...c.dudas);
          previa.notas.push(lote.notes);
        } else {
          cortes.set(key, {
            corte: {
              key,
              status: "a_revisar",
              filters: [],
              evidenceKeys: [...ev.claves],
              courtTypeKey: tipoKey,
              canonicalName: nombre,
              aliases: [...new Set(aliases)],
              district: c.district,
              // El encabezado del nivel 2 no trae cita que lo pruebe: solo lo pone el nivel 6 (aplicarEncabezados).
              caption: [],
            },
            citas: [...ev.citas],
            dudas: [...c.dudas],
            notas: [lote.notes],
          });
        }
      }
      if (unidad === "pueblo") continue;
      for (const a of lote.counties) {
        if (!condadosDelEstado.has(a.fips)) {
          nota(null, `FIPS ${a.fips} no es un condado de ${e.estado}: descartado.`);
          continue;
        }
        if (!a.courtKey) continue;
        const corteKey = delLote.get(a.courtKey);
        if (!corteKey) {
          nota(null, `Condado ${a.fips}: la corte «${a.courtKey}» no está entre las cortes de su lote.`);
          continue;
        }
        condadosDeCorte.set(corteKey, (condadosDeCorte.get(corteKey) ?? new Set<string>()).add(a.fips));
        // Con una sola corte para todo el estado, el territorio es el estado: todos sus condados van a la misma
        // asignación, y dos cortes distintas dejan F5 en rojo en vez de verificar la primera.
        const asigKey = unidad === "estado_unico" ? `${st}:asig:estado:${sufijo}` : `${st}:asig:${a.fips}:${sufijo}`;
        const ev = citar(asigKey, "courtKey", a.citations);
        const previa = asignaciones.get(asigKey);
        if (previa) {
          previa.cortes.add(corteKey);
          previa.citas.push(...ev.citas);
          previa.claves.push(...ev.claves);
          previa.dudas.push(...a.dudas);
          previa.notas.push(lote.notes);
        } else {
          asignaciones.set(asigKey, {
            tipoKey,
            fips: a.fips,
            cortes: new Set([corteKey]),
            citas: [...ev.citas],
            claves: [...ev.claves],
            dudas: [...a.dudas],
            notas: [lote.notes],
          });
        }
      }
    }
  }

  if (e.encabezados) aplicarEncabezados(ctx, e.encabezados, cortes, routes, condadosDeCorte);
  const nombreTipo = new Map(courtTypes.map((t) => [t.key, t.officialName]));
  const nucleoDe = new Map(e.condados.map((c) => [c.fips, nucleoCondado(c.name)]));
  const nucleos = [...nucleoDe.values()];
  // Lo que liga cada condado a su corte lo busca el código en las páginas oficiales capturadas (la segunda fuente de F3).
  const indice = new IndiceLigaduras(
    lector,
    paginas,
    [...cortes.values()].map(({ corte }) => ({
      key: corte.key,
      tipoKey: corte.courtTypeKey,
      nombres: [corte.canonicalName, ...corte.aliases],
      ordinal: ordinalDeCorte([corte.canonicalName, ...corte.aliases], corte.district),
    })),
    courtTypes.map((t) => t.officialName),
  );
  // Una corte con distrito que se llama como un tipo («Juvenile Court», 3rd Judicial District) no es ninguna corte concreta
  // (F5): la de ese distrito tiene su propio nombre. Sin distrito puede ser la única del estado (la Family Court de Rhode
  // Island), y con una sola corte para todo el estado también puede llamarse así.
  const nombresDeTipo = unidad === "estado_unico" ? [] : courtTypes.flatMap((t) => [t.officialName, separarAclaracion(t.officialName).nombre]);
  const conDistrito = (c: { canonicalName: string; aliases: string[]; district: string | null }) => ordinalDeCorte([c.canonicalName, ...c.aliases], c.district) !== null;
  // Las notas de un lote valen para todo lo que salió de él (§6.3, F7): «las asignaciones son una inferencia» bloquea.
  const courts: Corte[] = [...cortes.values()].map(({ corte, citas, dudas, notas }) => {
    const f5 = f5Corte(corte.canonicalName, nombreTipo.get(corte.courtTypeKey) ?? "", nucleos, indice.paginasConNombre(corte.key), conDistrito(corte) ? nombresDeTipo : []);
    const filtros = [f1(citas), f3(citas), f5, f7(dudas, notas)];
    for (const d of dudas) nota(corte.key, d);
    return { ...corte, filters: filtros, status: estadoDe("corte", filtros, true) };
  });
  const cortesSinF5 = new Set(courts.filter((c) => c.filters.some((f) => f.filtro === "F5" && !f.ok)).map((c) => c.key));
  const nombreCorte = new Map(courts.map((c) => [c.key, c.canonicalName]));
  const assignments: Asignacion[] = [...asignaciones.entries()].map(([key, a]) => {
    const lista = [...a.cortes];
    const porCondado = unidad !== "estado_unico";
    const nucleo = [nucleoDe.get(a.fips) ?? ""];
    const nombres = lista.map((k) => nombreCorte.get(k) ?? "");
    const sinCondado = porCondado && esTipoDeCondado(nombreTipo.get(a.tipoKey) ?? "") && nombres.some((n) => !nombraAlguno(n, nucleo));
    const deOtroCondado = porCondado && nombres.some((n) => !nombraAlguno(n, nucleo) && nombraAlguno(n, nucleos));
    const corteNoPasa = lista.some((k) => cortesSinF5.has(k));
    let filtros: ResultadoFiltro[];
    let claves = a.claves;
    if (porCondado) {
      // F3 no cuenta las páginas que cita el extractor, sino las páginas oficiales que ligan el condado a su corte (o a su
      // distrito), y las busca el código. Dos de ellas quedan como evidencia; una que lo ligue a otra corte del tipo o a
      // otro distrito es una contradicción (F5).
      const lig = lista.length === 1 ? indice.ligar(a.fips, lista[0]!) : { apoyan: [], contradicen: [] };
      const ev = citar(key, "courtKey", lig.apoyan.slice(0, 2).map((l) => ({ url: l.url, quote: l.fragmento })), EXTRAIDO_POR_LIGADURA);
      const todas = [...a.citas, ...ev.citas];
      claves = [...a.claves, ...ev.claves];
      filtros = [
        // Una cita solo prueba la asignación si nombra el condado COMO condado («Salt Lake City» no nombra a Salt Lake County).
        f1Asignacion(todas, todas.filter((c) => c.found && lector.nombra(c.quote, a.fips))),
        f3Ligadura(new Set(lig.apoyan.map((l) => l.sha)).size),
        f5Asignacion(lista, corteNoPasa, sinCondado, deOtroCondado, lig.contradicen[0] ?? null),
        f7(a.dudas, a.notas),
      ];
    } else {
      // Una sola corte para todo el estado: bastan dos páginas oficiales que la citen.
      const oficiales = a.citas.filter((c) => c.found && esDominioOficial(c.url, e.dominios));
      filtros = [f1Asignacion(a.citas, a.citas.filter((c) => c.found)), f3(oficiales), f5Asignacion(lista, corteNoPasa), f7(a.dudas, a.notas)];
    }
    for (const d of a.dudas) nota(key, d);
    return {
      key,
      status: estadoDe("asignacion", filtros, true),
      filters: filtros,
      evidenceKeys: claves,
      territory: unidad === "estado_unico" ? { kind: "estado_unico", code: e.estado } : { kind: "condado", code: a.fips },
      courtTypeKey: a.tipoKey,
      courtKey: lista[0]!,
      courthouseRule: "sin_regla",
      courthouseKeys: [],
    };
  });

  const courthouses = e.sedes ? construirSedes(ctx, e.sedes, courts, assignments) : [];
  const forms = e.formularios ? construirFormularios(ctx, e.formularios, e.pdfs ?? new Map(), routes, courtTypes) : [];
  const filingRequirements = e.requisitos ? construirRequisitos(ctx, e.requisitos, routes, courtTypes, f6De) : [];

  const paquete: Paquete = {
    schemaVersion: VERSION_ESQUEMA_PAQUETE,
    contractVersion: CONTRATO_VERSION,
    state: e.estado,
    generatedAt: e.generadoEn,
    factory: { version: e.version, models: e.modelos },
    framework,
    courtTypes,
    routes,
    courts,
    courthouses,
    assignments,
    forms,
    filingRequirements,
    evidence: evidencias,
    openItems: pendientes,
  };
  return Paquete.parse(ajustar(paquete, condadosDelEstado));
}
