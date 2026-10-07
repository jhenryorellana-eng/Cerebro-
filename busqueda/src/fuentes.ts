import { readFileSync } from "node:fs";

export type ListaFuentes = Record<string, string[]>;

export const RUTA_FUENTES = "data/fuentes.json";

export function cargarFuentes(ruta: string = RUTA_FUENTES): ListaFuentes {
  return JSON.parse(readFileSync(ruta, "utf8")) as ListaFuentes;
}

export function dominiosDe(lista: ListaFuentes, estado: string): string[] {
  const dominios = lista[estado];
  if (!dominios || dominios.length === 0) {
    throw new Error(`Sin dominios oficiales para ${estado}: añádelos a ${RUTA_FUENTES}`);
  }
  return dominios;
}

export function esDominioOficial(url: string, dominios: string[]): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return dominios.some((d) => {
    const dominio = d.toLowerCase();
    return host === dominio || host.endsWith(`.${dominio}`);
  });
}
