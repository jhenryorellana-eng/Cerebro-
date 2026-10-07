import { z } from "zod";

export const Cita = z.strictObject({
  url: z.string(),
  quote: z.string(),
  found: z.boolean(),
  snippet: z.string(),
  pageSha256: z.string(),
  pageTitle: z.string(),
  screenshotPath: z.string().nullable(),
});
export type Cita = z.infer<typeof Cita>;

export const Afirmacion = z.strictObject({ value: z.string().nullable(), citations: z.array(Cita) });
export type Afirmacion = z.infer<typeof Afirmacion>;

export const Via = z.strictObject({
  key: z.string(),
  route: Afirmacion,
  courtType: Afirmacion,
  ageLimitExclusive: Afirmacion,
  venueRule: Afirmacion,
});
export type Via = z.infer<typeof Via>;

export const ResultadoReglas = z.strictObject({
  status: z.enum(["ok", "no_state_route", "blocked", "needs_human"]),
  notes: z.string(),
  routes: z.array(Via),
});
export type ResultadoReglas = z.infer<typeof ResultadoReglas>;

export const CorteEncontrada = z.strictObject({
  key: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  citations: z.array(Cita),
});
export type CorteEncontrada = z.infer<typeof CorteEncontrada>;

export const CondadoAsignado = z.strictObject({
  fips: z.string(),
  candidateCourtKeys: z.array(z.string()),
  branchNames: z.array(z.string()),
  citations: z.array(Cita),
});
export type CondadoAsignado = z.infer<typeof CondadoAsignado>;

export const ResultadoCortes = z.strictObject({
  status: z.enum(["ok", "partial", "blocked", "needs_human"]),
  notes: z.string(),
  courts: z.array(CorteEncontrada),
  counties: z.array(CondadoAsignado),
});
export type ResultadoCortes = z.infer<typeof ResultadoCortes>;

export const Comprobacion = z.strictObject({
  url: z.string(),
  quote: z.string(),
  found: z.boolean(),
  snippet: z.string(),
  pageSha256: z.string(),
});
export type Comprobacion = z.infer<typeof Comprobacion>;

export const ResultadoVerificacion = z.strictObject({ checks: z.array(Comprobacion) });
export type ResultadoVerificacion = z.infer<typeof ResultadoVerificacion>;
