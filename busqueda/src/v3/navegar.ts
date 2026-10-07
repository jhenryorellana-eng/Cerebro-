// src/v3/navegar.ts
import type { Paquete } from "../contrato/paquete.js";
import type { Respuesta } from "../ia.js";
import type { Captura } from "../navegador.js";
import { urlCanonica } from "../paquete.js";
import { filtrarUrls, type ResultadoDescubrir } from "../tareas/descubrir.js";
import { paginaDeCaptura, type PaginaV3, type Uso } from "./capturasGuardadas.js";

/** Algo que falta en el paquete y se puede buscar en una página oficial. */
export interface Hueco {
  id: string;
  uso: Uso;
  objetivo: string;
  /** Cuántas URL de la búsqueda se capturan como mucho (MAX_URLS si no se dice). */
  maxUrls?: number;
}

const MAX_URLS = 6;
/** De cada ficha HTML de un hueco de formularios se siguen como mucho estos enlaces a PDF, y en todo el hueco estos. */
const MAX_PDF_POR_PAGINA = 3;
const MAX_PDF_POR_HUECO = 8;

/** Lo que la fábrica necesita para navegar, inyectable: los tests no abren Brave. */
export interface NavegacionFabrica {
  descubrir(objetivo: string, dominios: string[]): Promise<Respuesta<ResultadoDescubrir>>;
  capturar(url: string): Promise<Captura>;
  /** Comprobación forzada de la salida (VPN): lanza si no está bien. Se llama antes de dar por navegado un hueco con capturas fallidas. */
  confirmarSalida?(): Promise<void>;
}

export interface Navegado {
  fecha: string;
  urls: string[];
}

/** Qué hay que ir a buscar, a partir del paquete de los niveles 0-2 (spec §6.1: solo se navega para lo que falte). */
export function huecosDe(nombre: string, p: Paquete): Hueco[] {
  const huecos: Hueco[] = [];
  const tipos = new Map(p.courtTypes.map((t) => [t.key, t.officialName]));
  if (p.framework.majorityAge === null) {
    huecos.push({ id: "marco:mayoria-de-edad", uso: "marco", objetivo: `el artículo de la ley de ${nombre} que fija la mayoría de edad (age of majority): a qué edad deja de ser menor una persona` });
  }
  if (p.framework.hasSijsStatute === null) {
    huecos.push({ id: "marco:ley-sijs", uso: "marco", objetivo: `si ${nombre} tiene una ley estatal propia sobre los hallazgos para Special Immigrant Juvenile Status (special findings), y su artículo` });
  }
  for (const r of p.routes) {
    const f3 = r.filters.find((f) => f.filtro === "F3");
    const edadDebil = r.ageLimitExclusive === null || r.ageBasis === null || r.ageBasis === "definicion_general";
    if ((f3 && !f3.ok) || edadDebil) {
      huecos.push({
        id: `via:${r.key}`,
        uso: "reglas",
        objetivo: `el estatuto vigente y la página oficial de la corte sobre el procedimiento «${r.officialName}» de ${nombre} (${tipos.get(r.courtTypeKey) ?? "corte"}): quién lo presenta y hasta qué edad del menor puede la corte dictar la orden`,
      });
    }
  }
  for (const t of [...new Set(p.routes.map((r) => r.courtTypeKey))]) {
    const tipo = tipos.get(t) ?? t;
    const vias = p.routes.filter((r) => r.courtTypeKey === t).map((r) => `«${r.officialName}»`).join(", ");
    // Un tipo usado sin ninguna asignación (Virginia, si el directorio del arranque no sirvió): su directorio de cortes.
    // Con alguna ya no: hay tipos que solo existen en unos condados (la Separate Juvenile Court de Nebraska, en tres).
    if (p.framework.assignmentUnit !== "pueblo" && !p.assignments.some((a) => a.courtTypeKey === t)) {
      huecos.push({
        id: `cortes:${t}`,
        uso: "cortes",
        objetivo: `el directorio oficial de las cortes «${tipo}» de ${nombre} que dice qué corte atiende cada condado (y cada ciudad independiente, si el estado las tiene): lista de cortes por localidad o por distrito judicial`,
        maxUrls: 8,
      });
    }
    huecos.push({ id: `sedes:${t}`, uso: "sedes", objetivo: `el directorio oficial de sedes de las cortes «${tipo}» de ${nombre}: nombre del edificio, dirección postal completa y qué condados o zonas atiende cada sede` });
    huecos.push({ id: `formularios:${t}`, uso: "formularios", objetivo: `los formularios oficiales en PDF para presentar ${vias} ante la «${tipo}» de ${nombre}: petición, moción u orden de hallazgos SIJS, orden propuesta y solicitud de exención de tasas. Devuelve las URL de los PDF` });
    huecos.push({ id: `requisitos:${t}`, uso: "requisitos", objetivo: `lo que exige la «${tipo}» de ${nombre} para presentar ${vias}: tasa de presentación y su exención, notificación a los padres, residencia mínima, intérprete, copias y presentación electrónica` });
    huecos.push({ id: `encabezado:${t}`, uso: "encabezado", objetivo: `un formulario u orden oficial de la «${tipo}» de ${nombre} donde se vea el encabezado (caption) del escrito, con el nombre de la corte y del condado` });
    // Asignaciones sin dos páginas que liguen el condado a su corte: el estatuto de los distritos y las páginas de cada
    // distrito o corte le dan al código la segunda fuente. Esas páginas no entran en ningún prompt.
    if (p.assignments.some((a) => a.courtTypeKey === t && a.territory.kind === "condado" && a.filters.some((f) => f.filtro === "F3" && !f.ok))) {
      huecos.push({
        id: `ligaduras:${t}`,
        uso: "ligaduras",
        objetivo: `las páginas oficiales de ${nombre} que dicen qué condados forman cada distrito o circuito judicial y qué corte «${tipo}» atiende cada condado: el estatuto que crea los distritos, el mapa o directorio de distritos y la página de cada distrito o de cada corte`,
        maxUrls: 8,
      });
    }
  }
  return huecos;
}

/**
 * Lo primero que se busca de un estado sin ninguna página guardada (Virginia): el marco, las vías y el directorio de
 * cortes por localidad. Con eso se hacen los niveles 0-2, y después los huecos de siempre.
 */
export function huecosArranque(nombre: string): Hueco[] {
  return [
    {
      id: "arranque:marco",
      uso: "marco",
      objetivo: `la ley de ${nombre} que fija la mayoría de edad (age of majority) y, si existe, la ley estatal sobre los hallazgos para Special Immigrant Juvenile Status (special findings), con sus artículos`,
    },
    {
      id: "arranque:reglas",
      uso: "reglas",
      objetivo: `los procedimientos de ${nombre} en los que una corte puede dictar los hallazgos SIJS (custodia, tutela, dependencia o una petición propia): qué tipo de corte los ve, quién los presenta y hasta qué edad del menor`,
    },
    {
      id: "arranque:cortes",
      uso: "cortes",
      objetivo: `el directorio oficial de cortes de ${nombre} que dice qué corte atiende cada condado y cada ciudad independiente en los casos de custodia y tutela de menores (lista de cortes por localidad o por distrito judicial)`,
      maxUrls: 10,
    },
  ];
}

/**
 * Busca las páginas oficiales de un hueco y las captura. Si una captura lanza (VPN caída: SinSalidaError), el error
 * sube sin devolver nada: el hueco no se da por navegado y la próxima orden lo vuelve a intentar.
 */
export async function navegarHueco(
  h: Hueco,
  dominios: string[],
  nav: NavegacionFabrica,
  ahora: () => Date = () => new Date(),
  /**
   * Las URL (canónicas) de las páginas que ya se tienen. Ningún hueco las vuelve a capturar: su texto es el que ya leyeron
   * los prompts y las citas, y una recaptura con otro texto (una página dinámica que no cargó) la sustituiría. Las que
   * encuentra la búsqueda se devuelven en `yaCapturadas`, para sumarles el uso del hueco; un hueco «ligaduras» busca
   * solo páginas nuevas (el código ya lee todas las que se tienen).
   */
  conocidas: ReadonlySet<string> = new Set(),
): Promise<{ paginas: PaginaV3[]; navegado: Navegado; costUsd: number; yaCapturadas: string[] }> {
  const d = await nav.descubrir(h.objetivo, dominios);
  const encontradas = filtrarUrls(d.data.urls.map((u) => u.url), dominios, d.data.urls.length);
  const nueva = (u: string) => !conocidas.has(urlCanonica(u));
  const max = h.maxUrls ?? MAX_URLS;
  const elegidas = h.uso === "ligaduras" ? encontradas.filter(nueva).slice(0, max) : encontradas.slice(0, max);
  const urls = elegidas.filter(nueva);
  const yaCapturadas = elegidas.filter((u) => !nueva(u));
  const paginas: PaginaV3[] = [];
  const enlacesPdf: string[] = [];
  let fallo = false;
  const capturarUna = async (url: string) => {
    const c = await nav.capturar(url);
    // Una URL nueva que redirige a una página que ya se tiene: cuenta como ya capturada, con el texto que ya tenía.
    if (c.problema === null && c.sha256 && !nueva(c.finalUrl)) yaCapturadas.push(c.finalUrl);
    else if (c.problema === null && c.sha256) {
      paginas.push(paginaDeCaptura(c, h.uso, ahora().toISOString()));
      enlacesPdf.push(...(c.enlacesPdf ?? []).slice(0, MAX_PDF_POR_PAGINA));
    }
    // Cualquier problema (también «pdf»: una descarga cortada a medias) puede ser la VPN caída.
    else fallo = true;
  };
  for (const url of urls) await capturarUna(url);
  // La ficha HTML de un formulario enlaza su PDF: se sigue el enlace, solo a dominios oficiales.
  // Sin repetir lo que ya trajo la búsqueda (misma página aunque cambien el ancla, la barra final o el www.).
  const vistas = new Set(elegidas.map(urlCanonica));
  const enlazados = h.uso === "formularios" ? filtrarUrls(enlacesPdf, dominios, enlacesPdf.length).filter((u) => !vistas.has(urlCanonica(u))).slice(0, MAX_PDF_POR_HUECO) : [];
  const pdfs = enlazados.filter(nueva);
  yaCapturadas.push(...enlazados.filter((u) => !nueva(u)));
  for (const url of pdfs) await capturarUna(url);
  // Una captura fallida puede ser la VPN caída y no la página: se comprueba la salida antes de dar el hueco por navegado.
  if (fallo) await nav.confirmarSalida?.();
  // `urls` del navegado: lo que se capturó de nuevo (las que ya se tenían van en yaCapturadas).
  return { paginas, navegado: { fecha: ahora().toISOString(), urls: [...urls, ...pdfs] }, costUsd: d.costUsd, yaCapturadas };
}
