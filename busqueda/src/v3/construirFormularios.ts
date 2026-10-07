import type { Formulario, TipoCorte, Via } from "../contrato/paquete.js";
import type { InfoPdf } from "../pdf.js";
import type { FormulariosPropuestos } from "./esquemas.js";
import { f1, f5Bien, f7, fallo, nombraAlguno, type ResultadoFiltro } from "./filtros.js";
import { estadoDe, slug, type CtxNivel } from "./nivel.js";

/**
 * Nivel 4. Solo es formulario un PDF oficial capturado: su hash es el del archivo y su formato lo decide el código
 * (clasificarPdf). Se autoaprueba con F1, F5 y F7 (§6.3); la cita tiene que salir del propio PDF y mostrar su número
 * (o, sin número, su título): «verificado» lo prueba la cita misma.
 */
export function construirFormularios(ctx: CtxNivel, p: FormulariosPropuestos, pdfs: Map<string, InfoPdf>, routes: Via[], courtTypes: TipoCorte[]): Formulario[] {
  const vias = new Set(routes.map((r) => r.key));
  const tipos = new Set(courtTypes.map((t) => t.key));
  const usadas = new Set<string>();
  const salida: Formulario[] = [];
  for (const f of p.forms) {
    const pdf = pdfs.get(f.url);
    if (!pdf || !f.url.startsWith("https://")) {
      ctx.nota(null, `Formulario «${f.title}» descartado: ${f.url} no es un PDF capturado.`);
      continue;
    }
    if (!tipos.has(f.courtTypeKey)) {
      ctx.nota(null, `Formulario «${f.title}» descartado: el tipo de corte «${f.courtTypeKey}» no está en el paquete.`);
      continue;
    }
    const titulo = f.title.replace(/\s+/g, " ").trim() || "sin título";
    const base = `${ctx.st}:form:${slug(f.number || titulo)}`;
    let key = base;
    for (let n = 2; usadas.has(key); n++) key = `${base}-${n}`;
    usadas.add(key);
    const ev = ctx.citar(key, "officialUrl", f.citations);
    const rutas = f.routeKeys.filter((k) => vias.has(k));
    const problemas: string[] = [];
    if (!ctx.oficial(f.url)) problemas.push("el PDF no es de un dominio oficial");
    if (rutas.length !== f.routeKeys.length) problemas.push("cita vías que no están en el paquete");
    if (rutas.length === 0) problemas.push("no sirve para ninguna vía del paquete");
    const delPdf = ev.citas.filter((c) => c.found && c.url === f.url);
    // Solo cuentan las citas del propio PDF, no toda su página: lo que no se citó no está probado.
    let countyFips: string | null = null;
    if (f.countyFips !== null) {
      const condado = ctx.condados.find((c) => c.fips === f.countyFips);
      if (!condado) problemas.push(`condado ${f.countyFips} fuera del estado`);
      else if (!delPdf.some((c) => ctx.lector.nombra(c.quote, condado.fips))) problemas.push("el condado no aparece en el PDF");
      else countyFips = condado.fips;
    }
    // La versión solo se publica si una cita del propio PDF la muestra.
    const versionLabel = f.versionLabel !== null && f.versionLabel.trim() !== "" && delPdf.some((c) => nombraAlguno(c.quote, [f.versionLabel!])) ? f.versionLabel : null;
    const rotulo = f.number !== null && f.number.trim() !== "" ? f.number : titulo;
    let filtroF1: ResultadoFiltro;
    if (delPdf.length === 0) filtroF1 = fallo("F1", "ninguna cita sale del propio PDF");
    else if (!delPdf.some((c) => nombraAlguno(c.quote, [rotulo]))) filtroF1 = fallo("F1", "ninguna cita del propio PDF muestra su número o título");
    else filtroF1 = f1(ev.citas);
    const filtros = [filtroF1, problemas.length === 0 ? f5Bien() : fallo("F5", problemas.join("; ")), f7(f.dudas, [p.notes])];
    for (const d of f.dudas) ctx.nota(key, d);
    salida.push({
      key,
      status: estadoDe("formulario", filtros, true),
      filters: filtros,
      evidenceKeys: ev.claves,
      routeKeys: rutas,
      courtTypeKey: f.courtTypeKey,
      countyFips,
      purpose: f.purpose,
      number: f.number,
      title: titulo,
      officialUrl: f.url,
      versionLabel,
      pdfSha256: pdf.sha256,
      format: pdf.formato,
    });
  }
  return salida;
}
