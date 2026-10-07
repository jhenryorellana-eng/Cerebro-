import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { normalizar } from "./normalizar.js";

/** Tope del archivo: un código estatal entero ronda 5-15 MB; más que esto suele ser un escaneo o un anexo. */
export const MAX_BYTES_PDF = 30 * 1024 * 1024;
/** Tope de páginas leídas: acota el tiempo y la memoria con compilaciones enormes. */
export const MAX_PAGINAS_PDF = 600;

const FIRMA = Buffer.from("%PDF-", "latin1");

/** Firma %PDF- en los primeros 1024 bytes: Acrobat y pdf.js toleran relleno delante de la cabecera. */
export function esPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024 + FIRMA.length)).includes(FIRMA);
}

export interface TextoPdf {
  /** Title de los metadatos del PDF, o "" si no tiene. */
  titulo: string;
  /** Texto de las páginas leídas, sin normalizar: una línea por línea del PDF. */
  texto: string;
  paginas: number;
  paginasLeidas: number;
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let cargado: Promise<PdfJs> | null = null;

/** Build «legacy»: la que pdf.js publica para Node. En Node no hay Worker y pdf.js usa uno falso en el mismo hilo. */
function pdfjs(): Promise<PdfJs> {
  cargado ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return cargado;
}

/**
 * Carpeta del paquete: pdf.js lee de ahí las fuentes estándar y los CMaps con fs.readFile. Exige que la ruta
 * termine en «/» (no acepta «\»); en Windows fs acepta las barras normales.
 */
function carpetaPdfjs(): string {
  return `${dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")).replaceAll("\\", "/")}/`;
}

/**
 * Texto de un PDF con pdf.js, página a página, como lo arma el buscador del propio visor de pdf.js
 * (trozos seguidos, salto de línea donde el PDF termina una línea). No modifica `bytes`.
 */
export async function leerPdf(bytes: Uint8Array, maxPaginas: number = MAX_PAGINAS_PDF): Promise<TextoPdf> {
  const { getDocument, VerbosityLevel } = await pdfjs();
  const base = carpetaPdfjs();
  const tarea = getDocument({
    // Copia: pdf.js exige Uint8Array (rechaza Buffer) y se queda con el que recibe.
    data: new Uint8Array(bytes),
    verbosity: VerbosityLevel.ERRORS,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
  });
  try {
    const doc = await tarea.promise;
    const { info } = await doc.getMetadata();
    const titulo = (info as { Title?: unknown }).Title;
    const paginasLeidas = Math.min(doc.numPages, maxPaginas);
    const textos: string[] = [];
    for (let n = 1; n <= paginasLeidas; n++) {
      const pagina = await doc.getPage(n);
      const contenido = await pagina.getTextContent();
      textos.push(contenido.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : "")).join(""));
      pagina.cleanup();
    }
    return { titulo: typeof titulo === "string" ? titulo.trim() : "", texto: textos.join("\n"), paginas: doc.numPages, paginasLeidas };
  } finally {
    await tarea.destroy();
  }
}

export type FormatoPdf = "acroform" | "xfa" | "plano" | "escaneado";

export interface InfoPdf {
  /** sha256 de los bytes del archivo: identifica la versión del formulario. */
  sha256: string;
  formato: FormatoPdf;
  campos: number;
}

/** Hash del archivo y formato de un formulario (spec §7.4): XFA, AcroForm rellenable, plano con texto, o escaneado. */
export async function clasificarPdf(bytes: Uint8Array): Promise<InfoPdf> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { getDocument, VerbosityLevel } = await pdfjs();
  const base = carpetaPdfjs();
  const tarea = getDocument({
    data: new Uint8Array(bytes),
    verbosity: VerbosityLevel.ERRORS,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
  });
  let xfa = false;
  let campos = 0;
  try {
    const doc = await tarea.promise;
    const { info } = await doc.getMetadata();
    const banderas = info as { IsXFAPresent?: unknown };
    // En pdfjs-dist 6.x getFieldObjects() devuelve un Map (nombre del campo -> widgets), no un objeto.
    campos = (await doc.getFieldObjects())?.size ?? 0;
    xfa = banderas.IsXFAPresent === true || doc.isPureXfa;
  } finally {
    await tarea.destroy();
  }
  // Un XFA dentro de un flujo sin comprimir: pdf.js no siempre levanta la bandera sin activar XFA.
  if (!xfa && Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes("/XFA", 0, "latin1")) xfa = true;
  if (xfa) return { sha256, formato: "xfa", campos };
  // Rellenable solo si tiene campos: un /AcroForm vacío (IsAcroFormPresent sin campos) no se puede rellenar.
  if (campos > 0) return { sha256, formato: "acroform", campos };
  const { texto, paginasLeidas } = await leerPdf(bytes, 5);
  return { sha256, formato: normalizar(texto).length >= 40 * Math.max(1, paginasLeidas) ? "plano" : "escaneado", campos };
}
