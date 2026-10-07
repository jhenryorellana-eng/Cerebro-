import { z } from "zod";
import { esDominioOficial } from "../fuentes.js";
import { lanzarReal, preguntarClaude, type Lanzador, type Respuesta } from "../ia.js";
import { urlCanonica } from "../paquete.js";

/** Sin navegador ni verificador en página: el código captura y comprueba. */
export const SISTEMA_V2 = "prompts/sistema-v2.md";

export const ResultadoDescubrir = z.strictObject({
  urls: z.array(z.strictObject({ url: z.string(), motivo: z.string() })),
  notes: z.string(),
});
export type ResultadoDescubrir = z.infer<typeof ResultadoDescubrir>;

export function objetivoReglas(nombre: string, estado: string): string {
  return `Objetivo: páginas oficiales de ${nombre} (${estado}) que digan qué vía procesal estatal permite obtener los hallazgos (findings) que USCIS exige para Special Immigrant Juvenile Status (SIJS), qué tipo de corte la ve, hasta qué edad y en qué condado se presenta. Prioriza el estatuto vigente y la página de autoayuda de la corte.`;
}

export function objetivoDirectorio(nombre: string, estado: string, tipoCorte: string | null): string {
  return `Objetivo: el directorio oficial de cortes de ${nombre} (${estado}) que permita saber qué corte${tipoCorte ? ` de tipo «${tipoCorte}»` : ""} atiende cada condado (mapa de distritos judiciales, listado de cortes por condado, páginas de cada distrito).`;
}

export function promptDescubrir(objetivo: string, dominios: string[]): string {
  return [
    "TAREA — Encontrar páginas oficiales. No navegues: usa solo WebSearch.",
    objetivo,
    `Busca con WebSearch usando allowed_domains = ${dominios.join(", ")}. Devuelve solo URLs de esos dominios.`,
    "Como mucho 8 URLs, las más útiles primero, cada una con su motivo en una frase.",
    "notes: en español, máximo 3 frases.",
  ].join("\n");
}

export function descubrir(objetivo: string, dominios: string[], lanzar: Lanzador = lanzarReal, modelo?: string): Promise<Respuesta<ResultadoDescubrir>> {
  return preguntarClaude(
    { prompt: promptDescubrir(objetivo, dominios), chrome: false, herramientas: ["WebSearch"], permitidas: ["WebSearch"], sistemaArchivo: SISTEMA_V2, timeoutMs: 10 * 60_000, ...(modelo ? { modelo } : {}) },
    ResultadoDescubrir,
    lanzar,
  );
}

export function filtrarUrls(urls: string[], dominios: string[], maximo = 8): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const u of urls) {
    if (!esDominioOficial(u, dominios)) continue;
    const clave = urlCanonica(u);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(u);
    if (salida.length >= maximo) break;
  }
  return salida;
}
