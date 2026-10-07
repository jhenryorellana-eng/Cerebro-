/**
 * Normaliza texto para comparar citas: comillas y guiones tipográficos, NBSP y espacios.
 * Debe ser AUTOCONTENIDA (sin imports ni funciones internas): se inyecta en la página con toString().
 */
export function normalizar(texto: string): string {
  return texto
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
