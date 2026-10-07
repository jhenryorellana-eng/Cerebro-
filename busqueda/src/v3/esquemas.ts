import { z } from "zod";
import * as V from "../contrato/vocabularios.js";

/** Lo que la IA devuelve en cada nivel de la fábrica v3. Todo campo lleva sus citas y sus dudas. */
export const CitaPropuesta = z.strictObject({ url: z.string(), quote: z.string() });
export type CitaPropuesta = z.infer<typeof CitaPropuesta>;

const citas = z.array(CitaPropuesta);
const dudas = z.array(z.string());

export const MarcoPropuesto = z.strictObject({
  majorityAge: z.strictObject({ value: z.number().int().nullable(), citations: citas, dudas }),
  hasSijsStatute: z.strictObject({ value: z.boolean().nullable(), statute: z.string().nullable(), citations: citas, dudas }),
  assignmentUnit: z.strictObject({ value: z.enum(V.UNIDADES_ASIGNACION).nullable(), citations: citas, dudas }),
  courtTypes: z.array(
    z.strictObject({ key: z.string(), officialName: z.string(), note: z.string().nullable(), citations: citas, dudas }),
  ),
  notes: z.string(),
});
export type MarcoPropuesto = z.infer<typeof MarcoPropuesto>;

export const ViasPropuestas = z.strictObject({
  routes: z.array(
    z.strictObject({
      key: z.string(),
      category: z.enum(V.CATEGORIAS_VIA),
      officialName: z.string(),
      officialNameCitations: citas,
      courtTypeKey: z.string(),
      courtTypeCitations: citas,
      ageLimitExclusive: z.number().int().nullable(),
      ageBasis: z.enum(V.BASES_EDAD).nullable(),
      statute: z.string().nullable(),
      ageCitations: citas,
      conditions: z.array(z.strictObject({ code: z.enum(V.CONDICIONES), months: z.number().int().nullable() })),
      whoMayFile: z.array(z.string()),
      venueRule: z.string().nullable(),
      caseStyle: z.string().nullable(),
      dudas,
    }),
  ),
  notes: z.string(),
});
export type ViasPropuestas = z.infer<typeof ViasPropuestas>;

export const CortesPropuestasV3 = z.strictObject({
  courts: z.array(
    z.strictObject({
      key: z.string(),
      canonicalName: z.string(),
      aliases: z.array(z.string()),
      district: z.string().nullable(),
      caption: z.array(z.string()),
      citations: citas,
      dudas,
    }),
  ),
  counties: z.array(z.strictObject({ fips: z.string(), courtKey: z.string().nullable(), citations: citas, dudas })),
  notes: z.string(),
});
export type CortesPropuestasV3 = z.infer<typeof CortesPropuestasV3>;

export const SedesPropuestas = z.strictObject({
  courthouses: z.array(
    z.strictObject({
      key: z.string(),
      courtKey: z.string(),
      name: z.string(),
      street: z.string().nullable(),
      cityStateZip: z.string().nullable(),
      serves: z.strictObject({ kind: z.enum(V.TERRITORIOS_SEDE), codes: z.array(z.string()) }).nullable(),
      citations: citas,
      dudas,
    }),
  ),
  rules: z.array(z.strictObject({ fips: z.string(), rule: z.enum(V.REGLAS_SEDE), courthouseKeys: z.array(z.string()), citations: citas, dudas })),
  notes: z.string(),
});
export type SedesPropuestas = z.infer<typeof SedesPropuestas>;

export const FormulariosPropuestos = z.strictObject({
  forms: z.array(
    z.strictObject({
      url: z.string(),
      purpose: z.enum(V.PROPOSITOS_FORMULARIO),
      number: z.string().nullable(),
      title: z.string(),
      versionLabel: z.string().nullable(),
      routeKeys: z.array(z.string()),
      courtTypeKey: z.string(),
      countyFips: z.string().nullable(),
      citations: citas,
      dudas,
    }),
  ),
  notes: z.string(),
});
export type FormulariosPropuestos = z.infer<typeof FormulariosPropuestos>;

export const RequisitosPropuestos = z.strictObject({
  requirements: z.array(
    z.strictObject({
      kind: z.enum(V.TIPOS_REQUISITO),
      text: z.string(),
      amountUsd: z.number().nullable(),
      routeKey: z.string().nullable(),
      courtTypeKey: z.string(),
      citations: citas,
      dudas,
    }),
  ),
  notes: z.string(),
});
export type RequisitosPropuestos = z.infer<typeof RequisitosPropuestos>;

export const EncabezadosPropuestos = z.strictObject({
  captions: z.array(z.strictObject({ courtKey: z.string(), lines: z.array(z.string()), citations: citas, dudas })),
  caseStyles: z.array(z.strictObject({ routeKey: z.string(), caseStyle: z.string(), citations: citas, dudas })),
  notes: z.string(),
});
export type EncabezadosPropuestos = z.infer<typeof EncabezadosPropuestos>;
