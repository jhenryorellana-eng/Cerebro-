// src/v3/ligaduras.ts
import { mismoOrdinal, ordinalesDe, otroOrdinal, type LectorDeCondados, type ListaDeCondados, type Ordinal, type OrdinalEnTexto } from "./condadosEnTexto.js";

/** Una corte del paquete tal como la ve el buscador de ligaduras. */
export interface CorteLigable {
  key: string;
  tipoKey: string;
  /** Nombre canónico y alias. */
  nombres: string[];
  ordinal: Ordinal | null;
}

/** Una página oficial capturada (sha sin guiones, en minúsculas). */
export interface PaginaLigable {
  url: string;
  sha: string;
  texto: string;
}

/** Un trozo literal de una página que liga un condado a una corte (o a otra). */
export interface Ligadura {
  url: string;
  sha: string;
  fragmento: string;
}

export interface ResultadoLigar {
  /** Una por página: las páginas oficiales que ligan el condado a esta corte. */
  apoyan: Ligadura[];
  /** Los trozos que lo ligan a otra corte del mismo tipo o a otro distrito. */
  contradicen: Ligadura[];
}

/** Dónde aparece en una página uno de los nombres de una corte. */
interface Aparicion {
  key: string;
  nombre: string;
  inicio: number;
  fin: number;
}

/** Lo que va pegado a un lado de una lista: el nombre de una corte, un distrito, o los dos. */
interface Lado {
  corte: Aparicion | null;
  ordinal: OrdinalEnTexto | null;
}

interface IndicePagina {
  pagina: PaginaLigable;
  listas: ListaDeCondados[];
  /** Por corte: dónde aparece alguno de sus nombres propios (los que comparte con otra corte no cuentan). */
  apariciones: Map<string, Aparicion[]>;
  /** De qué cuelga cada lista: lo de delante si enumera varios condados; con uno, lo de delante y lo de detrás si coinciden. */
  ladoDeLista: Map<ListaDeCondados, Lado>;
}

/** Un trozo más largo que esto no es una frase que ligue nada: se descarta. */
export const MAX_FRAGMENTO = 400;

const normal = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Dónde aparece la frase como palabras completas, sin distinguir mayúsculas (el texto capturado ya viene normalizado). */
function aparicionesDe(bajo: string, frase: string): [number, number][] {
  const f = normal(frase);
  if (f.length < 4) return [];
  const salida: [number, number][] = [];
  for (let i = bajo.indexOf(f); i >= 0; i = bajo.indexOf(f, i + 1)) {
    const antes = bajo[i - 1];
    const despues = bajo[i + f.length];
    if ((antes === undefined || !/[a-z0-9]/.test(antes)) && (despues === undefined || !/[a-z0-9]/.test(despues))) salida.push([i, i + f.length]);
  }
  return salida;
}

/**
 * Busca en las páginas oficiales capturadas lo que liga un condado a su corte, sin IA:
 * - una lista de condados que cuelga del distrito de la corte («Fifth Judicial District, which includes Beaver, Iron,
 *   and Washington Counties», «Summit County - Third District») o de su nombre («Third District Juvenile Court: Salt
 *   Lake County»);
 * - un nombre de la corte que ya nombra el condado («Superior Court of California, County of Alameda»).
 * Lo mismo hacia otra corte del tipo, o hacia otro distrito del mismo sistema, es una contradicción. Una lista de un solo
 * condado con una corte (o un distrito) delante y otra distinta detrás no se liga a ninguna: en una tabla «condado corte
 * condado corte» no se sabe de cuál es. Un nombre que comparten dos cortes («Separate Juvenile Court») no liga a ninguna.
 */
export class IndiceLigaduras {
  private readonly cortes = new Map<string, CorteLigable>();
  /** Por corte y nombre: los condados que ese nombre nombra («… County of Alameda» → Alameda). */
  private readonly nombraA = new Map<string, Map<string, Set<string>>>();
  private readonly paginas: IndicePagina[];

  /**
   * `nombresGenericos`: los nombres oficiales de los tipos de corte («Juvenile Court», «County Court»). Un nombre así no
   * identifica a ninguna corte concreta, aunque el extractor lo ponga de alias de una sola.
   */
  constructor(
    private readonly lector: LectorDeCondados,
    paginas: readonly PaginaLigable[],
    cortes: readonly CorteLigable[],
    nombresGenericos: readonly string[] = [],
  ) {
    const genericos = new Set(nombresGenericos.map(normal));
    const duenos = new Map<string, Set<string>>();
    for (const c of cortes) for (const n of c.nombres) duenos.set(normal(n), (duenos.get(normal(n)) ?? new Set<string>()).add(c.key));
    for (const c of cortes) {
      const propios = [...new Set(c.nombres.map(normal))].filter((n) => n.length >= 4 && duenos.get(n)!.size === 1 && !genericos.has(n));
      const originales = c.nombres.filter((n) => propios.includes(normal(n)));
      // Sin ningún nombre propio, su distrito solo lo dice el extractor: la corte no se liga por él.
      this.cortes.set(c.key, { ...c, nombres: originales, ordinal: originales.length > 0 ? c.ordinal : null });
      this.nombraA.set(c.key, new Map(originales.map((n) => [normal(n), new Set(lector.condados.filter((x) => lector.nombra(n, x.fips)).map((x) => x.fips))])));
    }
    this.paginas = paginas.map((p) => this.indexar(p));
  }

  private indexar(pagina: PaginaLigable): IndicePagina {
    const bajo = pagina.texto.toLowerCase();
    const apariciones = new Map<string, Aparicion[]>();
    for (const c of this.cortes.values()) {
      const todas = c.nombres.flatMap((nombre) => aparicionesDe(bajo, nombre).map(([inicio, fin]) => ({ key: c.key, nombre: normal(nombre), inicio, fin })));
      if (todas.length > 0) apariciones.set(c.key, todas);
    }
    const todas = [...apariciones.values()].flat();
    const listas = this.lector.analizar(pagina.texto).listas;
    const ladoDeLista = new Map<ListaDeCondados, Lado>();
    for (const l of listas) {
      // La corte más larga de las que acaban donde acaba el encabezado, y la más larga de las que empiezan detrás.
      const antes: Lado = { corte: todas.filter((x) => x.fin === l.finEncabezado).sort((x, y) => x.inicio - y.inicio)[0] ?? null, ordinal: l.ordinalPrevio };
      const despues: Lado = { corte: todas.filter((x) => x.inicio === l.inicioPosterior).sort((x, y) => y.fin - x.fin)[0] ?? null, ordinal: l.ordinalPosterior };
      const hay = (x: Lado) => x.corte !== null || x.ordinal !== null;
      const lado =
        l.elementos.length >= 2
          ? hay(antes)
            ? antes
            : null
          : hay(antes) && hay(despues)
            ? this.coinciden(antes, despues)
              ? antes
              : null
            : hay(antes)
              ? antes
              : // Lo de detrás solo, con un signo por medio («Salt Lake County: Third District Juvenile Court»); sin signo puede ser la fila siguiente.
                hay(despues) && l.signoPosterior
                ? despues
                : null;
      if (lado) ladoDeLista.set(l, lado);
    }
    return { pagina, listas, apariciones, ladoDeLista };
  }

  /** Lo de delante y lo de detrás de una lista de un solo condado señalan la misma corte o el mismo distrito. */
  private coinciden(a: Lado, b: Lado): boolean {
    if (a.corte && b.corte) return a.corte.key === b.corte.key;
    const oa = a.ordinal ?? (a.corte ? (this.cortes.get(a.corte.key)?.ordinal ?? null) : null);
    const ob = b.ordinal ?? (b.corte ? (this.cortes.get(b.corte.key)?.ordinal ?? null) : null);
    return oa !== null && ob !== null && mismoOrdinal(oa, ob);
  }

  /**
   * En cuántas páginas oficiales distintas aparece literal un nombre propio de la corte que lleva su distrito («Third
   * District Juvenile Court»; un alias sin distrito, como «Chancery Court», no prueba ese nombre). No cuenta la aparición
   * que solo forma la maquetación: el encabezado de una lista pegado a un menú («… Chancery Court District 1 Alcorn,
   * Itawamba…») o un menú de distritos («Chancery Court District 1 District 2 District 3»).
   */
  paginasConNombre(corteKey: string): number {
    const shas = new Set<string>();
    for (const ix of this.paginas) {
      const finesDeEncabezado = new Set(ix.listas.flatMap((l) => (l.ordinalPrevio ? [l.ordinalPrevio.fin] : [])));
      const iniciosDeDistrito = new Set(ordinalesDe(ix.pagina.texto).map((o) => o.inicio));
      const siguiente = (fin: number) => fin + (/^\s*/.exec(ix.pagina.texto.slice(fin))?.[0].length ?? 0);
      const literal = (a: Aparicion) => ordinalesDe(a.nombre).length > 0 && !finesDeEncabezado.has(a.fin) && !iniciosDeDistrito.has(siguiente(a.fin));
      if ((ix.apariciones.get(corteKey) ?? []).some(literal)) shas.add(ix.pagina.sha);
    }
    return shas.size;
  }

  ligar(fips: string, corteKey: string): ResultadoLigar {
    const corte = this.cortes.get(corteKey);
    if (!corte) return { apoyan: [], contradicen: [] };
    const apoyan: Ligadura[] = [];
    const contradicen: Ligadura[] = [];
    const nombraEste = (key: string, nombre: string) => this.nombraA.get(key)?.get(nombre)?.has(fips) ?? false;
    for (const ix of this.paginas) {
      const p = ix.pagina;
      const trozo = (inicio: number, fin: number): Ligadura | null =>
        fin - inicio <= MAX_FRAGMENTO ? { url: p.url, sha: p.sha, fragmento: p.texto.slice(inicio, fin).trim() } : null;
      // Una contradicción nunca se pierde por larga: se guarda su principio (solo sale en el detalle de F5).
      const recorte = (inicio: number): Ligadura => ({ url: p.url, sha: p.sha, fragmento: p.texto.slice(inicio, inicio + MAX_FRAGMENTO).trim() });
      let apoyo: Ligadura | null = null;
      for (const l of ix.listas) {
        const lado = ix.ladoDeLista.get(l);
        if (!lado || !l.creditados.includes(fips)) continue;
        const { ordinal: o, corte: c } = lado;
        // El trozo va de la lista a su distrito y a su corte, los dos si están: «Salt Lake County: Third District Juvenile Court».
        const desde = Math.min(l.inicio, o?.inicio ?? l.inicio, c?.inicio ?? l.inicio);
        const t = trozo(desde, Math.max(l.fin, o?.fin ?? l.fin, c?.fin ?? l.fin));
        const apoya = (o !== null && corte.ordinal !== null && mismoOrdinal(o, corte.ordinal)) || c?.key === corte.key;
        const contradice =
          (o !== null && corte.ordinal !== null && otroOrdinal(o, corte.ordinal)) ||
          (c !== null && c.key !== corte.key && this.cortes.get(c.key)?.tipoKey === corte.tipoKey);
        // Si lo de al lado apoya y contradice a la vez (el distrito de la corte, pero el nombre de otra), gana la contradicción.
        if (contradice) contradicen.push(t ?? recorte(desde));
        else if (apoya) apoyo ??= t;
      }
      for (const [key, lista] of ix.apariciones) {
        const otra = this.cortes.get(key)!;
        if (otra.tipoKey !== corte.tipoKey) continue;
        const a = lista.find((x) => nombraEste(key, x.nombre));
        const t = a ? trozo(a.inicio, a.fin) : null;
        if (!t) continue;
        if (key === corte.key) apoyo ??= t;
        else contradicen.push(t);
      }
      if (apoyo) apoyan.push(apoyo);
    }
    return { apoyan, contradicen };
  }
}
