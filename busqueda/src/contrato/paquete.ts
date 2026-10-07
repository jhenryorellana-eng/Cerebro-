import { z } from "zod";
import * as V from "./vocabularios.js";

/** Paquete v2 que la fábrica envía al mostrador (spec §5.4). Estricto: un campo desconocido es un error. */
export const Clave = z.string().regex(/^[a-z0-9][a-z0-9_.:-]*$/, "clave estable en minúsculas, sin espacios");
export const CodigoEstado = z.string().regex(/^[A-Z]{2}$/, "estado en 2 letras USPS");
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 en hexadecimal");
export const Fips = z.string().regex(/^\d{5}$/, "FIPS de condado de 5 dígitos");
/** Solo https: una URL javascript: o file: acabaría como enlace en la pantalla de revisión. El regex llega al JSON Schema. */
export const UrlHttps = z.url({ protocol: /^https$/ }).regex(/^https:\/\//, "solo URL https");

export const ResultadoFiltro = z.strictObject({
  filtro: z.enum(V.FILTROS),
  ok: z.boolean(),
  detalle: z.string().optional(),
});
export type ResultadoFiltro = z.infer<typeof ResultadoFiltro>;

const control = {
  key: Clave,
  status: z.enum(V.ESTADOS_DATO),
  filters: z.array(ResultadoFiltro),
  evidenceKeys: z.array(Clave),
};

export const Evidencia = z.strictObject({
  key: Clave,
  supports: z.strictObject({ key: Clave, field: z.string().min(1) }),
  url: UrlHttps,
  domain: z.string().min(1),
  tier: z.enum(V.NIVELES_FUENTE),
  quote: z.string().min(1),
  snippet: z.string(),
  pageSha256: Sha256,
  capturePath: z.string().nullable(),
  retrievedAt: z.iso.datetime(),
  extractedBy: z.string().min(1),
});
export type Evidencia = z.infer<typeof Evidencia>;

export const Marco = z.strictObject({
  ...control,
  /** null = no se encontró en fuente oficial: nunca un valor de relleno (2.1.0). */
  majorityAge: z.number().int().min(18).max(21).nullable(),
  /** null = no se sabe si el estado tiene ley SIJS propia (2.1.0). */
  hasSijsStatute: z.boolean().nullable(),
  assignmentUnit: z.enum(V.UNIDADES_ASIGNACION),
});
export type Marco = z.infer<typeof Marco>;

export const TipoCorte = z.strictObject({
  ...control,
  /** Sin aclaraciones dentro del nombre (van en note). Es un regex, no un refine, para que llegue al JSON Schema. */
  officialName: z.string().regex(/^[^()]+$/, "sin aclaraciones dentro del nombre: van en note"),
  note: z.string().nullable(),
});
export type TipoCorte = z.infer<typeof TipoCorte>;

/** Solo la residencia mínima lleva meses, y siempre los lleva (spec §5.2: «con N»). */
export const Condicion = z.union([
  z.strictObject({ code: z.literal("residencia_minima_meses"), months: z.number().int().positive() }),
  z.strictObject({ code: z.enum(V.CONDICIONES.filter((c) => c !== "residencia_minima_meses") as [V.CodigoCondicion, ...V.CodigoCondicion[]]) }),
]);
export type Condicion = z.infer<typeof Condicion>;

export const Via = z.strictObject({
  ...control,
  category: z.enum(V.CATEGORIAS_VIA),
  officialName: z.string().min(1),
  courtTypeKey: Clave,
  ageLimitExclusive: z.number().int().min(18).max(22).nullable(),
  ageBasis: z.enum(V.BASES_EDAD).nullable(),
  statute: z.string().nullable(),
  conditions: z.array(Condicion),
  whoMayFile: z.array(z.string().min(1)),
  venueRule: z.string().nullable(),
  caseStyle: z.string().nullable(),
  preferenceRank: z.number().int().positive().nullable(),
});
export type Via = z.infer<typeof Via>;

export const Corte = z.strictObject({
  ...control,
  courtTypeKey: Clave,
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  district: z.string().nullable(),
  caption: z.array(z.string().min(1)),
});
export type Corte = z.infer<typeof Corte>;

export const Sede = z.strictObject({
  ...control,
  courtKey: Clave,
  name: z.string().min(1),
  street: z.string().nullable(),
  cityStateZip: z.string().nullable(),
  /** Qué territorio atiende: necesario para las reglas por ZIP o por pueblo; null si no hay regla oficial. */
  serves: z.strictObject({ kind: z.enum(V.TERRITORIOS_SEDE), codes: z.array(z.string().min(1)).min(1) }).nullable(),
});
export type Sede = z.infer<typeof Sede>;

export const Territorio = z.strictObject({ kind: z.enum(V.UNIDADES_ASIGNACION), code: z.string().min(1) });
export type Territorio = z.infer<typeof Territorio>;

export const Asignacion = z.strictObject({
  ...control,
  territory: Territorio,
  courtTypeKey: Clave,
  courtKey: Clave,
  courthouseRule: z.enum(V.REGLAS_SEDE),
  courthouseKeys: z.array(Clave),
});
export type Asignacion = z.infer<typeof Asignacion>;

export const Formulario = z.strictObject({
  ...control,
  routeKeys: z.array(Clave),
  courtTypeKey: Clave,
  countyFips: Fips.nullable(),
  purpose: z.enum(V.PROPOSITOS_FORMULARIO),
  number: z.string().nullable(),
  title: z.string().min(1),
  officialUrl: UrlHttps,
  versionLabel: z.string().nullable(),
  pdfSha256: Sha256.nullable(),
  format: z.enum(V.FORMATOS_FORMULARIO),
});
export type Formulario = z.infer<typeof Formulario>;

export const Requisito = z.strictObject({
  ...control,
  routeKey: Clave.nullable(),
  courtTypeKey: Clave,
  kind: z.enum(V.TIPOS_REQUISITO),
  text: z.string().min(1),
  amountUsd: z.number().nonnegative().nullable(),
});
export type Requisito = z.infer<typeof Requisito>;

export const OpcionRevision = z.strictObject({ label: z.string().min(1), evidenceKeys: z.array(Clave) });

export const Pendiente = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("pregunta"),
    key: Clave,
    itemKey: Clave.nullable(),
    question: z.string().min(1),
    options: z.array(OpcionRevision).min(2),
  }),
  z.strictObject({ kind: z.literal("nota"), key: Clave, itemKey: Clave.nullable(), text: z.string().min(1) }),
]);
export type Pendiente = z.infer<typeof Pendiente>;

export const Paquete = z.strictObject({
  schemaVersion: z.literal(V.VERSION_ESQUEMA_PAQUETE),
  contractVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  state: CodigoEstado,
  generatedAt: z.iso.datetime(),
  factory: z.strictObject({ version: z.string().min(1), models: z.record(z.string(), z.string()) }),
  framework: Marco,
  courtTypes: z.array(TipoCorte),
  routes: z.array(Via),
  courts: z.array(Corte),
  courthouses: z.array(Sede),
  assignments: z.array(Asignacion),
  forms: z.array(Formulario),
  filingRequirements: z.array(Requisito),
  evidence: z.array(Evidencia),
  openItems: z.array(Pendiente),
});
export type Paquete = z.infer<typeof Paquete>;
