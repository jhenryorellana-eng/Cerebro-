import { readFileSync } from "node:fs";
import { NOMBRES_ESTADOS } from "./estados.js";

export interface Condado {
  state: string;
  fips: string;
  name: string;
}

export const RUTA_CENSUS = "data/census/national_county2020.txt";

export function parsearCondados(contenido: string): Condado[] {
  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim() !== "");
  const [cabecera, ...filas] = lineas;
  if (!cabecera || !cabecera.startsWith("STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME")) {
    throw new Error("Formato inesperado del archivo de condados del Census");
  }
  const condados: Condado[] = [];
  for (const fila of filas) {
    const [state, statefp, countyfp, , name] = fila.split("|");
    if (!state || !statefp || !countyfp || !name) throw new Error(`Fila mal formada: ${fila}`);
    if (!(state in NOMBRES_ESTADOS)) continue; // territorios: PR, GU, VI, AS, MP, UM
    condados.push({ state, fips: `${statefp}${countyfp}`, name });
  }
  return condados;
}

export function cargarCondados(ruta: string = RUTA_CENSUS): Condado[] {
  return parsearCondados(readFileSync(ruta, "utf8"));
}

export function condadosDeEstado(todos: Condado[], estado: string): Condado[] {
  return todos.filter((c) => c.state === estado);
}
