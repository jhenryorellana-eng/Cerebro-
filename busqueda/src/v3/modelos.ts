/** Modelo de cada paso de la fábrica (spec §6.2): configurable por entorno y anotado en cada dato. */
export type Paso = "buscar" | "extraer" | "refutar";

export const MODELOS_POR_DEFECTO: Readonly<Record<Paso, string>> = {
  buscar: "claude-sonnet-5-5",
  extraer: "claude-sonnet-5-5",
  refutar: "claude-opus-5-5",
};

const VARIABLES: Readonly<Record<Paso, string>> = {
  buscar: "FABRICA_MODELO_BUSCAR",
  extraer: "FABRICA_MODELO_EXTRAER",
  refutar: "FABRICA_MODELO_REFUTAR",
};

/** Un id de modelo de Claude («claude-…»); cualquier otra cosa en el entorno se ignora. */
export function modeloDe(paso: Paso, entorno: NodeJS.ProcessEnv = process.env): string {
  const valor = entorno[VARIABLES[paso]]?.trim();
  return valor && /^claude-[a-z0-9.-]+$/.test(valor) ? valor : MODELOS_POR_DEFECTO[paso];
}

export function modelosUsados(entorno: NodeJS.ProcessEnv = process.env): Record<Paso, string> {
  return { buscar: modeloDe("buscar", entorno), extraer: modeloDe("extraer", entorno), refutar: modeloDe("refutar", entorno) };
}
