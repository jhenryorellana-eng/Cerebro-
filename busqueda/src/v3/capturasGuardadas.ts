import { z } from "zod";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Cita, Comprobacion } from "../esquemas.js";
import { leerEstado } from "../estado.js";
import { sha256Hex, type Captura } from "../navegador.js";

/**
 * Para qué nivel sirve la página: reglas y marco (niveles 0-1), cortes (2), sedes (3), formularios (4), requisitos (5),
 * encabezado (6). «ligaduras»: solo para que el código busque ahí la segunda fuente de las asignaciones; no entra en
 * ningún prompt.
 */
export const USOS = ["reglas", "cortes", "marco", "sedes", "formularios", "requisitos", "encabezado", "ligaduras"] as const;
export type Uso = (typeof USOS)[number];

/** Una página que la corrida v2 ya capturó, con la fecha real de su texto y para qué sirvió. */
export interface CapturaGuardada extends Captura {
  fecha: string;
  usos: Uso[];
}

export interface Carpetas {
  /** Estados de la corrida v2: `<estado>/<ST>.json`. */
  estado: string;
  /** Pruebas de la corrida v2: `<salida>/<ST>/pruebas/<sha>.txt`. */
  salida: string;
}

export const CARPETAS_POR_DEFECTO: Carpetas = { estado: "estado", salida: "salida" };

const plano = (sha: string) => sha.replace(/-/g, "").toLowerCase();

interface Referencia {
  url: string;
  sha: string;
  titulo: string;
  uso: Uso;
}

function referencias(citas: (Cita | Comprobacion)[], uso: Uso): Referencia[] {
  return citas
    .filter((c) => c.pageSha256)
    .map((c) => ({ url: c.url, sha: plano(c.pageSha256), titulo: "pageTitle" in c ? c.pageTitle : "", uso }));
}

/**
 * Reconstruye, sin navegar, las páginas que la corrida v2 ya capturó: las del directorio (con su texto) y las citadas
 * en reglas, cortes y verificaciones (su texto está en `pruebas/<sha>.txt`). Una página cuyo texto no coincide con su
 * sha se descarta: nunca se usa como evidencia un texto distinto del capturado.
 */
export function cargarCapturasGuardadas(estado: string, carpetas: Carpetas = CARPETAS_POR_DEFECTO): Map<string, CapturaGuardada> {
  const e = leerEstado(carpetas.estado, estado);
  const dirPruebas = join(carpetas.salida, estado, "pruebas");
  const porSha = new Map<string, CapturaGuardada>();
  const capturas = new Map<string, CapturaGuardada>();

  for (const d of e.directorio ?? []) {
    const sha = plano(d.sha256);
    if (d.problema !== null || !d.texto || sha256Hex(d.texto) !== sha) continue;
    const txt = join(dirPruebas, `${sha}.txt`);
    const c: CapturaGuardada = {
      ...d,
      sha256: sha,
      fecha: existsSync(txt) ? statSync(txt).mtime.toISOString() : new Date(0).toISOString(),
      usos: ["cortes"],
    };
    porSha.set(sha, c);
    capturas.set(d.url, c);
    capturas.set(d.finalUrl, c);
  }

  const citasCortes = [e.cortes, ...(e.lotesCortes ?? [])].flatMap((r) =>
    r ? [...r.courts.flatMap((c) => c.citations), ...r.counties.flatMap((c) => c.citations)] : [],
  );
  const refs = [
    ...referencias(
      (e.reglas?.routes ?? []).flatMap((v) => [v.route, v.courtType, v.ageLimitExclusive, v.venueRule].flatMap((a) => a.citations)),
      "reglas",
    ),
    ...referencias(e.verificacionReglas?.checks ?? [], "reglas"),
    ...referencias(citasCortes, "cortes"),
    ...referencias(e.verificacionCortes?.checks ?? [], "cortes"),
  ];
  for (const r of refs) {
    let c = porSha.get(r.sha);
    if (!c) {
      const txt = join(dirPruebas, `${r.sha}.txt`);
      if (!existsSync(txt)) continue;
      const texto = readFileSync(txt, "utf8");
      if (sha256Hex(texto) !== r.sha) continue;
      const jpg = join(dirPruebas, `${r.sha}.jpg`);
      c = {
        url: r.url,
        finalUrl: r.url,
        status: 200,
        title: r.titulo,
        texto,
        sha256: r.sha,
        textoPath: `pruebas/${r.sha}.txt`,
        capturaPath: existsSync(jpg) ? `pruebas/${r.sha}.jpg` : null,
        problema: null,
        detalle: "",
        fecha: statSync(txt).mtime.toISOString(),
        usos: [],
      };
      porSha.set(r.sha, c);
    }
    if (!c.usos.includes(r.uso)) c.usos.push(r.uso);
    if (!capturas.has(r.url)) capturas.set(r.url, c);
    if (!capturas.has(c.finalUrl)) capturas.set(c.finalUrl, c);
  }
  return capturas;
}

/** Las páginas distintas (el mapa repite cada una por su url y su url final). */
export function capturasUnicas(capturas: Map<string, CapturaGuardada>): CapturaGuardada[] {
  return [...new Set(capturas.values())];
}

/**
 * Las páginas que sirven para alguno de estos usos; si no hay ninguna, todas (los niveles 0-2 no pueden quedarse sin
 * texto) menos las que solo son de «ligaduras»: esas solo las lee el código, y en un prompt cambiarían su huella.
 */
export function paginasPara(capturas: Map<string, CapturaGuardada>, usos: Uso | readonly Uso[]): CapturaGuardada[] {
  const propias = paginasDe(capturas, typeof usos === "string" ? [usos] : usos);
  const soloLigaduras = (c: CapturaGuardada) => c.usos.length > 0 && c.usos.every((u) => u === "ligaduras");
  return propias.length > 0 ? propias : capturasUnicas(capturas).filter((c) => !soloLigaduras(c));
}

/** Las páginas que sirven para alguno de estos usos, sin caer a todas: un nivel sin páginas propias no se pide. */
export function paginasDe(capturas: Map<string, CapturaGuardada>, usos: readonly Uso[]): CapturaGuardada[] {
  return capturasUnicas(capturas).filter((c) => c.usos.some((u) => usos.includes(u)));
}

/** Una página capturada por la fábrica v3. Su texto vive en `<pruebas>/<sha>.txt`; aquí queda su URL, que la v2 no guardaba. */
export const PaginaV3 = z.strictObject({
  url: z.string(),
  finalUrl: z.string(),
  title: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  fecha: z.string(),
  usos: z.array(z.enum(USOS)),
  pdfPath: z.string().nullable(),
  capturaPath: z.string().nullable(),
});
export type PaginaV3 = z.infer<typeof PaginaV3>;

export function paginaDeCaptura(c: Captura, uso: Uso, fecha: string): PaginaV3 {
  return { url: c.url, finalUrl: c.finalUrl, title: c.title, sha256: c.sha256, fecha, usos: [uso], pdfPath: c.pdfPath ?? null, capturaPath: c.capturaPath };
}

/** Une dos listas de páginas: la misma URL con el mismo texto suma sus usos. No modifica las de entrada. */
export function fusionarPaginas(previas: PaginaV3[], nuevas: PaginaV3[]): PaginaV3[] {
  const salida = previas.map((p) => ({ ...p, usos: [...p.usos] }));
  for (const n of nuevas) {
    const igual = salida.find((p) => p.url === n.url && p.sha256 === n.sha256);
    if (igual) {
      for (const u of n.usos) if (!igual.usos.includes(u)) igual.usos.push(u);
    } else {
      salida.push({ ...n, usos: [...n.usos] });
    }
  }
  return salida;
}

/**
 * Añade al mapa las páginas de la v3. Como en la v2, una página cuyo texto ya no casa con su sha (o sin archivo)
 * no entra. Una página de la v3 sustituye a la de la corrida v2 con su URL; entre páginas de la v3 gana la primera
 * captura, y una posterior de la misma URL con otro texto solo le suma sus usos (una recaptura de una página dinámica
 * que no cargó dejaría sin texto a los niveles que la usaban). Devuelve un mapa nuevo: el de entrada no se toca.
 */
export function anadirPaginasV3(capturas: Map<string, CapturaGuardada>, paginas: PaginaV3[], dirPruebas: string): Map<string, CapturaGuardada> {
  const m = new Map(capturas);
  const deV3 = new Set<CapturaGuardada>();
  for (const p of paginas) {
    const previa = m.get(p.url) ?? m.get(p.finalUrl);
    if (previa && (previa.sha256 === p.sha256 || deV3.has(previa))) {
      const unida: CapturaGuardada = { ...previa, usos: [...new Set([...previa.usos, ...p.usos])] };
      for (const [k, v] of m) if (v === previa) m.set(k, unida);
      if (deV3.has(previa)) deV3.add(unida);
      continue;
    }
    const txt = join(dirPruebas, `${p.sha256}.txt`);
    if (!existsSync(txt)) continue;
    const texto = readFileSync(txt, "utf8");
    if (sha256Hex(texto) !== p.sha256) continue;
    const c: CapturaGuardada = {
      url: p.url,
      finalUrl: p.finalUrl,
      status: 200,
      title: p.title,
      texto,
      sha256: p.sha256,
      textoPath: `pruebas/${p.sha256}.txt`,
      capturaPath: p.capturaPath,
      problema: null,
      detalle: "",
      fecha: p.fecha,
      usos: [...p.usos],
      ...(p.pdfPath ? { pdfPath: p.pdfPath } : {}),
    };
    m.set(p.url, c);
    m.set(p.finalUrl, c);
    deV3.add(c);
  }
  return m;
}
