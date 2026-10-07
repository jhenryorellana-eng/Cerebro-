export type Confianza = "high" | "medium" | "low";
export type SegundaPasada = "agree" | "disagree" | "not_run";

export interface EntradaConfianza {
  quoteVerified: boolean;
  officialDomain: boolean;
  distinctSources: number;
  requiresTwoSources: boolean;
  secondPass: SegundaPasada;
}

const ORDEN: Record<Confianza, number> = { low: 0, medium: 1, high: 2 };

export function calcularConfianza(e: EntradaConfianza): { confidence: Confianza; checks: string[] } {
  const checks: string[] = [];
  if (e.quoteVerified) checks.push("quote_verified");
  if (e.officialDomain) checks.push("official_domain");
  if (e.distinctSources >= 2) checks.push("two_sources");
  if (e.secondPass === "agree") checks.push("second_pass_agree");
  if (e.secondPass === "disagree") checks.push("second_pass_disagree");

  if (!e.quoteVerified || !e.officialDomain || e.secondPass === "disagree") return { confidence: "low", checks };
  const fuentesSuficientes = !e.requiresTwoSources || e.distinctSources >= 2;
  if (fuentesSuficientes && e.secondPass === "agree") return { confidence: "high", checks };
  return { confidence: "medium", checks };
}

export function peorConfianza(lista: Confianza[]): Confianza {
  if (lista.length === 0) return "low";
  return lista.reduce((peor, c) => (ORDEN[c] < ORDEN[peor] ? c : peor));
}
