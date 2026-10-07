import { z } from "zod";

export const TipoNodo = z.enum(["state", "county", "procedural_route", "court_type", "court", "branch", "source"]);
export const Relacion = z.enum([
  "county_in_state", "allows_route", "route_filed_in", "county_served_by", "court_has_branch", "county_assigned_branch",
]);
export const Claim = z.enum(["route", "age", "venue", "court_type", "county_court"]);
export const MotivoPregunta = z.enum([
  "multiple_branches_no_official_rule", "multiple_courts_no_official_rule", "court_not_found", "not_researched",
  "unknown_fips", "conflicting_assignments", "conflicting_court_key", "sample_failed",
  "state_rules_blocked", "state_rules_no_route", "state_rules_needs_human", "missing_claim", "reviewer_note",
]);

export const Nodo = z.object({
  id: z.string().min(1),
  type: TipoNodo,
  label: z.string().min(1),
  fips: z.string().regex(/^\d{5}$/).optional(),
  address: z.string().optional(),
  url: z.string().optional(),
  domain: z.string().optional(),
  retrievedAt: z.string().optional(),
  pageSha256: z.string().optional(),
  screenshot: z.string().nullable().optional(),
});
export type Nodo = z.infer<typeof Nodo>;

export const Evidencia = z.object({
  claim: Claim,
  source: z.string(),
  quote: z.string(),
  snippet: z.string(),
  quoteVerified: z.boolean(),
  secondPassVerified: z.boolean().nullable(),
});
export type Evidencia = z.infer<typeof Evidencia>;

export const Arista = z.object({
  id: z.string(),
  from: z.string(),
  rel: Relacion,
  to: z.string(),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  evidence: z.array(Evidencia),
  confidence: z.enum(["high", "medium", "low"]),
  checks: z.array(z.string()),
  status: z.literal("pending"),
});
export type Arista = z.infer<typeof Arista>;

export const PreguntaAbierta = z.object({ county: z.string().nullable(), reason: MotivoPregunta, detail: z.string() });
export type PreguntaAbierta = z.infer<typeof PreguntaAbierta>;

export const Paquete = z.object({
  schemaVersion: z.literal("1.0"),
  state: z.string().regex(/^[A-Z]{2}$/),
  generatedAt: z.string(),
  nodes: z.array(Nodo),
  edges: z.array(Arista),
  openQuestions: z.array(PreguntaAbierta),
});
export type Paquete = z.infer<typeof Paquete>;
