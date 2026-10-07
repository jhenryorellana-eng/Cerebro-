import { spawn } from "node:child_process";
import { z } from "zod";

export class LimiteDeUsoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "LimiteDeUsoError";
  }
}

export class ErrorDeClaude extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeClaude";
  }
}

export interface OpcionesClaude {
  prompt: string;
  chrome: boolean;
  /** Herramientas integradas habilitadas (p. ej. ["WebSearch"]); [] = ninguna. */
  herramientas: string[];
  /** Valor de --allowedTools (p. ej. ["WebSearch", "mcp__claude-in-chrome"]). */
  permitidas: string[];
  modelo?: string;
  sistemaArchivo?: string;
  timeoutMs?: number;
}

export interface Respuesta<T> {
  data: T;
  costUsd: number;
  durationMs: number;
}

export type Lanzador = (
  args: string[],
  entrada: string,
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const PATRON_LIMITE = /usage limit|rate limit|limit reached|resets? (at|in)?/i;

/** La salida estructurada exige objetos cerrados: se fuerza additionalProperties:false en todos los niveles. */
function cerrarObjetos(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(cerrarObjetos);
  if (nodo !== null && typeof nodo === "object") {
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(nodo)) salida[clave] = cerrarObjetos(valor);
    if (salida.type === "object" && salida.properties !== undefined && salida.additionalProperties === undefined) {
      salida.additionalProperties = false;
    }
    return salida;
  }
  return nodo;
}

export function esquemaJson(esquema: z.ZodType): Record<string, unknown> {
  const { $schema: _omitido, ...resto } = z.toJSONSchema(esquema) as Record<string, unknown>;
  return cerrarObjetos(resto) as Record<string, unknown>;
}

export function construirArgs(o: OpcionesClaude, esquema: object): string[] {
  const args = [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--model", o.modelo ?? "sonnet",
    "--append-system-prompt-file", o.sistemaArchivo ?? "prompts/sistema.md",
    "--json-schema", JSON.stringify(esquema),
    "--tools", o.herramientas.join(","),
  ];
  if (o.permitidas.length > 0) args.push("--allowedTools", o.permitidas.join(","));
  if (o.chrome) args.push("--chrome");
  return args;
}

export function interpretarSalida<T>(stdout: string, esquema: z.ZodType<T>): Respuesta<T> {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new ErrorDeClaude(`La salida de Claude no es JSON: ${stdout.slice(0, 300)}`);
  }
  const texto = String(j.result ?? "");
  if (j.is_error === true) {
    if (j.api_error_status === 429 || PATRON_LIMITE.test(texto)) throw new LimiteDeUsoError(texto.slice(0, 300));
    throw new ErrorDeClaude(`Claude devolvió error (${String(j.subtype)}): ${texto.slice(0, 300)}`);
  }
  if ((j.structured_output === null || j.structured_output === undefined) && PATRON_LIMITE.test(texto)) {
    throw new LimiteDeUsoError(texto.slice(0, 300));
  }
  const r = esquema.safeParse(j.structured_output);
  if (!r.success) throw new ErrorDeClaude(`La respuesta no cumple el esquema: ${r.error.message.slice(0, 500)}`);
  return { data: r.data, costUsd: Number(j.total_cost_usd ?? 0), durationMs: Number(j.duration_ms ?? 0) };
}

export const lanzarReal: Lanzador = (args, entrada, timeoutMs) =>
  new Promise((resolve, reject) => {
    const hijo = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const reloj = setTimeout(() => {
      hijo.kill();
      reject(new ErrorDeClaude(`Tiempo agotado tras ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    hijo.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    hijo.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    hijo.on("error", (err) => {
      clearTimeout(reloj);
      reject(err);
    });
    hijo.on("close", (code) => {
      clearTimeout(reloj);
      resolve({ stdout, stderr, code });
    });
    hijo.stdin.end(entrada, "utf8");
  });

export async function preguntarClaude<T>(
  o: OpcionesClaude,
  esquema: z.ZodType<T>,
  lanzar: Lanzador = lanzarReal,
): Promise<Respuesta<T>> {
  const args = construirArgs(o, esquemaJson(esquema));
  const { stdout, stderr, code } = await lanzar(args, o.prompt, o.timeoutMs ?? 15 * 60_000);
  if (!stdout.trim()) throw new ErrorDeClaude(`Claude terminó (código ${code}) sin salida: ${stderr.slice(0, 300)}`);
  return interpretarSalida(stdout, esquema);
}
