import type { Condado } from "../condados.js";
import { ResultadoCortes } from "../esquemas.js";
import { lanzarReal, preguntarClaude, type Lanzador, type Respuesta } from "../ia.js";
import { bloqueVerificador, NAVEGADOR, REGLA_URL } from "./comun.js";

export function promptCortes(
  estado: string,
  nombre: string,
  dominios: string[],
  condados: Condado[],
  tipoCorte: string | null,
): string {
  const lista = condados.map((c) => `${c.fips} — ${c.name}`).join("\n");
  return [
    `TAREA — Corte que atiende cada condado de ${nombre} (${estado}).`,
    "",
    `Tipo de corte que ve la vía SIJS en ${nombre}: ${tipoCorte ?? "desconocido (averígualo primero en las fuentes oficiales)"}.`,
    "Para CADA condado de la lista, identifica qué corte de ese tipo lo atiende, usando el directorio oficial de cortes del estado. Casi todos los estados publican un directorio que lista las cortes por condado: léelo una vez y úsalo para todos los condados.",
    "",
    `Dominios oficiales permitidos: ${dominios.join(", ")}. Usa WebSearch con allowed_domains = esa lista.`,
    "",
    `Condados (FIPS — nombre), en total ${condados.length}:`,
    lista,
    "",
    "Cómo trabajar:",
    "1. Llama a tabs_context_mcp con createIfEmpty=true y trabaja en pestañas nuevas solo tuyas.",
    "2. Por cada condado elige una cita LITERAL corta del texto oficial que relacione el condado con su corte (idealmente una línea que contenga el nombre del condado y el de la corte o su dirección).",
    "3. En cada página, en UNA ejecución de javascript_tool, pega el código fijo y verifica TODAS las citas de esa página de una vez:",
    bloqueVerificador(),
    '4. Haz UNA captura por página de directorio: código fijo + `window.__rec.resaltar("<primera cita encontrada>")`, computer→screenshot con save_to_disk=true, y pon esa ruta en screenshotPath de esa cita; en las demás citas screenshotPath = null.',
    "5. Espera 3 s entre páginas del mismo dominio. Cierra tus pestañas al terminar.",
    "",
    "Salida (JSON):",
    "- courts: cada corte encontrada, con key (minúsculas con guiones), name, address (null si no consta) y citations que prueben nombre o dirección.",
    "- counties: UNA entrada por CADA FIPS de la lista, sin omitir ninguno. candidateCourtKeys: la clave de la corte que lo atiende; si la fuente oficial asigna más de una corte y no dice cuál, pon todas; si no encuentras ninguna, []. branchNames: sedes físicas de esa corte que la fuente oficial asocia al condado (si hay varias y ninguna regla oficial dice qué ciudad va a cuál, ponlas todas; nunca elijas por cercanía). citations: las citas de ese condado.",
    `- En citations: ${REGLA_URL}; quote, found, snippet y pageSha256 del resultado de verificar; pageTitle = su title. Incluye también las citas con found=false.`,
    '- status: "ok", "partial" (faltan condados), "blocked" o "needs_human". notes en español, máximo 5 frases.',
  ].join("\n");
}

export function investigarCortes(
  estado: string,
  nombre: string,
  dominios: string[],
  condados: Condado[],
  tipoCorte: string | null,
  lanzar: Lanzador = lanzarReal,
): Promise<Respuesta<ResultadoCortes>> {
  return preguntarClaude(
    {
      prompt: promptCortes(estado, nombre, dominios, condados, tipoCorte),
      chrome: true,
      herramientas: ["WebSearch"],
      permitidas: ["WebSearch", NAVEGADOR],
      timeoutMs: timeoutCortesMs(condados.length),
    },
    ResultadoCortes,
    lanzar,
  );
}

/** Tiempo máximo de la sesión de nivel 2: 40 min mínimo, y crece con el número de condados (medido: UT, 29 condados, 21 min). */
export function timeoutCortesMs(numCondados: number): number {
  return Math.max(40, 20 + Math.ceil(0.75 * numCondados)) * 60_000;
}

/** Muestra determinista para la re-verificación: 10 % de los condados (mínimo 3), repartida por FIPS. */
export function muestraDe<T extends { fips: string }>(items: T[], fraccion = 0.1, minimo = 3): T[] {
  const orden = [...items].sort((a, b) => a.fips.localeCompare(b.fips));
  if (orden.length <= minimo) return orden;
  const n = Math.min(orden.length, Math.max(minimo, Math.ceil(orden.length * fraccion)));
  const paso = orden.length / n;
  return Array.from({ length: n }, (_, i) => orden[Math.floor(i * paso)]!);
}
