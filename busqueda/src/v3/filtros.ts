import type { BaseEdad, CategoriaVia, Filtro, TerritorioSede } from "../contrato/vocabularios.js";
import type { Cita } from "../esquemas.js";
import { ordinalesDe } from "./condadosEnTexto.js";

/** Resultado de un filtro sobre un dato (el mismo formato que el contrato v2). */
export interface ResultadoFiltro {
  filtro: Filtro;
  ok: boolean;
  detalle?: string;
}

const bien = (filtro: Filtro): ResultadoFiltro => ({ filtro, ok: true });
const mal = (filtro: Filtro, detalle: string): ResultadoFiltro => ({ filtro, ok: false, detalle });

/** Frases con las que el recolector reconoce que no está seguro (spec §6.3, F7). */
export const FRASES_DUDA: readonly RegExp[] = [
  /conviene (verificar|confirmar|comprobar)/i,
  /\bno\b[^.]{0,40}\bconfirmad/i,
  /inferenc|se infiere|infer[íi]/i,
  /que (lo )?confirme un abogado/i,
  /un abogado (lo )?confirme/i,
  /no (lo )?dice (expresamente|de forma expresa)/i,
  /no queda claro|ambig/i,
];

export function hayDuda(texto: string): boolean {
  return FRASES_DUDA.some((r) => r.test(texto));
}

const plano = (sha: string) => sha.replace(/-/g, "").toLowerCase();

/** F1: hay al menos una cita y todas existen letra por letra en su página. */
export function f1(citas: Cita[]): ResultadoFiltro {
  if (citas.length === 0) return mal("F1", "sin citas");
  const malas = citas.filter((c) => !c.found).length;
  return malas === 0 ? bien("F1") : mal("F1", `${malas} cita(s) no están en su página`);
}

/** F2 de una vía: la pregunta precisa de la edad tiene respuesta con base declarada y ley; una definición general no vale. */
export function f2Via(v: { ageLimitExclusive: number | null; ageBasis: BaseEdad | null; statute: string | null }): ResultadoFiltro {
  if (v.ageLimitExclusive === null || v.ageBasis === null || !v.statute) return mal("F2", "edad sin base o sin ley");
  if (v.ageBasis === "definicion_general") return mal("F2", "la edad sale de una definición general");
  return bien("F2");
}

/** F2 de los demás datos: cada campo que se afirma tiene al menos una cita comprobada. */
export function f2Campos(citasPorCampo: Cita[][]): ResultadoFiltro {
  return citasPorCampo.every((c) => c.some((x) => x.found)) ? bien("F2") : mal("F2", "un campo sin cita comprobada");
}

/** F3: el dato lo confirman al menos dos páginas oficiales distintas. */
export function f3(citas: Cita[]): ResultadoFiltro {
  const paginas = new Set(citas.filter((c) => c.found).map((c) => plano(c.pageSha256)));
  return paginas.size >= 2 ? bien("F3") : mal("F3", `solo ${paginas.size} página(s) lo confirma(n)`);
}

/** F3 de una asignación por condado: al menos dos páginas oficiales distintas ligan el condado a su corte (o a su distrito). */
export function f3Ligadura(paginas: number): ResultadoFiltro {
  return paginas >= 2 ? bien("F3") : mal("F3", `solo ${paginas} página(s) oficial(es) ligan el condado a su corte`);
}

/** F5 de una vía: su edad es coherente con la mayoría de edad y con una ley SIJS propia. */
export function f5Via(
  v: { category: CategoriaVia; ageLimitExclusive: number | null },
  marco: { majorityAge: number | null; hasSijsStatute: boolean | null },
): ResultadoFiltro {
  const edad = v.ageLimitExclusive;
  if (edad !== null && marco.majorityAge !== null && ["tutela", "custodia", "dependencia"].includes(v.category) && edad < marco.majorityAge) {
    return mal("F5", `límite ${edad} menor que la mayoría de edad del estado (${marco.majorityAge})`);
  }
  if (edad !== null && marco.hasSijsStatute === true && v.category === "hallazgos_independientes" && edad < 21) {
    return mal("F5", `el estado tiene ley SIJS propia y la vía de hallazgos acaba a los ${edad}`);
  }
  return bien("F5");
}

/** Un tipo de corte que existe en cada condado («County Court»): su corte se nombra por el condado, no por el distrito. */
export const esTipoDeCondado = (tipo: string): boolean => /\bcounty\b/i.test(tipo);

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ¿El texto menciona alguna de estas frases como palabras completas? Sin letra ni dígito pegado a cada lado (no `\b`):
 * así casa una frase que empieza o acaba en puntuación («8080 S. Redwood Rd.», «(SIJ)»).
 */
export function nombraAlguno(nombre: string, condados: readonly string[]): boolean {
  return condados.some((c) => c.trim() !== "" && new RegExp(`(?<![A-Za-z0-9])${escapar(c.trim())}(?![A-Za-z0-9])`, "i").test(nombre));
}

/**
 * F5 de una corte: un distrito o circuito no es una corte («8th Judicial District»), y una corte de un tipo por condado
 * tiene que nombrar un condado («County Court, 10th Judicial District» no es la corte de ningún condado). Una corte que
 * se nombra por su distrito y no por un condado («Third District Juvenile Court», «Chancery Court District 1») solo pasa
 * si ese nombre aparece literal en alguna página oficial (`paginasConNombre`): el extractor a veces lo forma juntando el
 * tipo y el número del distrito, y esa corte no existe con ese nombre. Y una corte que se llama como un tipo de corte
 * (`nombresDeTipo`: quien llama los pasa solo para una corte con distrito, «Juvenile Court» del 3rd Judicial District)
 * no es ninguna corte concreta: la de ese distrito tiene su propio nombre, y el distrito solo lo dice el extractor.
 */
export function f5Corte(
  nombre: string,
  tipo = "",
  condados: readonly string[] = [],
  paginasConNombre = 1,
  nombresDeTipo: readonly string[] = [],
): ResultadoFiltro {
  const normal = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (nombresDeTipo.some((t) => normal(t) === normal(nombre))) return mal("F5", `«${nombre}» es el nombre de un tipo de corte, no el de una corte concreta`);
  if (/\b(district|circuit)\b/i.test(nombre) && !/\bcourt\b/i.test(nombre)) return mal("F5", `«${nombre}» es un distrito, no una corte`);
  // «8th Judicial District Court»: puede ser una corte real (Nevada), pero es la trampa de Kansas; que lo confirme una persona.
  if (/\bjudicial\s+(district|circuit)\b/i.test(nombre) && !nombraAlguno(nombre, condados)) {
    return mal("F5", `«${nombre}» se nombra por su distrito judicial y no por un condado`);
  }
  if (esTipoDeCondado(tipo) && condados.length > 0 && !nombraAlguno(nombre, condados)) {
    return mal("F5", `«${nombre}» es de tipo «${tipo}» y no nombra su condado`);
  }
  if (paginasConNombre < 1 && ordinalesDe(nombre).length > 0 && !nombraAlguno(nombre, condados)) {
    return mal("F5", `«${nombre}» se nombra por su distrito y ese nombre no aparece en ninguna página oficial`);
  }
  return bien("F5");
}

/**
 * F5 de una asignación: una sola corte para el condado y el tipo; que la corte pase su propio F5 (no es un distrito);
 * si el tipo es por condado, que sea la de ese condado; que no sea la corte que se nombra por otro condado; y que ninguna
 * página oficial ligue el condado a otra corte del tipo o a otro distrito (`contradiccion`).
 */
export function f5Asignacion(
  cortes: string[],
  corteNoPasaF5: boolean,
  corteSinCondado = false,
  corteDeOtroCondado = false,
  contradiccion: { url: string; fragmento: string } | null = null,
): ResultadoFiltro {
  if (cortes.length > 1) return mal("F5", `el condado tiene ${cortes.length} cortes distintas del mismo tipo`);
  if (corteNoPasaF5) return mal("F5", "la corte asignada no pasa F5 (es un distrito o no se nombra por un condado)");
  if (corteSinCondado) return mal("F5", "el tipo de corte es por condado y la corte asignada no nombra este condado");
  if (corteDeOtroCondado) return mal("F5", "la corte asignada se nombra por otro condado");
  if (contradiccion) {
    return mal("F5", `una página oficial liga el condado a otra corte o a otro distrito: «${contradiccion.fragmento.slice(0, 160)}» (${contradiccion.url})`);
  }
  return bien("F5");
}

/** F1 de una asignación: todas sus citas existen y al menos una nombra el condado (si no, no prueban este dato). */
export function f1Asignacion(citas: Cita[], queNombranElCondado: Cita[]): ResultadoFiltro {
  const r = f1(citas);
  if (!r.ok) return r;
  return queNombranElCondado.length > 0 ? r : mal("F1", "ninguna cita nombra el condado");
}

export const f5Bien = (): ResultadoFiltro => bien("F5");

/** F7: el propio extractor no dudó de este dato. */
export function f7(dudas: string[], notas: string[]): ResultadoFiltro {
  const conDuda = [...dudas.filter((d) => d.trim()), ...notas.filter(hayDuda)];
  return conDuda.length === 0 ? bien("F7") : mal("F7", conDuda.join(" | ").slice(0, 300));
}

/** Un filtro en rojo con su motivo. */
export const fallo = (filtro: Filtro, detalle: string): ResultadoFiltro => mal(filtro, detalle);

/** F5 de una sede: el territorio que dice atender existe en el estado (FIPS del Census, ZIP de 5 dígitos, GEOID de pueblo). */
export function f5Sede(serves: { kind: TerritorioSede; codes: string[] } | null, fipsEstado: ReadonlySet<string>): ResultadoFiltro {
  if (serves === null) return bien("F5");
  const malos = serves.codes.filter((c) =>
    serves.kind === "condado" ? !fipsEstado.has(c) : serves.kind === "zip" ? !/^\d{5}$/.test(c) : !/^\d{7}(\d{3})?$/.test(c),
  );
  return malos.length === 0 ? bien("F5") : mal("F5", `sede fuera del territorio: ${malos.join(", ")}`);
}
