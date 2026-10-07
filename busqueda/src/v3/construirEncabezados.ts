// src/v3/construirEncabezados.ts
import type { Corte, Via } from "../contrato/paquete.js";
import { normalizar } from "../normalizar.js";
import { nucleoCondado } from "../tareas/extraer.js";
import type { CitaPropuesta, EncabezadosPropuestos } from "./esquemas.js";
import { ordinalesDe, type LectorDeCondados } from "./condadosEnTexto.js";
import type { CtxNivel, EntradaCorte } from "./nivel.js";

const HUECOS: readonly string[] = ["{county}", "{state}", "{minor}", "{petitioner}"];
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Una raya para rellenar a mano («______»): lo que muestra un formulario en blanco. */
const EN_BLANCO = "_{2,}";
/** Palabras de un título o encabezado que nunca son el nombre de una persona. */
const NO_NOMBRE = "(?:matter|guardianship|custody|of|the|in|re|and|court|petition)(?![A-Za-z])";
/** Un nombre corto de persona: de 1 a 6 palabras, ninguna de ellas propia de un título («the», «Guardianship»…). */
const NOMBRE = String.raw`(?<!\S)(?!${NO_NOMBRE})\S+(?:\s+(?!${NO_NOMBRE})\S+){0,5}`;

/**
 * ¿La cita muestra esta línea, con nombres reales en sus huecos? {county} solo casa con un condado del estado (su
 * núcleo, «Salt Lake») o una raya en blanco; {state} con el nombre del estado; {minor} y {petitioner} con una raya en
 * blanco o un nombre corto (1-6 palabras sin «matter», «guardianship», «of», «the»…). `condados`: los nombres Census
 * (o los núcleos) de los condados del estado.
 */
export function lineaEnCita(linea: string, cita: string, estado: string, condados: readonly string[]): boolean {
  const nucleos = [...new Set(condados.map((c) => nucleoCondado(c.trim())).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((n) => escapar(n).replace(/\s+/g, String.raw`\s+`));
  const condado = String.raw`(?<![A-Za-z0-9])(?:${[...nucleos, EN_BLANCO].join("|")})(?![A-Za-z0-9])`;
  const persona = `(?:${EN_BLANCO}|${NOMBRE})`;
  const partes = normalizar(linea).split(/(\{county\}|\{state\}|\{minor\}|\{petitioner\})/);
  const patron = partes
    .map((p) => (p === "{county}" ? condado : p === "{state}" ? escapar(estado) : p === "{minor}" || p === "{petitioner}" ? persona : escapar(p)))
    .join("");
  return patron.trim() !== "" && new RegExp(patron, "i").test(normalizar(cita));
}

/** Solo los huecos del contrato (§5.1): {county} {state} {minor} {petitioner}. */
export function huecosValidos(texto: string): boolean {
  return (texto.match(/\{[^}]*\}/g) ?? []).every((h) => HUECOS.includes(h));
}

/** Una línea válida tiene al menos una palabra literal (3+ letras) además de sus huecos: si no, cualquier cita la «muestra». */
const conPalabra = (texto: string) => /[A-Za-z]{3,}/.test(texto.replace(/\{(county|state|minor|petitioner)\}/g, " "));

/**
 * Los ordinales de distrito de un texto («Third District», «4th Judicial District», «District 8», «Second Circuit»), en
 * número. Los distritos que no son judiciales («School District 5») no cuentan.
 */
export function ordinalesDeDistrito(texto: string): Set<number> {
  return new Set(ordinalesDe(texto).map((o) => o.n));
}

/**
 * Por qué el texto literal de un encabezado (sin sus huecos) dice que es de OTRA corte: nombra un condado del estado
 * que no está asignado a esta corte, o un distrito («FOURTH DISTRICT») que no es el de su nombre ni el de su distrito.
 * Null si nada lo contradice.
 */
function deOtraCorte(lineas: string[], corte: Corte, asignados: ReadonlySet<string>, lector: LectorDeCondados): string | null {
  const literal = lineas.join(" / ").replace(/\{(county|state|minor|petitioner)\}/g, " ");
  const ajenos = lector.condados.filter((c) => !asignados.has(c.fips) && lector.nombra(literal, c.fips));
  if (ajenos.length > 0) return `nombra ${ajenos.map((c) => c.name).join(", ")}, que no está asignado a esta corte`;
  const propios = new Set([...ordinalesDeDistrito(corte.canonicalName), ...ordinalesDeDistrito(corte.district ?? "")]);
  const otros = [...ordinalesDeDistrito(literal)].filter((n) => !propios.has(n));
  return otros.length > 0 ? `su distrito (${otros.join(", ")}) no es el de la corte` : null;
}

/**
 * Nivel 6. El encabezado de una corte y el título del caso de una vía solo se aplican si citas oficiales comprobadas
 * los muestran (con nombres reales en los huecos): es lo que la app pondrá en el escrito. Solo las citas que muestran
 * una línea crean evidencia; un encabezado rechazado no deja ninguna. Un encabezado cuyo texto es de otra corte (otro
 * condado del estado, otro distrito) no se aplica, ni ninguno cuando se aceptan dos distintos para la misma corte. Las
 * citas del encabezado son solo su evidencia: no cuentan para F1 ni F3 de la corte. `condadosDeCorte`: clave de
 * corte → FIPS que el nivel 2 le asignó.
 */
export function aplicarEncabezados(
  ctx: CtxNivel,
  p: EncabezadosPropuestos,
  cortes: Map<string, EntradaCorte>,
  routes: Via[],
  condadosDeCorte: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const nombresCondados = ctx.condados.map((c) => c.name);
  const aceptados = new Map<string, { lineas: string[]; citas: CitaPropuesta[]; dudas: string[] }[]>();
  for (const c of p.captions) {
    const entrada = cortes.get(c.courtKey);
    if (!entrada) {
      ctx.nota(null, `Encabezado para «${c.courtKey}» descartado: esa corte no está en el paquete.`);
      continue;
    }
    const lineas = c.lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const comprobadas = ctx.comprobar(c.citations);
    const validas = lineas.length > 0 && lineas.every((l) => huecosValidos(l) && conPalabra(l));
    const aceptadas = comprobadas.map((x) => x.found && ctx.oficial(x.url));
    const muestra = (i: number, l: string) => aceptadas[i] === true && lineaEnCita(l, comprobadas[i]!.quote, ctx.nombreEstado, nombresCondados);
    const todas = validas && lineas.every((l) => comprobadas.some((_, i) => muestra(i, l)));
    if (!todas) {
      ctx.nota(c.courtKey, `Encabezado propuesto sin una cita oficial que muestre cada línea: ${lineas.join(" / ").slice(0, 200)}`);
      continue;
    }
    const ajeno = deOtraCorte(lineas, entrada.corte, condadosDeCorte.get(c.courtKey) ?? new Set(), ctx.lector);
    if (ajeno) {
      ctx.nota(c.courtKey, `Encabezado propuesto que no es de esta corte (${ajeno}): ${lineas.join(" / ").slice(0, 200)}`);
      continue;
    }
    const lista = aceptados.get(c.courtKey) ?? [];
    lista.push({ lineas, citas: c.citations.filter((_, i) => lineas.some((l) => muestra(i, l))), dudas: c.dudas });
    aceptados.set(c.courtKey, lista);
  }
  for (const [courtKey, propuestas] of aceptados) {
    const entrada = cortes.get(courtKey)!;
    if (new Set(propuestas.map((x) => x.lineas.join("\n"))).size > 1) {
      ctx.nota(courtKey, `Encabezados distintos aceptados para la misma corte: no se aplica ninguno (${propuestas.map((x) => x.lineas.join(" / ")).join(" | ").slice(0, 300)}).`);
      continue;
    }
    const vistas = new Set<string>();
    const citas = propuestas.flatMap((x) => x.citas).filter((c) => !vistas.has(`${c.url}\n${c.quote}`) && vistas.add(`${c.url}\n${c.quote}`));
    const ev = ctx.citar(courtKey, "caption", citas);
    entrada.corte.caption = propuestas[0]!.lineas;
    entrada.corte.evidenceKeys.push(...ev.claves);
    entrada.dudas.push(...propuestas.flatMap((x) => x.dudas));
  }
  for (const s of p.caseStyles) {
    const r = routes.find((x) => x.key === s.routeKey);
    if (!r) {
      ctx.nota(null, `Título del caso para «${s.routeKey}» descartado: esa vía no está en el paquete.`);
      continue;
    }
    const estilo = s.caseStyle.replace(/\s+/g, " ").trim();
    const comprobadas = ctx.comprobar(s.citations);
    const muestran = comprobadas.map((x) => x.found && ctx.oficial(x.url) && lineaEnCita(estilo, x.quote, ctx.nombreEstado, nombresCondados));
    if (!estilo || !huecosValidos(estilo) || !conPalabra(estilo) || !muestran.some(Boolean)) {
      ctx.nota(r.key, `Título del caso propuesto sin una cita oficial que lo muestre: ${estilo.slice(0, 200)}`);
      continue;
    }
    const ev = ctx.citar(r.key, "caseStyle", s.citations.filter((_, i) => muestran[i]));
    r.caseStyle = estilo;
    r.evidenceKeys.push(...ev.claves);
    for (const d of s.dudas) ctx.nota(r.key, d);
  }
}
