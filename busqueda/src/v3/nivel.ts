// src/v3/nivel.ts
import type { Condado } from "../condados.js";
import type { Corte } from "../contrato/paquete.js";
import { FILTROS_REQUERIDOS, type TipoElemento } from "../contrato/validar.js";
import type { Cita } from "../esquemas.js";
import type { CitaPropuesta } from "./esquemas.js";
import type { ResultadoFiltro } from "./filtros.js";
import type { LectorDeCondados } from "./condadosEnTexto.js";
import type { PaginaLigable } from "./ligaduras.js";

export type EstadoDato = "verificado" | "a_revisar" | "sin_dato";

/** Verificado solo si pasa los filtros que su tipo exige (§6.3) y ninguno falla. */
export function estadoDe(tipo: TipoElemento, filtros: ResultadoFiltro[], tieneValor: boolean): EstadoDato {
  if (!tieneValor) return "sin_dato";
  const aprobados = new Set(filtros.filter((f) => f.ok).map((f) => f.filtro));
  return filtros.every((f) => f.ok) && FILTROS_REQUERIDOS[tipo].every((f) => aprobados.has(f)) ? "verificado" : "a_revisar";
}

/**
 * Clave estable: minúsculas, sin acentos, con guiones. Sin recortar: la clave es la identidad del dato, y recortarla
 * fundía cortes distintas («…District Court of the County of Arlington» y «…of Fairfax»).
 */
export function slug(s: string): string {
  const x = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return x || "sin-nombre";
}

/** Quién sacó una cita que encontró el código y no la IA (evidence.extractedBy). */
export const EXTRAIDO_POR_LIGADURA = "codigo:ligadura";
export const EXTRAIDO_POR_DIRECCION = "codigo:direccion";

/** Una corte mientras se construye: su evidencia, sus dudas y las notas de los lotes de los que salió. */
export interface EntradaCorte {
  corte: Corte;
  citas: Cita[];
  dudas: string[];
  notas: string[];
}

/** Lo que los constructores de los niveles 3-6 comparten con el de los niveles 0-2. */
export interface CtxNivel {
  st: string;
  estado: string;
  nombreEstado: string;
  condados: Condado[];
  /** Lee qué condados del estado nombra un texto COMO condados (el núcleo suelto no cuenta). */
  lector: LectorDeCondados;
  /** Las páginas oficiales capturadas (https): donde el código busca las segundas fuentes. */
  paginas: PaginaLigable[];
  /**
   * Comprueba las citas contra las capturas; solo las encontradas crean evidencia del campo. `extraidoPor`: quién sacó la
   * cita (por defecto el modelo que extrae; EXTRAIDO_POR_* si la encontró el código).
   */
  citar(itemKey: string, campo: string, propuestas: CitaPropuesta[], extraidoPor?: string): { citas: Cita[]; claves: string[] };
  /** Comprueba las citas contra las capturas SIN crear evidencia. */
  comprobar(propuestas: CitaPropuesta[]): Cita[];
  nota(itemKey: string | null, texto: string): void;
  oficial(url: string): boolean;
}
