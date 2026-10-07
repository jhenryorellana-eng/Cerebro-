import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CodigoEstado, Fips, Sha256 } from "../contrato/paquete.js";
import * as V from "../contrato/vocabularios.js";

export const RUTA_RESPUESTAS = join("examen", "respuestas.json");
export const DIR_FUENTES_EXAMEN = join("examen", "fuentes");

/** Fuente de nivel A: una página oficial capturada o una orden de corte real (de la que solo se guarda el dato). */
export const FuenteRespuesta = z.discriminatedUnion("tipo", [
  z.strictObject({ tipo: z.literal("pagina"), url: z.url(), sha256: Sha256, cita: z.string().min(1) }),
  z.strictObject({ tipo: z.literal("orden_real"), nota: z.string().min(1) }),
]);
export type FuenteRespuesta = z.infer<typeof FuenteRespuesta>;

export const ReglaExamen = z.discriminatedUnion("nombre", [
  z.strictObject({ nombre: z.literal("min_tipos_asignados"), minimo: z.number().int().min(1) }),
  z.strictObject({ nombre: z.literal("nombre_corte_no_coincide"), fips: Fips, patron: z.string().min(1) }),
  z.strictObject({ nombre: z.literal("cita_debe_nombrar"), fips: Fips, texto: z.string().min(1) }),
  z.strictObject({
    nombre: z.literal("via_no_verificada_con"),
    categoria: z.enum(V.CATEGORIAS_VIA).optional(),
    edad: z.number().int().optional(),
    base: z.enum(V.BASES_EDAD).optional(),
  }),
]);
export type ReglaExamen = z.infer<typeof ReglaExamen>;

const Id = z.string().regex(/^[a-z0-9-]+$/);
const conFuentes = z.array(FuenteRespuesta).min(1);

export const Respuesta = z.discriminatedUnion("tipo", [
  z.strictObject({
    tipo: z.literal("marco"),
    id: Id,
    estado: CodigoEstado,
    campo: z.enum(["majorityAge", "hasSijsStatute", "assignmentUnit"]),
    esperado: z.union([z.number(), z.boolean(), z.string()]),
    fuentes: conFuentes,
  }),
  z.strictObject({
    tipo: z.literal("via_edad"),
    id: Id,
    estado: CodigoEstado,
    /** Las categorías de vía a las que aplica la edad: sin ellas, cualquier vía del estado la satisfaría. */
    categorias: z.array(z.enum(V.CATEGORIAS_VIA)).min(1),
    esperado: z.strictObject({ ageLimitExclusive: z.number().int(), ageBasis: z.enum(V.BASES_EDAD).optional() }),
    fuentes: conFuentes,
  }),
  z.strictObject({
    tipo: z.literal("asignacion"),
    id: Id,
    estado: CodigoEstado,
    fips: Fips,
    tipoCorte: z.string().min(1),
    corte: z.string().min(1),
    aceptadas: z.array(z.string().min(1)),
    distrito: z.string().min(1).optional(),
    fuentes: conFuentes,
  }),
  z.strictObject({
    tipo: z.literal("regla"),
    id: Id,
    estado: CodigoEstado,
    regla: ReglaExamen,
    porque: z.string().min(1),
    fuentes: z.array(FuenteRespuesta),
  }),
]);
export type Respuesta = z.infer<typeof Respuesta>;

export function cargarRespuestas(ruta: string = RUTA_RESPUESTAS): Respuesta[] {
  return z.array(Respuesta).parse(JSON.parse(readFileSync(ruta, "utf8")));
}
