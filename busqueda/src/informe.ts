import { normalizar } from "./normalizar.js";
import type { Arista, Paquete } from "./tipos.js";

const ORDEN = { low: 0, medium: 1, high: 2 } as const;
const NOMBRE_REL: Record<string, string> = {
  county_in_state: "Condado en el estado",
  allows_route: "Vía SIJS del estado",
  route_filed_in: "La vía se presenta en",
  county_served_by: "Corte del condado",
  court_has_branch: "Sede de la corte",
  county_assigned_branch: "Sede asignada al condado",
};
const NOMBRE_CONF = { high: "Alta", medium: "Media", low: "Baja — revisar" } as const;
const NOMBRE_MOTIVO: Record<string, string> = {
  multiple_branches_no_official_rule: "Varias sedes y ninguna regla oficial dice cuál",
  multiple_courts_no_official_rule: "Varias cortes y ninguna regla oficial dice cuál",
  court_not_found: "No se encontró la corte",
  not_researched: "No investigado",
  unknown_fips: "Condado desconocido en la respuesta",
  conflicting_assignments: "El mismo condado aparece con cortes distintas",
  conflicting_court_key: "Una misma clave nombra cortes distintas",
  sample_failed: "La muestra re-verificada falló: todo el nivel 2 queda en baja",
  state_rules_blocked: "Fuentes oficiales bloqueadas",
  state_rules_no_route: "Sin vía SIJS estatal clara",
  state_rules_needs_human: "Contradicciones: revisión humana",
  missing_claim: "Dato sin probar",
  reviewer_note: "Nota del agente",
};

/** Solo se enlazan URLs https: un «javascript:» escapado seguiría siendo clicable. */
function enlace(url: string): string {
  const texto = escaparHtml(url);
  return /^https:\/\//i.test(url) ? `<a href="${texto}" target="_blank" rel="noopener">${texto}</a>` : texto;
}

/** Solo se enlazan capturas copiadas por el recolector a pruebas/. */
function enlaceCaptura(ruta: string | null | undefined): string {
  return ruta && /^pruebas\/[\w.-]+$/.test(ruta) ? ` · <a href="${escaparHtml(ruta)}">captura</a>` : "";
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resaltarCita(snippet: string, cita: string): string {
  const e = escaparHtml(snippet);
  const q = escaparHtml(normalizar(cita));
  if (!q) return e;
  const i = e.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return e;
  return `${e.slice(0, i)}<mark>${e.slice(i, i + q.length)}</mark>${e.slice(i + q.length)}`;
}

export function generarInforme(p: Paquete): string {
  const nodos = new Map(p.nodes.map((n) => [n.id, n]));
  const etiqueta = (id: string): string => escaparHtml(nodos.get(id)?.label ?? id);
  const filas = p.edges.filter((a) => a.rel !== "county_in_state").sort((a, b) => ORDEN[a.confidence] - ORDEN[b.confidence]);
  const cuenta = (c: Arista["confidence"]): number => filas.filter((a) => a.confidence === c).length;
  const direccion = (id: string): string => {
    const d = nodos.get(id)?.address;
    return d ? `<div><b>Dirección:</b> ${escaparHtml(d)}</div>` : "";
  };

  const atributos = (attrs: Arista["attrs"]): string =>
    Object.entries(attrs)
      .filter(([, v]) => v !== null && v !== "")
      .map(([k, v]) => `<div><b>${escaparHtml(k)}:</b> ${escaparHtml(String(v))}</div>`)
      .join("");

  const pruebas = (a: Arista): string =>
    a.evidence
      .map((ev) => {
        const fuente = nodos.get(ev.source);
        const url = fuente?.url ?? "";
        const captura = enlaceCaptura(fuente?.screenshot);
        const estado = !ev.quoteVerified
          ? "✗ cita no encontrada"
          : ev.secondPassVerified === false
            ? "✗ la re-verificación falló"
            : "✓ cita en la página";
        return `<li><span class="claim">${escaparHtml(ev.claim)}</span> ${estado} — <q>${escaparHtml(ev.quote)}</q>`
          + `<div class="snip">${resaltarCita(ev.snippet, ev.quote)}</div>`
          + `${enlace(url)}${captura}</li>`;
      })
      .join("");

  const filasHtml = filas
    .map(
      (a) =>
        `<tr class="c-${a.confidence}"><td>${escaparHtml(NOMBRE_REL[a.rel] ?? a.rel)}</td>`
        + `<td>${etiqueta(a.from)} → ${etiqueta(a.to)}${atributos(a.attrs)}${direccion(a.to)}</td>`
        + `<td>${NOMBRE_CONF[a.confidence]}<div class="checks">${a.checks.map(escaparHtml).join(", ")}</div></td>`
        + `<td><ul>${pruebas(a)}</ul></td></tr>`,
    )
    .join("\n");

  const preguntas = p.openQuestions
    .map((q) => {
      const condado = q.county && nodos.get(`county:${q.county}`) ? ` · ${etiqueta(`county:${q.county}`)}` : "";
      return `<tr><td>${escaparHtml(q.county ?? "—")}${condado}</td><td>${escaparHtml(NOMBRE_MOTIVO[q.reason] ?? q.reason)}</td><td>${escaparHtml(q.detail)}</td></tr>`;
    })
    .join("\n");

  const titulo = escaparHtml(nodos.get(`state:${p.state}`)?.label ?? p.state);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recolector SIJS — ${titulo}</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;color:#1b1b1b;background:#fff}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}
tr.c-low{background:#fdecec}tr.c-medium{background:#fff8e1}tr.c-high{background:#eef8ee}
mark{background:#ffe066}.snip{font-size:.9em;color:#444;margin:4px 0}.claim{font-weight:600}.checks{font-size:.8em;color:#666}
</style></head><body>
<h1>Recolector SIJS — ${titulo}</h1>
<p>Generado: ${escaparHtml(p.generatedAt)} · Todo está <b>pendiente de aprobación</b> en la plataforma.</p>
<p>Conexiones: <b>${cuenta("low")}</b> bajas (revisar primero) · ${cuenta("medium")} medias · ${cuenta("high")} altas · ${p.edges.length - filas.length} condados del Census · ${p.openQuestions.length} preguntas abiertas</p>
<h2>Preguntas abiertas</h2>
<table><tr><th>Condado</th><th>Motivo</th><th>Detalle</th></tr>${preguntas || '<tr><td colspan="3">Ninguna</td></tr>'}</table>
<h2>Conexiones (de menor a mayor confianza)</h2>
<table><tr><th>Relación</th><th>Conexión</th><th>Confianza</th><th>Pruebas</th></tr>
${filasHtml}
</table></body></html>`;
}
