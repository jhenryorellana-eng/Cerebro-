import { normalizar } from "./normalizar.js";

/**
 * Código fijo que las sesiones de Claude pegan en javascript_tool. Se reasigna en cada ejecución
 * (window.__rec), así que puede ejecutarse varias veces en la misma página sin redeclarar nada.
 */
export function codigoVerificador(): string {
  return `window.__rec = {
  normalizar: ${normalizar.toString()},
  verificar: async (citas) => {
    const n = window.__rec.normalizar;
    const texto = n(document.body ? document.body.innerText : "");
    const datos = new TextEncoder().encode(texto);
    // En 8 grupos separados por guiones: la extensión del navegador oculta las cadenas hex largas.
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", datos)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .match(/.{8}/g)
      .join("-");
    return {
      url: location.href,
      title: document.title,
      pageSha256: hash,
      length: texto.length,
      results: citas.map((cita) => {
        const q = n(String(cita));
        const i = q.length > 0 ? texto.indexOf(q) : -1;
        return { quote: cita, found: i >= 0, snippet: i >= 0 ? texto.slice(Math.max(0, i - 150), i + q.length + 150) : "" };
      }),
    };
  },
  resaltar: (cita) => {
    const seleccion = window.getSelection();
    if (seleccion) seleccion.removeAllRanges();
    return window.find(String(cita), false, false, true);
  },
};`;
}
