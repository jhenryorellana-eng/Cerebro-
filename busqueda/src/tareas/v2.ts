import type { Condado } from "../condados.js";
import type { ResultadoCortes, ResultadoReglas } from "../esquemas.js";
import { lanzarReal, preguntarClaude, type Lanzador, type Respuesta } from "../ia.js";
import type { Captura } from "../navegador.js";
import { descubrir, filtrarUrls, objetivoDirectorio, objetivoReglas, SISTEMA_V2 } from "./descubrir.js";
import { aResultadoCortes, aResultadoReglas, CortesPropuestas, promptExtraerCortes, promptExtraerReglas, ReglasPropuestas } from "./extraer.js";

export interface DependenciasV2 {
  lanzar?: Lanzador;
  capturar: (url: string) => Promise<Captura>;
}

async function capturarTodas(urls: string[], deps: DependenciasV2, capturas: Map<string, Captura>): Promise<void> {
  for (const url of urls) {
    if (capturas.has(url)) continue;
    const c = await deps.capturar(url);
    capturas.set(url, c);
    if (c.finalUrl !== url) capturas.set(c.finalUrl, c);
  }
}

function unicas(capturas: Map<string, Captura>): Captura[] {
  return [...new Set(capturas.values())];
}

function validas(capturas: Map<string, Captura>): Captura[] {
  return unicas(capturas).filter((c) => c.problema === null);
}

function notasDeProblemas(capturas: Map<string, Captura>): string {
  const malas = unicas(capturas).filter((c) => c.problema !== null);
  return malas.length > 0 ? `Páginas con problema: ${malas.map((c) => `${c.url} (${c.problema})`).join("; ")}.` : "";
}

export async function investigarReglasV2(estado: string, nombre: string, dominios: string[], deps: DependenciasV2): Promise<Respuesta<ResultadoReglas>> {
  const lanzar = deps.lanzar ?? lanzarReal;
  const d = await descubrir(objetivoReglas(nombre, estado), dominios, lanzar);
  let costUsd = d.costUsd;
  let durationMs = d.durationMs;
  const capturas = new Map<string, Captura>();
  let pendientes = filtrarUrls(d.data.urls.map((u) => u.url), dominios);
  let propuesta: ReglasPropuestas | null = null;
  for (let ronda = 0; ronda < 3; ronda++) {
    await capturarTodas(pendientes, deps, capturas);
    const utiles = validas(capturas);
    if (utiles.length === 0) break;
    const r = await preguntarClaude(
      { prompt: promptExtraerReglas(estado, nombre, utiles), chrome: false, herramientas: [], permitidas: [], sistemaArchivo: SISTEMA_V2, timeoutMs: 15 * 60_000 },
      ReglasPropuestas,
      lanzar,
    );
    costUsd += r.costUsd;
    durationMs += r.durationMs;
    propuesta = r.data;
    pendientes = filtrarUrls(r.data.masUrls, dominios, 5).filter((u) => !capturas.has(u));
    if (pendientes.length === 0) break;
  }
  const extra = notasDeProblemas(capturas);
  const data: ResultadoReglas = propuesta
    ? aResultadoReglas(propuesta, capturas, extra)
    : { status: "blocked", notes: [d.data.notes, extra || "No se pudo capturar ninguna página oficial."].filter(Boolean).join(" "), routes: [] };
  return { data, costUsd, durationMs };
}

export async function prepararDirectorio(
  estado: string,
  nombre: string,
  dominios: string[],
  tipoCorte: string | null,
  deps: DependenciasV2,
): Promise<Respuesta<Captura[]>> {
  const d = await descubrir(objetivoDirectorio(nombre, estado, tipoCorte), dominios, deps.lanzar ?? lanzarReal);
  const capturas = new Map<string, Captura>();
  await capturarTodas(filtrarUrls(d.data.urls.map((u) => u.url), dominios), deps, capturas);
  return { data: unicas(capturas), costUsd: d.costUsd, durationMs: d.durationMs };
}

export async function investigarLoteV2(
  estado: string,
  nombre: string,
  dominios: string[],
  lote: Condado[],
  tipoCorte: string | null,
  directorio: Captura[],
  deps: DependenciasV2,
  cortesPrevias: string[] = [],
): Promise<Respuesta<ResultadoCortes>> {
  const lanzar = deps.lanzar ?? lanzarReal;
  const capturas = new Map<string, Captura>();
  for (const c of directorio) {
    capturas.set(c.url, c);
    capturas.set(c.finalUrl, c);
  }
  let costUsd = 0;
  let durationMs = 0;
  let propuesta: CortesPropuestas | null = null;
  for (let ronda = 0; ronda < 2; ronda++) {
    const utiles = validas(capturas);
    if (utiles.length === 0) break;
    const r = await preguntarClaude(
      { prompt: promptExtraerCortes(estado, nombre, utiles, lote, tipoCorte, cortesPrevias), chrome: false, herramientas: [], permitidas: [], sistemaArchivo: SISTEMA_V2, timeoutMs: 20 * 60_000 },
      CortesPropuestas,
      lanzar,
    );
    costUsd += r.costUsd;
    durationMs += r.durationMs;
    propuesta = r.data;
    const pendientes = filtrarUrls(r.data.masUrls, dominios, 5).filter((u) => !capturas.has(u));
    if (pendientes.length === 0) break;
    await capturarTodas(pendientes, deps, capturas);
  }
  let extra = notasDeProblemas(capturas);
  if (propuesta) {
    // Un condado ajeno al lote lo responde su propio lote: aquí solo generaría conflictos falsos.
    const delLote = new Set(lote.map((c) => c.fips));
    const ajenos = propuesta.counties.filter((c) => !delLote.has(c.fips)).map((c) => c.fips);
    if (ajenos.length > 0) {
      propuesta = { ...propuesta, counties: propuesta.counties.filter((c) => delLote.has(c.fips)) };
      extra = [extra, `Condados fuera del lote descartados: ${ajenos.join(", ")}.`].filter(Boolean).join(" ");
    }
  }
  const data: ResultadoCortes = propuesta
    ? aResultadoCortes(propuesta, capturas, extra)
    : { status: "blocked", notes: extra || "No hay páginas de directorio capturadas.", courts: [], counties: [] };
  return { data, costUsd, durationMs };
}

export function dividirEnLotes<T>(items: T[], tam = 25): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tam) lotes.push(items.slice(i, i + tam));
  return lotes;
}

/** Las claves de corte se prefijan por lote; el grafo unifica las cortes por nombre (idCorte). */
export function fusionarLotes(lotes: ResultadoCortes[]): ResultadoCortes {
  const estados = lotes.map((l) => l.status);
  const status: ResultadoCortes["status"] = estados.every((s) => s === "ok") ? "ok" : estados.includes("needs_human") ? "needs_human" : "partial";
  return {
    status,
    notes: lotes.map((l, i) => (l.notes.trim() ? `Lote ${i + 1}: ${l.notes}` : "")).filter(Boolean).join(" "),
    courts: lotes.flatMap((l, i) => l.courts.map((c) => ({ ...c, key: `L${i + 1}:${c.key}` }))),
    counties: lotes.flatMap((l, i) => l.counties.map((c) => ({ ...c, candidateCourtKeys: c.candidateCourtKeys.map((k) => `L${i + 1}:${k}`) }))),
  };
}
