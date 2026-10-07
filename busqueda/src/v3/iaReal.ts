import { lanzarReal, preguntarClaude, type Lanzador, type OpcionesClaude } from "../ia.js";
import { CortesPropuestasV3, EncabezadosPropuestos, FormulariosPropuestos, MarcoPropuesto, RequisitosPropuestos, SedesPropuestas, ViasPropuestas } from "./esquemas.js";
import type { IaFabrica } from "./fabrica.js";
import { MODELOS_POR_DEFECTO } from "./modelos.js";
import { SISTEMA_V3 } from "./prompts.js";
import { RefutacionPropuesta } from "./refutar.js";

/** La IA de verdad: `claude -p` sin herramientas, con el prompt de sistema v3; extrae un modelo y refuta otro (§6.2). */
export function iaReal(modelo: string, lanzar: Lanzador = lanzarReal, modeloRefutar: string = MODELOS_POR_DEFECTO.refutar): IaFabrica {
  const opciones = (prompt: string, m: string = modelo): OpcionesClaude => ({
    prompt,
    chrome: false,
    herramientas: [],
    permitidas: [],
    modelo: m,
    sistemaArchivo: SISTEMA_V3,
    timeoutMs: 20 * 60_000,
  });
  return {
    marco: (prompt) => preguntarClaude(opciones(prompt), MarcoPropuesto, lanzar),
    vias: (prompt) => preguntarClaude(opciones(prompt), ViasPropuestas, lanzar),
    cortes: (prompt) => preguntarClaude(opciones(prompt), CortesPropuestasV3, lanzar),
    sedes: (prompt) => preguntarClaude(opciones(prompt), SedesPropuestas, lanzar),
    formularios: (prompt) => preguntarClaude(opciones(prompt), FormulariosPropuestos, lanzar),
    requisitos: (prompt) => preguntarClaude(opciones(prompt), RequisitosPropuestos, lanzar),
    encabezados: (prompt) => preguntarClaude(opciones(prompt), EncabezadosPropuestos, lanzar),
    refutar: (prompt) => preguntarClaude(opciones(prompt, modeloRefutar), RefutacionPropuesta, lanzar),
  };
}
