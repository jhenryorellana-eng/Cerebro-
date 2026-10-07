import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Paquete } from "./tipos.js";

export interface ResumenEstado {
  condados: number;
  condadosConCorte: number;
  alta: number;
  media: number;
  baja: number;
  preguntasAbiertas: number;
  reglas: "ok" | "incompleto" | "revisar" | "sin_datos";
  actualizadoEn: string;
}
export type EntradaCobertura = ResumenEstado | { error: string; actualizadoEn: string };
export interface Cobertura {
  actualizadoEn: string;
  estados: Record<string, EntradaCobertura>;
  totales: { estadosConReglas: number; condadosConCorte: number };
}

export function resumenCobertura(p: Paquete, totalCondados: number): ResumenEstado {
  const investigadas = p.edges.filter((a) => a.rel !== "county_in_state");
  const conCorte = new Set(p.edges.filter((a) => a.rel === "county_served_by" && a.confidence !== "low").map((a) => a.from)).size;
  const vias = p.edges.filter((a) => a.rel === "allows_route");
  const faltanDatos = p.openQuestions.some((q) => q.reason === "missing_claim");
  const reglas: ResumenEstado["reglas"] = vias.some((a) => a.confidence !== "low")
    ? faltanDatos
      ? "incompleto"
      : "ok"
    : vias.length > 0 || p.openQuestions.some((q) => q.reason.startsWith("state_rules_"))
      ? "revisar"
      : "sin_datos";
  return {
    condados: totalCondados,
    condadosConCorte: conCorte,
    alta: investigadas.filter((a) => a.confidence === "high").length,
    media: investigadas.filter((a) => a.confidence === "medium").length,
    baja: investigadas.filter((a) => a.confidence === "low").length,
    preguntasAbiertas: p.openQuestions.length,
    reglas,
    actualizadoEn: p.generatedAt,
  };
}

export function leerCobertura(dir: string): Cobertura {
  const r = join(dir, "cobertura.json");
  if (!existsSync(r)) {
    return { actualizadoEn: new Date(0).toISOString(), estados: {}, totales: { estadosConReglas: 0, condadosConCorte: 0 } };
  }
  return JSON.parse(readFileSync(r, "utf8")) as Cobertura;
}

export function guardarCobertura(dir: string, c: Cobertura): void {
  const resumenes = Object.values(c.estados).filter((x): x is ResumenEstado => !("error" in x));
  c.totales = {
    estadosConReglas: resumenes.filter((x) => x.reglas === "ok").length,
    condadosConCorte: resumenes.reduce((s, x) => s + x.condadosConCorte, 0),
  };
  c.actualizadoEn = new Date().toISOString();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cobertura.json"), JSON.stringify(c, null, 2));
}
