import { z } from "zod";
import { Clave, CodigoEstado, Fips } from "./paquete.js";
import * as V from "./vocabularios.js";

/**
 * Lo que el resolvedor de x-legal entrega a las automatizaciones del caso (spec §5.5).
 * Es una unión por `status` (y no un refine) para que el JSON Schema que va a x-legal exprese la regla:
 * «confirmado» exige vía, corte, sede y versión y no lleva motivos; «excepcion» siempre dice su motivo.
 */
const Motivo = z.strictObject({ codigo: z.enum(V.MOTIVOS_EXCEPCION), detalle: z.string().optional() });
const Territorio = z.strictObject({
  estado: CodigoEstado,
  condado: z.strictObject({ fips: Fips, nombre: z.string().min(1) }).nullable(),
  pueblo: z.string().nullable(),
});
const ViaResuelta = z.strictObject({
  key: Clave,
  categoria: z.enum(V.CATEGORIAS_VIA),
  nombre: z.string().min(1),
  fechaLimiteOrden: z.iso.date().nullable(),
  diasRestantes: z.number().int().nullable(),
  urgencia: z.enum(["normal", "proxima", "urgente"]),
});
const CorteResuelta = z.strictObject({ key: Clave, nombreCanonico: z.string().min(1), encabezado: z.array(z.string().min(1)).min(1) });
const SedeResuelta = z.strictObject({ key: Clave, nombre: z.string().min(1), calle: z.string().nullable(), ciudadEstadoZip: z.string().nullable() });
const VersionDatos = z.strictObject({ estado: CodigoEstado, version: z.number().int().positive() });

const comun = {
  territorio: Territorio,
  viasEvaluadas: z.array(z.strictObject({ key: Clave, aplica: z.enum(["si", "no", "falta_dato"]), razones: z.array(z.string()) })),
  formularios: z.array(
    z.strictObject({
      key: Clave,
      proposito: z.enum(V.PROPOSITOS_FORMULARIO),
      numero: z.string().nullable(),
      titulo: z.string().min(1),
      formDefinitionId: z.string().nullable(),
      formato: z.enum(V.FORMATOS_FORMULARIO),
    }),
  ),
  requisitos: z.array(
    z.strictObject({ key: Clave, tipo: z.enum(V.TIPOS_REQUISITO), texto: z.string().min(1), montoUsd: z.number().nonnegative().nullable() }),
  ),
  evidenciaKeys: z.array(Clave),
};

export const Resolucion = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("confirmado"),
    motivos: z.array(Motivo).max(0, "una resolución confirmada no lleva motivos"),
    via: ViaResuelta,
    corte: CorteResuelta,
    sede: SedeResuelta,
    versionDatos: VersionDatos,
    ...comun,
  }),
  z.strictObject({
    status: z.literal("excepcion"),
    motivos: z.array(Motivo).min(1, "una excepción siempre dice su motivo"),
    via: ViaResuelta.nullable(),
    corte: CorteResuelta.nullable(),
    sede: SedeResuelta.nullable(),
    versionDatos: VersionDatos.nullable(),
    ...comun,
  }),
]);
export type Resolucion = z.infer<typeof Resolucion>;
