import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ResultadoCortes, ResultadoReglas, ResultadoVerificacion } from "./esquemas.js";

const EstadoCorrida = z.object({
  reglas: ResultadoReglas.optional(),
  verificacionReglas: ResultadoVerificacion.optional(),
  cortes: ResultadoCortes.optional(),
  verificacionCortes: ResultadoVerificacion.optional(),
  /** Páginas del directorio de cortes capturadas por código (v2): se reutilizan en cada lote. */
  directorio: z
    .array(
      z.object({
        url: z.string(),
        finalUrl: z.string(),
        status: z.number().nullable(),
        title: z.string(),
        texto: z.string(),
        sha256: z.string(),
        textoPath: z.string().nullable(),
        capturaPath: z.string().nullable(),
        problema: z.enum(["bloqueada", "fuera_de_lista", "pdf", "error"]).nullable(),
        detalle: z.string(),
        /** Solo en los PDF: el original guardado junto a su texto. */
        pdfPath: z.string().optional(),
      }),
    )
    .optional(),
  /** Resultado de cada lote del nivel 2 (v2), en orden: al reanudar se sigue por el siguiente. */
  lotesCortes: z.array(ResultadoCortes).optional(),
  /** Niveles que un --refrescar ya borró y aún no terminó: repetir la orden continúa en vez de volver a borrar. */
  refrescoEnCurso: z.array(z.number()).optional(),
  /** Hora en que terminó cada etapa: fecha real de la evidencia. */
  fechas: z.record(z.string(), z.string()).optional(),
});
export type EstadoCorrida = z.infer<typeof EstadoCorrida>;

function ruta(dir: string, estado: string): string {
  return join(dir, `${estado}.json`);
}

export function leerEstado(dir: string, estado: string): EstadoCorrida {
  const r = ruta(dir, estado);
  return existsSync(r) ? EstadoCorrida.parse(JSON.parse(readFileSync(r, "utf8"))) : {};
}

export function guardarEstado(dir: string, estado: string, e: EstadoCorrida): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(ruta(dir, estado), JSON.stringify(e, null, 2));
}

export type Etapa = Exclude<keyof EstadoCorrida, "fechas" | "lotesCortes" | "refrescoEnCurso">;

export async function conEtapa<K extends Etapa>(
  dir: string,
  estado: string,
  e: EstadoCorrida,
  etapa: K,
  refrescar: boolean,
  producir: () => Promise<NonNullable<EstadoCorrida[K]>>,
): Promise<NonNullable<EstadoCorrida[K]>> {
  const previo = e[etapa];
  if (previo !== undefined && !refrescar) return previo as NonNullable<EstadoCorrida[K]>;
  const valor = await producir();
  e[etapa] = valor;
  e.fechas = { ...(e.fechas ?? {}), [etapa]: new Date().toISOString() };
  guardarEstado(dir, estado, e);
  return valor;
}

export function guardarLote(dir: string, estado: string, e: EstadoCorrida, resultado: ResultadoCortes): void {
  e.lotesCortes = [...(e.lotesCortes ?? []), resultado];
  guardarEstado(dir, estado, e);
}
