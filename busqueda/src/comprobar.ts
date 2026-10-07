import type { Cita, Comprobacion, ResultadoVerificacion } from "./esquemas.js";
import type { Captura } from "./navegador.js";
import { normalizar } from "./normalizar.js";
import { agruparPorUrl, type CitaAVerificar } from "./tareas/verificarCitas.js";

/** Mismo formato que el verificador en página (8 bloques de 8), que es lo que exige citaVerificada. */
export function agruparHash(hex: string): string {
  return hex ? (hex.match(/.{1,8}/g) ?? []).join("-") : "";
}

export function buscarCita(texto: string, quote: string): { found: boolean; snippet: string } {
  const q = normalizar(quote);
  const i = q.length > 0 ? texto.indexOf(q) : -1;
  if (i < 0) return { found: false, snippet: "" };
  return { found: true, snippet: texto.slice(Math.max(0, i - 150), i + q.length + 150) };
}

/** La IA solo propone url + cita; found, fragmento, hash y captura los pone el código. */
export function citaDesdeCaptura(url: string, quote: string, capturas: Map<string, Captura>): Cita {
  const c = capturas.get(url);
  if (!c || c.problema !== null) {
    return { url, quote, found: false, snippet: "", pageSha256: "", pageTitle: c?.title ?? "", screenshotPath: null };
  }
  const r = buscarCita(c.texto, quote);
  return { url, quote, found: r.found, snippet: r.snippet, pageSha256: agruparHash(c.sha256), pageTitle: c.title, screenshotPath: c.capturaPath };
}

export async function reverificarConCodigo(
  citas: CitaAVerificar[],
  capturar: (url: string) => Promise<Captura>,
): Promise<ResultadoVerificacion> {
  const checks: Comprobacion[] = [];
  for (const [url, quotes] of agruparPorUrl(citas)) {
    const c = await capturar(url);
    for (const quote of quotes) {
      if (c.problema !== null) {
        checks.push({ url, quote, found: false, snippet: c.problema === "bloqueada" ? "BLOCKED" : c.problema.toUpperCase(), pageSha256: "" });
        continue;
      }
      const r = buscarCita(c.texto, quote);
      checks.push({ url, quote, found: r.found, snippet: r.snippet, pageSha256: agruparHash(c.sha256) });
    }
  }
  return { checks };
}

/** Bloqueo o error al volver a capturar: no dice nada de la cita, así que se repite al reanudar. */
export function hayBloqueos(v?: ResultadoVerificacion): boolean {
  return v?.checks.some((c) => c.snippet === "BLOCKED" || c.snippet === "ERROR") ?? false;
}
