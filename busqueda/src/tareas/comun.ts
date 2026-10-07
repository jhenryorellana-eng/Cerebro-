import { codigoVerificador } from "../scriptPagina.js";

export const NAVEGADOR = "mcp__claude-in-chrome";

export const REGLA_URL =
  "url = la URL exacta a la que navegaste (no la copies del resultado de verificar: la extensión del navegador oculta las URLs con parámetros)";

export function bloqueVerificador(): string {
  return [
    "Código fijo de verificación (pégalo TAL CUAL al principio de cada ejecución de javascript_tool):",
    "```js",
    codigoVerificador(),
    "```",
    'Después del código, en la MISMA ejecución: `await window.__rec.verificar(["cita 1", "cita 2"])` → devuelve { url, title, pageSha256, length, results: [{ quote, found, snippet }] }.',
    'Para resaltar una cita antes de una captura: el código fijo + `window.__rec.resaltar("cita")`.',
  ].join("\n");
}
