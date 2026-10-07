import { createHash } from "node:crypto";
import type { Condado } from "./condados.js";
import { calcularConfianza, peorConfianza, type Confianza, type SegundaPasada } from "./confianza.js";
import type { Cita, CondadoAsignado, Comprobacion, ResultadoCortes, ResultadoReglas, ResultadoVerificacion } from "./esquemas.js";
import { esDominioOficial } from "./fuentes.js";
import { normalizar } from "./normalizar.js";
import { claveCita, muestraFalla } from "./tareas/verificarCitas.js";
import { Paquete, type Arista, type Evidencia, type Nodo, type PreguntaAbierta } from "./tipos.js";

export interface EntradaPaquete {
  estado: string;
  nombre: string;
  condados: Condado[];
  dominios: string[];
  ahora: string;
  reglas?: ResultadoReglas;
  verificacionReglas?: ResultadoVerificacion;
  cortes?: ResultadoCortes;
  verificacionCortes?: ResultadoVerificacion;
  /** Hora en que terminó cada etapa (estado/<ST>.json); la evidencia se fecha con ella, no con la construcción. */
  fechas?: Record<string, string>;
  rutaCaptura: (origen: string | null) => string | null;
}

interface Evaluacion {
  evidencias: Evidencia[];
  confianza: Confianza;
  checks: string[];
}

const HASH_VALIDO = /^([0-9a-f]{8}-){7}[0-9a-f]{8}$/;
const ORDEN: Record<Confianza, number> = { low: 0, medium: 1, high: 2 };

export function slug(texto: string): string {
  const s = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "sin-nombre";
}

function hash8(texto: string): string {
  return createHash("sha256").update(texto).digest("hex").slice(0, 8);
}

/** Ids legibles + huella del texto completo: dos nombres largos con el mismo principio nunca se funden. */
export function idCorte(estado: string, nombre: string): string {
  return `court:${estado}:${slug(nombre)}:${hash8(normalizar(nombre).toLowerCase())}`;
}

export function idTipoCorte(estado: string, nombre: string): string {
  return `court_type:${estado}:${slug(nombre)}:${hash8(normalizar(nombre).toLowerCase())}`;
}

export function idVia(estado: string, clave: string): string {
  return `route:${estado}:${slug(clave)}:${hash8(clave)}`;
}

export function idFuente(url: string): string {
  return `source:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

/** Misma página aunque cambien el ancla, la barra final, www. o las mayúsculas del host. */
export function urlCanonica(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const ruta = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${host}${ruta}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Una cita solo cuenta como comprobada si el propio resultado es coherente: found, un hash de página
 * con el formato del verificador y un fragmento que contiene la cita. Así no basta con que la IA diga «found».
 */
export function citaVerificada(c: { found: boolean; quote: string; snippet: string; pageSha256: string }): boolean {
  const q = normalizar(c.quote);
  return c.found && q.length > 0 && HASH_VALIDO.test(c.pageSha256) && normalizar(c.snippet).includes(q);
}

function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function mapaComprobaciones(v?: ResultadoVerificacion): Map<string, Comprobacion> | null {
  if (!v) return null;
  const mapa = new Map<string, Comprobacion>();
  for (const c of v.checks) mapa.set(claveCita(c.url, c.quote), c);
  return mapa;
}

function mejor(a: Confianza | null, b: Confianza): Confianza {
  return a === null || ORDEN[b] > ORDEN[a] ? b : a;
}

class Grafo {
  readonly nodos = new Map<string, Nodo>();
  readonly aristas: Arista[] = [];
  readonly preguntas: PreguntaAbierta[] = [];

  nodo(n: Nodo): string {
    const previo = this.nodos.get(n.id);
    if (!previo) this.nodos.set(n.id, n);
    else {
      if (!previo.screenshot && n.screenshot) previo.screenshot = n.screenshot;
      // Con lotes, la misma corte puede llegar primero sin dirección y después con una dirección probada.
      if (!previo.address && n.address) previo.address = n.address;
    }
    return n.id;
  }
}

function arista(
  from: string,
  rel: Arista["rel"],
  to: string,
  attrs: Arista["attrs"],
  evidencia: Evidencia[],
  p: { confianza: Confianza; checks: string[] },
): Arista {
  return { id: `${rel}:${from}->${to}`, from, rel, to, attrs, evidence: evidencia, confidence: p.confianza, checks: p.checks, status: "pending" };
}

function evaluarClaim(
  claim: Evidencia["claim"],
  citas: Cita[],
  e: EntradaPaquete,
  g: Grafo,
  reverif: Map<string, Comprobacion> | null,
  requiereDos: boolean,
  fecha: string,
  /** Además de estar en la página, la cita tiene que hablar de lo que se afirma (p. ej. nombrar el condado). */
  pertinente: (c: Cita, rev?: Comprobacion) => boolean = () => true,
): Evaluacion {
  const filas = citas.map((c) => {
    const rev = reverif?.get(claveCita(c.url, c.quote));
    const segunda = rev ? citaVerificada({ ...rev, quote: c.quote }) : null;
    const verificada = (citaVerificada(c) || segunda === true) && pertinente(c, rev);
    const fuente = g.nodo({
      id: idFuente(c.url),
      type: "source",
      label: c.pageTitle || c.url,
      url: c.url,
      domain: dominioDe(c.url),
      retrievedAt: fecha,
      pageSha256: c.pageSha256,
      screenshot: verificada ? e.rutaCaptura(c.screenshotPath) : null,
    });
    const evidencia: Evidencia = { claim, source: fuente, quote: c.quote, snippet: c.snippet, quoteVerified: verificada, secondPassVerified: segunda };
    return { c, rev, evidencia };
  });
  const verificadas = filas.filter((f) => f.evidencia.quoteVerified);
  const oficiales = verificadas.filter((f) => esDominioOficial(f.c.url, e.dominios));
  let segunda: SegundaPasada = "not_run";
  if (reverif && oficiales.length > 0) {
    const estados = oficiales.map((f) => f.evidencia.secondPassVerified);
    if (estados.some((s) => s === false)) segunda = "disagree";
    else if (estados.every((s) => s === true)) segunda = "agree";
  }
  const { confidence, checks } = calcularConfianza({
    quoteVerified: verificadas.length > 0,
    officialDomain: oficiales.length > 0,
    distinctSources: new Set(oficiales.map((f) => urlCanonica(f.c.url))).size,
    requiresTwoSources: requiereDos,
    secondPass: segunda,
  });
  const hashMatch = segunda === "agree" && oficiales.every((f) => f.rev?.pageSha256 === f.c.pageSha256);
  return { evidencias: filas.map((f) => f.evidencia), confianza: confidence, checks: hashMatch ? [...checks, "hash_match"] : checks };
}

function peorDe(partes: Evaluacion[]): { confianza: Confianza; checks: string[] } {
  const confianza = peorConfianza(partes.map((p) => p.confianza));
  const peor = partes.find((p) => p.confianza === confianza);
  return { confianza, checks: peor?.checks ?? [] };
}

function agregarCondados(e: EntradaPaquete, g: Grafo): void {
  const estadoId = `state:${e.estado}`;
  for (const c of e.condados) {
    const id = g.nodo({ id: `county:${c.fips}`, type: "county", label: c.name, fips: c.fips });
    g.aristas.push(arista(id, "county_in_state", estadoId, {}, [], { confianza: "high", checks: ["census_list"] }));
  }
}

/** Añade las reglas del estado y devuelve la mejor confianza de «la vía se presenta en <tipo de corte>». */
function agregarReglas(e: EntradaPaquete, g: Grafo): Confianza | null {
  const r = e.reglas;
  if (!r) return null;
  if (r.status !== "ok" || r.routes.length === 0) {
    const reason =
      r.status === "blocked" ? "state_rules_blocked" : r.status === "no_state_route" ? "state_rules_no_route" : "state_rules_needs_human";
    g.preguntas.push({ county: null, reason, detail: r.notes || r.status });
  } else if (r.notes.trim()) {
    g.preguntas.push({ county: null, reason: "reviewer_note", detail: `Nivel 1: ${r.notes}` });
  }
  const reverif = mapaComprobaciones(e.verificacionReglas);
  const fecha = e.fechas?.reglas ?? e.ahora;
  const estadoId = `state:${e.estado}`;
  let mejorTipo: Confianza | null = null;
  for (const via of r.routes) {
    if (!via.route.value) {
      g.preguntas.push({ county: null, reason: "missing_claim", detail: `Vía ${via.key}: falta el nombre de la vía` });
      continue;
    }
    const nombreVia = via.route.value;
    const faltan = [
      ["courtType", via.courtType.value],
      ["ageLimitExclusive", via.ageLimitExclusive.value],
      ["venueRule", via.venueRule.value],
    ].filter(([, v]) => !v);
    for (const [campo] of faltan) g.preguntas.push({ county: null, reason: "missing_claim", detail: `Vía «${nombreVia}»: falta ${campo}` });
    const rutaId = g.nodo({ id: idVia(e.estado, via.key), type: "procedural_route", label: nombreVia });
    const partes: Evaluacion[] = [evaluarClaim("route", via.route.citations, e, g, reverif, true, fecha)];
    if (via.ageLimitExclusive.value) partes.push(evaluarClaim("age", via.ageLimitExclusive.citations, e, g, reverif, true, fecha));
    if (via.venueRule.value) partes.push(evaluarClaim("venue", via.venueRule.citations, e, g, reverif, true, fecha));
    const edad = via.ageLimitExclusive.value ? Number.parseInt(via.ageLimitExclusive.value, 10) : Number.NaN;
    g.aristas.push(
      arista(
        estadoId,
        "allows_route",
        rutaId,
        { ageLimitExclusive: Number.isFinite(edad) ? edad : null, venueRule: via.venueRule.value },
        partes.flatMap((p) => p.evidencias),
        peorDe(partes),
      ),
    );
    if (via.courtType.value) {
      const tipoId = g.nodo({ id: idTipoCorte(e.estado, via.courtType.value), type: "court_type", label: via.courtType.value });
      const p = evaluarClaim("court_type", via.courtType.citations, e, g, reverif, true, fecha);
      g.aristas.push(arista(rutaId, "route_filed_in", tipoId, {}, p.evidencias, p));
      mejorTipo = mejor(mejorTipo, p.confianza);
    }
  }
  return mejorTipo;
}

function sinAcentos(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ");
}

/** «Doña Ana County» → «dona ana»; «Richmond city» → «richmond»; «St. Louis County» → «st louis». */
export function nucleoCondado(nombre: string): string {
  return sinAcentos(nombre)
    .replace(/ (county|parish|borough|city and borough|census area|municipality|planning region|city)$/, "")
    .trim();
}

export function nombraCondado(nombre: string, texto: string): boolean {
  const n = nucleoCondado(nombre);
  if (n.length === 0) return false;
  const t = sinAcentos(texto);
  // Las fuentes juntan o separan palabras del nombre («DeBaca», «De Kalb», «La Salle»).
  return t.includes(n) || t.replace(/ /g, "").includes(n.replace(/ /g, ""));
}

function agregarCortes(e: EntradaPaquete, g: Grafo, topeTipo: Confianza | null): void {
  const r = e.cortes;
  if (!r) return;
  if (r.notes.trim()) g.preguntas.push({ county: null, reason: "reviewer_note", detail: `Nivel 2 (${r.status}): ${r.notes}` });
  const reverif = mapaComprobaciones(e.verificacionCortes);
  const muestraFallida = e.verificacionCortes ? muestraFalla(e.verificacionCortes) : false;
  if (muestraFallida) {
    g.preguntas.push({
      county: null,
      reason: "sample_failed",
      detail: "La re-verificación de la muestra del nivel 2 encontró citas que ya no aparecen: todas las cortes por condado bajan a confianza baja.",
    });
  }
  const fecha = e.fechas?.cortes ?? e.ahora;

  const cortes = new Map<string, string>();
  const clavesEnConflicto = new Set<string>();
  for (const c of r.courts) {
    const nombre = c.name || c.key;
    const id = idCorte(e.estado, nombre);
    const previo = cortes.get(c.key);
    if (previo !== undefined && previo !== id) {
      clavesEnConflicto.add(c.key);
      g.preguntas.push({ county: null, reason: "conflicting_court_key", detail: `La clave ${c.key} nombra cortes distintas` });
      continue;
    }
    const direccionProbada = c.address !== null && c.citations.some((x) => citaVerificada(x) && esDominioOficial(x.url, e.dominios));
    g.nodo({ id, type: "court", label: nombre, ...(direccionProbada && c.address ? { address: c.address } : {}) });
    cortes.set(c.key, id);
  }

  const validos = new Set(e.condados.map((c) => c.fips));
  const grupos = new Map<string, CondadoAsignado[]>();
  for (const a of r.counties) {
    if (!validos.has(a.fips)) {
      g.preguntas.push({ county: null, reason: "unknown_fips", detail: `FIPS ${a.fips} no pertenece a ${e.estado}` });
      continue;
    }
    grupos.set(a.fips, [...(grupos.get(a.fips) ?? []), a]);
  }

  const resolver = (k: string): string => (cortes.has(k) && !clavesEnConflicto.has(k) ? cortes.get(k)! : `?${k}`);
  const nombres = new Map(e.condados.map((c) => [c.fips, c.name]));
  for (const [fips, entradas] of grupos) {
    // Se comparan cortes resueltas, no claves: dos lotes nombran la misma corte con claves distintas.
    const firmas = new Map(entradas.map((x) => [[...new Set(x.candidateCourtKeys.map(resolver))].sort().join("+"), [...x.candidateCourtKeys].sort().join("+")]));
    if (firmas.size > 1) {
      g.preguntas.push({ county: fips, reason: "conflicting_assignments", detail: [...firmas.values()].map((f) => f || "(ninguna)").join(" / ") });
      continue;
    }
    const claves = entradas[0]!.candidateCourtKeys;
    const sinResolver = claves.filter((k) => !cortes.has(k) || clavesEnConflicto.has(k));
    if (claves.length === 0 || sinResolver.length > 0) {
      const detalle = sinResolver.length > 0 ? `Claves sin corte: ${sinResolver.join(", ")}` : "Sin corte en las fuentes oficiales";
      g.preguntas.push({ county: fips, reason: "court_not_found", detail: detalle });
      continue;
    }
    const candidatos = [...new Set(claves.map((k) => cortes.get(k)!))];
    if (candidatos.length > 1) {
      const nombres = candidatos.map((id) => g.nodos.get(id)?.label ?? id).join("; ");
      g.preguntas.push({ county: fips, reason: "multiple_courts_no_official_rule", detail: nombres });
      continue;
    }
    const citas = entradas.flatMap((x) => x.citations);
    const nombre = nombres.get(fips) ?? "";
    const p = evaluarClaim("county_court", citas, e, g, reverif, false, fecha, (c, rev) =>
      nombraCondado(nombre, `${c.quote} ${c.snippet} ${rev?.snippet ?? ""}`),
    );
    const checks = [...p.checks];
    let confianza = p.confianza;
    if (!p.evidencias.some((x) => x.quoteVerified) && citas.some((x) => citaVerificada(x))) {
      confianza = "low";
      checks.push("county_not_named");
    }
    if (topeTipo === null) {
      confianza = "low";
      checks.push("court_type_unverified");
    } else {
      confianza = peorConfianza([confianza, topeTipo]);
    }
    if (muestraFallida) {
      confianza = "low";
      checks.push("sample_failed");
    }
    g.aristas.push(arista(`county:${fips}`, "county_served_by", candidatos[0]!, {}, p.evidencias, { confianza, checks }));
    const sedes = [...new Set(entradas.flatMap((x) => x.branchNames))];
    if (sedes.length > 1) g.preguntas.push({ county: fips, reason: "multiple_branches_no_official_rule", detail: sedes.join("; ") });
  }

  for (const c of e.condados) {
    if (!grupos.has(c.fips)) g.preguntas.push({ county: c.fips, reason: "not_researched", detail: c.name });
  }
}

export function construirPaquete(e: EntradaPaquete): Paquete {
  const g = new Grafo();
  g.nodo({ id: `state:${e.estado}`, type: "state", label: e.nombre });
  agregarCondados(e, g);
  const topeTipo = agregarReglas(e, g);
  agregarCortes(e, g, topeTipo);
  return Paquete.parse({
    schemaVersion: "1.0",
    state: e.estado,
    generatedAt: e.ahora,
    nodes: [...g.nodos.values()],
    edges: g.aristas,
    openQuestions: g.preguntas,
  });
}
