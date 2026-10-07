import { ResultadoReglas } from "../esquemas.js";
import { lanzarReal, preguntarClaude, type Lanzador, type Respuesta } from "../ia.js";
import { bloqueVerificador, NAVEGADOR, REGLA_URL } from "./comun.js";

export function promptReglas(estado: string, nombre: string, dominios: string[]): string {
  return [
    `TAREA — Reglas estatales SIJS de ${nombre} (${estado}).`,
    "",
    `Averigua, SOLO con fuentes oficiales de ${nombre}, qué vía o vías procesales del estado permiten obtener una orden con los hallazgos (findings) que USCIS exige para Special Immigrant Juvenile Status (SIJS). Para cada vía:`,
    '- route: nombre de la vía (p. ej. "Petition for Special Findings (Utah Code §80-3-505)", "Guardianship of a minor", "Custody").',
    '- courtType: tipo de corte estatal que la ve (p. ej. "Juvenile Court", "Family Court", "Probate Court", "Juvenile and Domestic Relations District Court").',
    '- ageLimitExclusive: edad límite exclusiva como número en texto: "21" si la norma dice menores de 21; "18" si solo menores de 18. null si no hay evidencia.',
    '- venueRule: dónde se presenta (p. ej. "county where the child resides").',
    "Busca también legislación VIGENTE que cambie algo (no te quedes en jurisprudencia antigua). Si el estado no tiene vía SIJS propia, di qué vías generales (custodia, tutela, dependencia) usan las fuentes oficiales para estos hallazgos.",
    "",
    `Dominios oficiales permitidos: ${dominios.join(", ")}. Usa WebSearch con allowed_domains = esa lista.`,
    "",
    "Cómo trabajar:",
    "1. Llama a tabs_context_mcp con createIfEmpty=true y trabaja en pestañas nuevas solo tuyas.",
    "2. Por cada página útil: navega, lee el texto (get_page_text) y elige citas LITERALES cortas que prueben cada dato. Prefiere dos fuentes distintas por dato (p. ej. el estatuto y la página de autoayuda de la corte).",
    "3. En esa página, en UNA sola ejecución de javascript_tool, pega el código fijo y llama a verificar con todas las citas de esa página:",
    bloqueVerificador(),
    '4. Por cada cita con found=true: ejecuta el código fijo + `window.__rec.resaltar("cita")`, haz computer→screenshot con save_to_disk=true y pon la ruta devuelta en screenshotPath (null si no hay ruta).',
    "5. Espera 3 s entre páginas del mismo dominio. Cierra tus pestañas al terminar.",
    "",
    "Salida (JSON):",
    '- status: "ok" si hay al menos una vía con evidencia; "no_state_route" si las fuentes oficiales dicen que no hay vía clara; "blocked" si las fuentes oficiales te bloquean; "needs_human" si se contradicen.',
    "- routes: una entrada por vía. key = identificador corto en minúsculas con guiones. Cada dato lleva value y citations. Sin evidencia para un dato: value null y citations [].",
    `- En citations: ${REGLA_URL}; quote, found, snippet y pageSha256 del resultado de verificar; pageTitle = su title. Incluye también las citas con found=false: no las borres.`,
    "- notes: lo que un revisor humano deba saber, en español, máximo 5 frases.",
  ].join("\n");
}

export function investigarReglas(
  estado: string,
  nombre: string,
  dominios: string[],
  lanzar: Lanzador = lanzarReal,
): Promise<Respuesta<ResultadoReglas>> {
  return preguntarClaude(
    {
      prompt: promptReglas(estado, nombre, dominios),
      chrome: true,
      herramientas: ["WebSearch"],
      permitidas: ["WebSearch", NAVEGADOR],
      timeoutMs: 20 * 60_000,
    },
    ResultadoReglas,
    lanzar,
  );
}
