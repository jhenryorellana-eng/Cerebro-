import { z } from "zod";
import { preguntarClaude } from "./ia.js";
import { codigoVerificador } from "./scriptPagina.js";

const Salida = z.strictObject({ title: z.string(), found: z.boolean(), pageSha256: z.string() });

const prompt = [
  "Llama a tabs_context_mcp con createIfEmpty=true, abre una pestaña nueva tuya y navega a",
  "https://le.utah.gov/xcode/Title80/Chapter3/80-3-S505.html .",
  "Ejecuta con javascript_tool, en UNA sola ejecución, este código seguido de la llamada:",
  "```js",
  codigoVerificador(),
  'await window.__rec.verificar(["younger than 21 years old"])',
  "```",
  "Cierra la pestaña. Devuelve title, found (de results[0]) y pageSha256 TAL CUAL.",
].join("\n");

const r = await preguntarClaude({ prompt, chrome: true, herramientas: [], permitidas: ["mcp__claude-in-chrome"] }, Salida);
console.log(JSON.stringify(r, null, 2));
if (!r.data.found || !/^([0-9a-f]{8}-){7}[0-9a-f]{8}$/.test(r.data.pageSha256)) {
  console.error("✘ La sonda no encontró la cita o el hash no es válido.");
  process.exitCode = 1;
} else {
  console.log("✔ Sonda correcta: la sesión maneja Brave y el verificador funciona dentro de la página.");
}
