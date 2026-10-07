import { ResultadoVerificacion, type Cita } from "../esquemas.js";
import { esDominioOficial } from "../fuentes.js";
import { lanzarReal, preguntarClaude, type Lanzador, type Respuesta } from "../ia.js";
import { normalizar } from "../normalizar.js";
import { bloqueVerificador, NAVEGADOR } from "./comun.js";

export interface CitaAVerificar {
  url: string;
  quote: string;
}

export function claveCita(url: string, quote: string): string {
  return `${url}\u0000${normalizar(quote)}`;
}

export function citasVerificables(citas: Cita[], dominios: string[]): CitaAVerificar[] {
  const vistas = new Set<string>();
  const salida: CitaAVerificar[] = [];
  for (const c of citas) {
    if (!c.found || !esDominioOficial(c.url, dominios)) continue;
    const clave = claveCita(c.url, c.quote);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push({ url: c.url, quote: c.quote });
  }
  return salida;
}

export function agruparPorUrl(citas: CitaAVerificar[]): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const c of citas) grupos.set(c.url, [...(grupos.get(c.url) ?? []), c.quote]);
  return grupos;
}

export function promptVerificacion(citas: CitaAVerificar[]): string {
  const grupos = [...agruparPorUrl(citas)].map(([url, qs]) => `- ${url}\n  citas: ${JSON.stringify(qs)}`).join("\n");
  return [
    "TAREA — Re-verificación independiente de citas.",
    "No investigues ni busques nada. Para CADA URL de la lista: llama a tabs_context_mcp con createIfEmpty=true, ábrela en una pestaña nueva tuya, ejecuta en UNA sola ejecución de javascript_tool el código fijo seguido de `await window.__rec.verificar(<exactamente sus citas>)` y copia el resultado.",
    bloqueVerificador(),
    'Si una página no carga o te bloquea, devuelve sus citas con found=false, snippet "BLOCKED" y pageSha256 "".',
    "Cierra tus pestañas al terminar. Espera 3 s entre páginas del mismo dominio.",
    "",
    "URLs y citas:",
    grupos,
    "",
    "Salida (JSON): checks = una entrada por cada cita de la lista (url y quote EXACTAMENTE como te los di, found, snippet, pageSha256).",
  ].join("\n");
}

export function reverificar(
  citas: CitaAVerificar[],
  lanzar: Lanzador = lanzarReal,
): Promise<Respuesta<ResultadoVerificacion>> {
  return preguntarClaude(
    { prompt: promptVerificacion(citas), chrome: true, herramientas: [], permitidas: [NAVEGADOR], timeoutMs: 20 * 60_000 },
    ResultadoVerificacion,
    lanzar,
  );
}

export function mapaReverificacion(v?: ResultadoVerificacion): Map<string, boolean> | null {
  if (!v) return null;
  const mapa = new Map<string, boolean>();
  for (const c of v.checks) mapa.set(claveCita(c.url, c.quote), c.found);
  return mapa;
}

export function muestraFalla(v: ResultadoVerificacion): boolean {
  return v.checks.some((c) => !c.found);
}
