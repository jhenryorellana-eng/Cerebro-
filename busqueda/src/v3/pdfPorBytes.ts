import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import type { Captura } from "../navegador.js";

/** Nombre con el que se guarda un PDF: el hash de sus bytes, no el de su texto (dos PDF con el mismo texto no se pisan). */
export const NOMBRE_PDF_POR_BYTES = /^pdf-([0-9a-f]{64})\.pdf$/;

const shaDe = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * Guarda una copia del PDF de la captura con el hash de sus bytes y apunta `pdfPath` a ella. `capturar` nombra el PDF
 * por el hash de su texto: un PDF rellenable y uno plano con el mismo texto compartirían archivo y el último pisaría al primero.
 * Una copia que ya existe pero cuyos bytes no dan su sha (una escritura cortada) se reescribe.
 */
export function fijarPdfPorBytes(c: Captura, dirPruebas: string): Captura {
  if (!c.pdfPath) return c;
  const origen = join(dirPruebas, basename(c.pdfPath));
  if (!existsSync(origen)) return c;
  const bytes = readFileSync(origen);
  const sha = shaDe(bytes);
  const destino = join(dirPruebas, `pdf-${sha}.pdf`);
  if (!existsSync(destino) || shaDe(readFileSync(destino)) !== sha) writeFileSync(destino, bytes);
  return { ...c, pdfPath: `pruebas/pdf-${sha}.pdf` };
}
