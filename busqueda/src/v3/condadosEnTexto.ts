// src/v3/condadosEnTexto.ts
import type { Condado } from "../condados.js";
import { nucleoCondado } from "../tareas/extraer.js";

export type TipoOrdinal = "district" | "circuit";

/** Un distrito o circuito con número: «Third Judicial District», «District 8», «4th Judicial Circuit». */
export interface Ordinal {
  tipo: TipoOrdinal;
  n: number;
  /** Las palabras de corte que lo califican («chancery»), en minúsculas y por orden alfabético; "" si no hay. */
  calificador: string;
}

export interface OrdinalEnTexto extends Ordinal {
  inicio: number;
  fin: number;
}

const UNIDADES = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
const ORDINAL_SUELTO: Record<string, number> = {
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
  fortieth: 40,
  fiftieth: 50,
};
const DECENAS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const CARDINALES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};
const P_ORDINAL = String.raw`\d{1,3}(?:st|nd|rd|th)|(?:(?:twenty|thirty|forty|fifty)[-\s]?)?(?:${UNIDADES.join("|")})|${Object.keys(ORDINAL_SUELTO).join("|")}`;
const P_CARDINAL = String.raw`\d{1,3}|${Object.keys(CARDINALES).join("|")}`;
/** «Third Judicial District», «4th Circuit», «First Chancery Court District». */
const FORMA_A = new RegExp(String.raw`(?<![A-Za-z0-9])(${P_ORDINAL})\s+(?:([A-Za-z]+)\s+)?(?:([A-Za-z]+)\s+)?(district|circuit)(?![A-Za-z0-9])`, "gi");
/** «District 8», «District Eight», «Judicial District No. 3». */
const FORMA_B = new RegExp(String.raw`(?<![A-Za-z0-9])(district|circuit)\s+(?:no\.?\s*|number\s+|#\s*)?(${P_CARDINAL})(?![A-Za-z0-9])`, "gi");

/** Palabras que dicen de qué corte es el distrito: dos distritos con calificadores distintos no son el mismo. */
const CALIFICADORES = new Set(["chancery", "probate", "juvenile", "family", "superior", "criminal", "civil", "orphans"]);
/** Distritos que no son judiciales (electorales, escolares, de servicios, de libertad vigilada): su número no dice nada de una corte. */
const AJENOS = new Set([
  "appellate",
  "probation",
  "congressional",
  "senate",
  "senatorial",
  "house",
  "legislative",
  "assembly",
  "school",
  "water",
  "fire",
  "conservation",
  "soil",
  "health",
  "hospital",
  "election",
  "voting",
  "police",
  "sheriff",
  "highway",
  "road",
  "planning",
  "zoning",
  "park",
  "parks",
  "library",
  "irrigation",
  "transit",
  "sanitation",
  "sewer",
  "drainage",
  "improvement",
  "special",
  "service",
  "tax",
  "taxing",
  "magisterial",
  "supervisor",
  "supervisors",
  "supervisorial",
  "commissioner",
  "commissioners",
  "council",
  "ward",
  "precinct",
  "federal",
  "bankruptcy",
  "united",
  "states",
  "attendance",
  "utility",
]);

function valorOrdinal(s: string): number | null {
  const x = s.toLowerCase().replace(/\s+/g, " ");
  const num = /^(\d{1,3})(?:st|nd|rd|th)$/.exec(x);
  if (num) return Number(num[1]);
  if (x in ORDINAL_SUELTO) return ORDINAL_SUELTO[x]!;
  const m = new RegExp(`^(?:(twenty|thirty|forty|fifty)[- ]?)?(${UNIDADES.join("|")})$`).exec(x);
  return m ? (m[1] ? DECENAS[m[1]]! : 0) + UNIDADES.indexOf(m[2]!) + 1 : null;
}

function valorCardinal(s: string): number | null {
  const x = s.toLowerCase();
  return /^\d{1,3}$/.test(x) ? Number(x) : (CARDINALES[x] ?? null);
}

/** El calificador de las palabras que acompañan a un ordinal, o null si es un distrito que no es judicial. */
function calificar(palabras: (string | undefined)[]): string | null {
  const ws = palabras.filter((w): w is string => !!w).map((w) => w.toLowerCase());
  if (ws.some((w) => AJENOS.has(w))) return null;
  return [...new Set(ws.filter((w) => CALIFICADORES.has(w)))].sort().join(" ");
}

/** Los distritos y circuitos con número de un texto, en orden. Los que no son judiciales («School District 5») no salen. */
export function ordinalesDe(texto: string): OrdinalEnTexto[] {
  const salida: OrdinalEnTexto[] = [];
  for (const m of texto.matchAll(FORMA_A)) {
    const n = valorOrdinal(m[1]!);
    const antes = /([A-Za-z]+)\s*$/.exec(texto.slice(Math.max(0, m.index - 30), m.index))?.[1];
    const c = calificar([antes, m[2], m[3]]);
    if (n !== null && c !== null) salida.push({ tipo: m[4]!.toLowerCase() as TipoOrdinal, n, calificador: c, inicio: m.index, fin: m.index + m[0].length });
  }
  for (const m of texto.matchAll(FORMA_B)) {
    const n = valorCardinal(m[2]!);
    const previas = /(?:([A-Za-z]+)\s+)?([A-Za-z]+)\s*$/.exec(texto.slice(Math.max(0, m.index - 40), m.index));
    const c = calificar([previas?.[1], previas?.[2]]);
    if (n !== null && c !== null) salida.push({ tipo: m[1]!.toLowerCase() as TipoOrdinal, n, calificador: c, inicio: m.index, fin: m.index + m[0].length });
  }
  return salida.sort((a, b) => a.inicio - b.inicio);
}

const mismoCalificador = (a: Ordinal, b: Ordinal) => a.calificador === "" || b.calificador === "" || a.calificador === b.calificador;
/** Dos ordinales nombran el mismo distrito: mismo tipo y número, y calificadores que no se contradicen. */
export const mismoOrdinal = (a: Ordinal, b: Ordinal): boolean => a.tipo === b.tipo && a.n === b.n && mismoCalificador(a, b);
/** Dos ordinales son distritos distintos del mismo sistema: se contradicen. */
export const otroOrdinal = (a: Ordinal, b: Ordinal): boolean => a.tipo === b.tipo && a.n !== b.n && mismoCalificador(a, b);

/** El distrito de una corte: el único que dicen su nombre, sus alias y su campo de distrito; null si ninguno o si discrepan. */
export function ordinalDeCorte(nombres: readonly string[], distrito: string | null): Ordinal | null {
  const todos = [...nombres, distrito ?? ""].flatMap((t) => ordinalesDe(t));
  const distintos = [...new Map(todos.map((o) => [`${o.tipo}:${o.n}`, o])).values()];
  if (distintos.length !== 1) return null;
  const { tipo, n } = distintos[0]!;
  const calificador = todos.find((o) => o.calificador !== "")?.calificador ?? "";
  return { tipo, n, calificador };
}

interface Token {
  texto: string;
  bajo: string;
  inicio: number;
  fin: number;
  palabra: boolean;
}

const TOKEN = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*|\d+[A-Za-z]*|[^\sA-Za-z\d]/g;

function tokens(texto: string): Token[] {
  return [...texto.matchAll(TOKEN)].map((m) => ({
    texto: m[0],
    bajo: m[0].toLowerCase().replace(/’/g, "'"),
    inicio: m.index,
    fin: m.index + m[0].length,
    palabra: /^[A-Za-z]/.test(m[0]),
  }));
}

/** Palabras que pueden ir pegadas a un nombre de condado sin formar parte de él. */
const CONECTORES = new Set([
  "of",
  "the",
  "and",
  "or",
  "in",
  "for",
  "to",
  "at",
  "by",
  "with",
  "which",
  "includes",
  "include",
  "including",
  "comprised",
  "consists",
  "consisting",
  "following",
  "counties",
  "parishes",
  "county",
  "parish",
  "is",
  "are",
  "serves",
  "serving",
  "covers",
  "covering",
]);
const esPalabraDeNombre = (t: Token) => t.palabra && /^[A-Z]/.test(t.texto) && !CONECTORES.has(t.bajo);
const SIGNOS_CONECTOR = new Set([":", ",", "-", "–", "—", "|"]);
/** Una negación entre el encabezado y la lista le quita el encabezado: «The Third District Juvenile Court does not hear cases from Summit County». */
const NEGACIONES = new Set(["not", "no", "nor", "never", "except", "excluding", "outside", "other"]);

interface Nucleo {
  palabras: string[];
  fips: string;
  ciudad: boolean;
  estado: boolean;
}

/** Un condado nombrado en un texto: «Salt Lake County», «County of Los Angeles» (explícito) o «Summit» a secas. */
export interface ElementoCondado {
  fips: string;
  explicito: boolean;
  estado: boolean;
  inicio: number;
  fin: number;
  /** Índices del primer y último token. */
  i: number;
  j: number;
}

/** Una enumeración de condados: «Box Elder, Cache, and Rich Counties», «District 1 Alcorn, Itawamba, …, Union». */
export interface ListaDeCondados {
  elementos: ElementoCondado[];
  /** Los condados que la lista nombra COMO condados (ver `analizar`). */
  creditados: string[];
  inicio: number;
  /** Fin de la lista, «Counties» incluido. */
  fin: number;
  /** Dónde acaba lo que va delante de la lista, conector aparte («Third Judicial District» de «Third Judicial District, which includes»); -1 si nada. */
  finEncabezado: number;
  /** Dónde empieza lo que va detrás, conector aparte («Third District Juvenile Court» de «Salt Lake County: Third District Juvenile Court»); -1 si nada. */
  inicioPosterior: number;
  /** Si entre la lista y lo de detrás hay algún signo («:», «-», «|»…): sin él, lo de detrás puede ser ya la fila siguiente. */
  signoPosterior: boolean;
  ordinalPrevio: OrdinalEnTexto | null;
  ordinalPosterior: OrdinalEnTexto | null;
  /** El distrito de la lista: el de delante si enumera varios condados; con uno solo, el de delante y el de detrás tienen que coincidir. */
  ordinal: OrdinalEnTexto | null;
}

export interface AnalisisCondados {
  elementos: ElementoCondado[];
  listas: ListaDeCondados[];
}

/**
 * Lee qué condados de un estado nombra un texto, en una sola pasada (sin expresiones con retroceso). Un condado se
 * nombra COMO condado si aparece explícito («Salt Lake County», «County of Los Angeles», «Baltimore City») o como
 * elemento de una lista de condados: una enumeración de al menos dos que acaba en «Counties», va tras «counties» o
 * «Counties of», o cuelga de un distrito («Fifth Judicial District, which includes Beaver, Iron, and Washington»,
 * «District 1 Alcorn, Itawamba…»; si alguno es explícito, los nombres sueltos de al lado no cuentan: «Sedgwick County,
 * Wichita»). El núcleo suelto nunca cuenta, ni en minúsculas, ni pegado a otra palabra con
 * mayúscula («Salt Lake City», «Grand Jury»). El nombre del estado dentro de una lista solo cuenta si la lista cuelga de
 * un distrito («…, Utah, Salt Lake, and Summit Counties» no nombra a Utah County). Una ciudad independiente solo con su
 * «City» («Baltimore City», «City of St. Louis»).
 */
export class LectorDeCondados {
  private readonly porPrimera = new Map<string, Nucleo[]>();
  private readonly cache = new Map<string, AnalisisCondados>();
  readonly condados: readonly Condado[];

  constructor(condados: readonly Condado[], nombreEstado: string) {
    this.condados = condados;
    const estado = nombreEstado.trim().toLowerCase();
    for (const c of condados) {
      const nucleo = nucleoCondado(c.name);
      const palabras = tokens(nucleo)
        .filter((t) => t.texto !== ".")
        .map((t) => t.bajo);
      if (palabras.length === 0) continue;
      const n: Nucleo = { palabras, fips: c.fips, ciudad: /\bcity$/i.test(c.name.trim()), estado: palabras.join(" ") === estado };
      const lista = this.porPrimera.get(palabras[0]!) ?? [];
      lista.push(n);
      lista.sort((a, b) => b.palabras.length - a.palabras.length);
      this.porPrimera.set(palabras[0]!, lista);
    }
  }

  /** ¿El texto nombra este condado como condado? */
  nombra(texto: string, fips: string): boolean {
    const a = this.analizar(texto);
    return a.elementos.some((e) => e.explicito && e.fips === fips) || a.listas.some((l) => l.creditados.includes(fips));
  }

  analizar(texto: string): AnalisisCondados {
    const guardado = this.cache.get(texto);
    if (guardado) return guardado;
    const ts = tokens(texto);
    const ordinales = ordinalesDe(texto);
    const empieza = new Map(ordinales.map((o) => [o.inicio, o]));
    const acaba = new Map(ordinales.map((o) => [o.fin, o]));
    const elementos: ElementoCondado[] = [];
    const listas: ListaDeCondados[] = [];
    for (let i = 0; i < ts.length; ) {
      const primero = this.elementoEn(ts, i, empieza, acaba);
      if (!primero) {
        i++;
        continue;
      }
      const miembros = [primero];
      let j = primero.j + 1;
      for (;;) {
        const s = separador(ts, j);
        const e = s < 0 ? null : this.elementoEn(ts, s, empieza, acaba);
        if (!e) break;
        miembros.push(e);
        j = e.j + 1;
      }
      elementos.push(...miembros);
      let fin = ts[j - 1]!.fin;
      let plural = false;
      if (ts[j] && (ts[j]!.bajo === "counties" || ts[j]!.bajo === "parishes")) {
        plural = true;
        fin = ts[j]!.fin;
        j++;
      }
      // Lo que va delante: un conector de signos, palabras en minúscula o paréntesis, y antes el encabezado.
      let k = primero.i - 1;
      let pasos = 0;
      let trasCounties = false;
      let negada = false;
      while (k >= 0 && pasos < 8) {
        const t = ts[k]!;
        if (SIGNOS_CONECTOR.has(t.texto)) {
          k--;
        } else if (t.texto === ")") {
          let a = k - 1;
          while (a >= 0 && k - a <= 8 && ts[a]!.texto !== "(") a--;
          if (a < 0 || ts[a]!.texto !== "(") break;
          k = a - 1;
        } else if (t.palabra && (/^[a-z]/.test(t.texto) || /^(counties|parishes)$/i.test(t.texto) || (t.texto === t.texto.toUpperCase() && CONECTORES.has(t.bajo)))) {
          if (t.bajo === "counties" || t.bajo === "parishes") trasCounties = true;
          if (NEGACIONES.has(t.bajo)) negada = true;
          k--;
        } else break;
        pasos++;
      }
      const finEncabezado = k >= 0 && !negada ? ts[k]!.fin : -1;
      // Lo que va detrás: como mucho tres signos de conector.
      let d = j;
      while (d < ts.length && d - j < 3 && SIGNOS_CONECTOR.has(ts[d]!.texto)) d++;
      const inicioPosterior = d < ts.length ? ts[d]!.inicio : -1;
      const signoPosterior = d > j;
      const ordinalPrevio = acaba.get(finEncabezado) ?? null;
      const ordinalPosterior = empieza.get(inicioPosterior) ?? null;
      const ordinal =
        miembros.length >= 2
          ? ordinalPrevio
          : ordinalPrevio && ordinalPosterior
            ? mismoOrdinal(ordinalPrevio, ordinalPosterior)
              ? ordinalPrevio
              : null
            : (ordinalPrevio ?? ordinalPosterior);
      // Nombres sueltos que cuelgan de un distrito solo cuentan si la lista es toda de nombres sueltos («District 1 Alcorn,
      // Itawamba…»): en «18th Judicial District: Sedgwick County, Wichita» lo que va tras el condado explícito es una ciudad.
      const esLista = miembros.length >= 2 && (plural || trasCounties || (ordinal !== null && !miembros.some((e) => e.explicito)));
      const creditados = miembros.filter((e) => e.explicito || (esLista && !(e.estado && ordinal === null))).map((e) => e.fips);
      listas.push({ elementos: miembros, creditados, inicio: primero.inicio, fin, finEncabezado, inicioPosterior, signoPosterior, ordinalPrevio, ordinalPosterior, ordinal });
      i = j;
    }
    const a = { elementos, listas };
    this.cache.set(texto, a);
    return a;
  }

  private elementoEn(ts: Token[], i: number, empieza: Map<number, OrdinalEnTexto>, acaba: Map<number, OrdinalEnTexto>): ElementoCondado | null {
    const t = ts[i];
    if (!t?.palabra) return null;
    // Primero la forma explícita de cualquier candidato («Baltimore City» es la ciudad, aunque «Baltimore» sea también
    // el núcleo del condado); después, la implícita.
    let implicito: ElementoCondado | null = null;
    for (const n of this.porPrimera.get(t.bajo) ?? []) {
      let j = i;
      let ok = true;
      for (let k = 1; k < n.palabras.length && ok; k++) {
        j++;
        if (ts[j]?.texto === ".") j++;
        ok = ts[j]?.bajo === n.palabras[k];
      }
      if (!ok) continue;
      const sufijo = sufijoEn(ts, j + 1, n.ciudad);
      const prefijo = ts[i - 1]?.bajo === "of" && (n.ciudad ? ts[i - 2]?.bajo === "city" : ts[i - 2]?.bajo === "county" || ts[i - 2]?.bajo === "parish");
      if (sufijo >= 0 || prefijo) {
        const ultimo = sufijo >= 0 ? sufijo : j;
        return { fips: n.fips, explicito: true, estado: n.estado, inicio: t.inicio, fin: ts[ultimo]!.fin, i, j: ultimo };
      }
      if (implicito || n.ciudad || !/^[A-Z]/.test(t.texto)) continue;
      const antes = ts[i - 1];
      const despues = ts[j + 1];
      if (antes && esPalabraDeNombre(antes) && !acaba.has(antes.fin)) continue;
      // «City of Lancaster»: es la ciudad, no el condado homónimo.
      if (antes?.bajo === "of" && ["city", "town", "village"].includes(ts[i - 2]?.bajo ?? "")) continue;
      if (despues && esPalabraDeNombre(despues) && !empieza.has(despues.inicio)) continue;
      implicito = { fips: n.fips, explicito: false, estado: n.estado, inicio: t.inicio, fin: ts[j]!.fin, i, j };
    }
    return implicito;
  }
}

/** Índice del último token del tipo que sigue al núcleo («County», «Census Area», «City»), o -1. */
function sufijoEn(ts: Token[], k: number, ciudad: boolean): number {
  const b = ts[k]?.bajo;
  if (ciudad) return b === "city" ? k : -1;
  if (b === "county" || b === "parish" || b === "borough" || b === "municipality" || b === "municipio") return k;
  if (b === "census" && ts[k + 1]?.bajo === "area") return k + 1;
  if (b === "city" && ts[k + 1]?.bajo === "and" && ts[k + 2]?.bajo === "borough") return k + 2;
  return -1;
}

/** Índice del token que sigue a un separador de lista («,», «&», «and», «, and», «, &»), o -1. */
function separador(ts: Token[], j: number): number {
  const t = ts[j];
  if (t?.texto === ",") return ts[j + 1]?.bajo === "and" || ts[j + 1]?.texto === "&" ? j + 2 : j + 1;
  if (t?.texto === "&" || t?.bajo === "and") return j + 1;
  return -1;
}
