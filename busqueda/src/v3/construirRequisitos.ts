import type { Requisito, TipoCorte, Via } from "../contrato/paquete.js";
import type { Cita } from "../esquemas.js";
import type { RequisitosPropuestos } from "./esquemas.js";
import { f1, f2Campos, f3, f5Bien, f7, fallo, type ResultadoFiltro } from "./filtros.js";
import { estadoDe, slug, type CtxNivel } from "./nivel.js";

/** Frases con las que una página oficial dice que no hay tasa («no fee waiver», «no fee-waiver» y «toll-free» no lo dicen). */
const SIN_TASA: readonly RegExp[] = [
  /\$0(\.00)?(?![.,]?\d)/,
  /\bno (filing )?fee\b(?![\s-]+waivers?)/i,
  /\bfree of charge\b/i,
  /\bno charge\b/i,
  /\bsin (costo|cargo|tasa)\b/i,
];

/** Una tasa real, mayor que cero: «$360», «$ 5». */
const TASA_POSITIVA = /\$\s?[1-9]/;

/**
 * ¿Las citas comprobadas muestran el importe? Uno positivo, como dinero: «$N», «$N.00» o «N dollars», y la cifra no
 * puede ir dentro de otra mayor (ni precedida por dígito, coma, punto o guion, «$1,250», «78A-6-250»; ni seguida de
 * coma y dígito, punto y dígito salvo «.00», o dígito). «Form 360» y «360 days» no son dinero. Cero, si alguna dice
 * que no hay tasa y NINGUNA muestra una tasa real («There is no fee for copies. Filing fee: $360.» no es cero).
 */
function importeEnCitas(importe: number, citas: Cita[]): boolean {
  const encontradas = citas.filter((c) => c.found);
  if (importe === 0) {
    if (encontradas.some((c) => TASA_POSITIVA.test(c.quote))) return false;
    return encontradas.some((c) => SIN_TASA.some((r) => r.test(c.quote)));
  }
  const cifra = String(importe).replace(".", "[.]");
  const fin = String.raw`([.]00)?(?!\d|,\d|[.]\d)`;
  const dinero = new RegExp(String.raw`(?<![\d,.-])(?:\$\s?${cifra}${fin}|${cifra}${fin}\s+dollars?\b)`, "i");
  return encontradas.some((c) => dinero.test(c.quote));
}

/** Nivel 5. Un requisito es una regla (§6.3): F1, F2, F3, F5, F6 y F7, y siempre lo aprueba una persona. */
export function construirRequisitos(
  ctx: CtxNivel,
  p: RequisitosPropuestos,
  routes: Via[],
  courtTypes: TipoCorte[],
  f6De: (key: string) => ResultadoFiltro[],
): Requisito[] {
  const vias = new Set(routes.map((r) => r.key));
  const tipos = new Set(courtTypes.map((t) => t.key));
  const usadas = new Set<string>();
  const salida: Requisito[] = [];
  for (const q of p.requirements) {
    if (!tipos.has(q.courtTypeKey)) {
      ctx.nota(null, `Requisito «${q.text.slice(0, 80)}» descartado: el tipo de corte «${q.courtTypeKey}» no está en el paquete.`);
      continue;
    }
    const texto = q.text.replace(/\s+/g, " ").trim();
    if (!texto) {
      ctx.nota(null, `Requisito «${q.kind}» descartado: sin texto.`);
      continue;
    }
    const via = q.routeKey !== null && vias.has(q.routeKey) ? q.routeKey : null;
    const base = `${ctx.st}:req:${slug(q.courtTypeKey.split(":").pop()!)}:${via ? slug(via.split(":").pop()!) : "todas"}:${q.kind}`;
    let key = base;
    for (let n = 2; usadas.has(key); n++) key = `${base}-${n}`;
    usadas.add(key);
    const ev = ctx.citar(key, "text", q.citations);
    const oficiales = ev.citas.filter((c) => ctx.oficial(c.url));
    const problemas: string[] = [];
    if (q.routeKey !== null && via === null) problemas.push(`la vía «${q.routeKey}» no está en el paquete`);
    if (q.amountUsd !== null && (q.amountUsd < 0 || q.amountUsd > 10_000)) problemas.push(`importe imposible: ${q.amountUsd}`);
    const importeValido = q.amountUsd !== null && q.amountUsd >= 0 && q.amountUsd <= 10_000;
    let filtroF2: ResultadoFiltro;
    if (q.kind === "tasa" && q.amountUsd === null) filtroF2 = fallo("F2", "una tasa sin importe");
    else if (importeValido && !importeEnCitas(q.amountUsd!, oficiales)) filtroF2 = fallo("F2", "el importe no aparece en las citas");
    else filtroF2 = f2Campos([ev.citas]);
    const filtros = [
      f1(ev.citas),
      filtroF2,
      f3(oficiales),
      problemas.length === 0 ? f5Bien() : fallo("F5", problemas.join("; ")),
      ...f6De(key),
      f7(q.dudas, [p.notes]),
    ];
    for (const d of q.dudas) ctx.nota(key, d);
    salida.push({
      key,
      status: estadoDe("requisito", filtros, true),
      filters: filtros,
      evidenceKeys: ev.claves,
      routeKey: via,
      courtTypeKey: q.courtTypeKey,
      kind: q.kind,
      text: texto,
      amountUsd: importeValido ? q.amountUsd : null,
    });
  }
  return salida;
}
