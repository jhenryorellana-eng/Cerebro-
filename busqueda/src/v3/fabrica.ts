import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Condado } from "../condados.js";
import type { Paquete } from "../contrato/paquete.js";
import type { Respuesta } from "../ia.js";
import { sha256Hex } from "../navegador.js";
import { urlCanonica } from "../paquete.js";
import { clasificarPdf, type InfoPdf } from "../pdf.js";
import { dividirEnLotes } from "../tareas/v2.js";
import { anadirPaginasV3, capturasUnicas, fusionarPaginas, PaginaV3, paginasDe, paginasPara, type CapturaGuardada } from "./capturasGuardadas.js";
import { construirPaquete, type EntradaConstruccion } from "./construir.js";
import type { SedesDeUnTipo } from "./construirSedes.js";
import { CortesPropuestasV3, EncabezadosPropuestos, FormulariosPropuestos, MarcoPropuesto, RequisitosPropuestos, SedesPropuestas, ViasPropuestas } from "./esquemas.js";
import type { ResultadoFiltro } from "./filtros.js";
import { MODELOS_POR_DEFECTO } from "./modelos.js";
import { huecosArranque, huecosDe, navegarHueco, type Hueco, type NavegacionFabrica } from "./navegar.js";
import { slug } from "./nivel.js";
import { NOMBRE_PDF_POR_BYTES } from "./pdfPorBytes.js";
import { promptCortes, promptMarco, promptVias } from "./prompts.js";
import { promptEncabezados, promptFormularios, promptRequisitos, promptSedes } from "./promptsSuperiores.js";
import { afirmacionesParaRefutar, promptRefutar, RefutacionPropuesta, resultadosF6 } from "./refutar.js";

/** Las llamadas a la IA, inyectables: los tests orquestan sin llamar a Claude. */
export interface IaFabrica {
  marco(prompt: string): Promise<Respuesta<MarcoPropuesto>>;
  vias(prompt: string): Promise<Respuesta<ViasPropuestas>>;
  cortes(prompt: string): Promise<Respuesta<CortesPropuestasV3>>;
  sedes(prompt: string): Promise<Respuesta<SedesPropuestas>>;
  formularios(prompt: string): Promise<Respuesta<FormulariosPropuestos>>;
  requisitos(prompt: string): Promise<Respuesta<RequisitosPropuestos>>;
  encabezados(prompt: string): Promise<Respuesta<EncabezadosPropuestos>>;
  refutar(prompt: string): Promise<Respuesta<RefutacionPropuesta>>;
}

export const DIR_ESTADO_V3 = "estado-v3";

/** En modo medición (--solo-cache), un paso que no tiene respuesta guardada. */
export class SinCacheError extends Error {
  constructor(estado: string, etapa: string) {
    super(`${estado}: «${etapa}» no tiene respuesta guardada en estado-v3 (con --solo-cache no se llama a la IA).`);
    this.name = "SinCacheError";
  }
}

/** La IA del modo medición: cualquier llamada es un error (la fábrica no debería hacer ninguna). */
export function iaSinLlamadas(): IaFabrica {
  const no = async (): Promise<never> => {
    throw new Error("modo --solo-cache: la IA no se llama");
  };
  return { marco: no, vias: no, cortes: no, sedes: no, formularios: no, requisitos: no, encabezados: no, refutar: no };
}

const Huellas = z.object({
  marco: z.string().optional(),
  vias: z.string().optional(),
  cortes: z.record(z.string(), z.array(z.string())).optional(),
  sedes: z.record(z.string(), z.array(z.string())).optional(),
  formularios: z.string().optional(),
  requisitos: z.string().optional(),
  encabezados: z.string().optional(),
  refutacion: z.string().optional(),
});

/**
 * Lo que devolvió la IA en cada paso y lo que se navegó, guardado al momento: una corrida cortada continúa donde se
 * quedó. Cada respuesta lleva la huella (sha256 de modelo + prompt) con la que se pidió: si cambia el prompt, las
 * páginas o el modelo, se vuelve a pedir en vez de reutilizar una respuesta vieja con la procedencia equivocada.
 */
export const EstadoV3 = z.object({
  marco: MarcoPropuesto.optional(),
  vias: ViasPropuestas.optional(),
  cortes: z.record(z.string(), z.array(CortesPropuestasV3)).optional(),
  sedes: z.record(z.string(), z.array(SedesPropuestas)).optional(),
  formularios: FormulariosPropuestos.optional(),
  requisitos: RequisitosPropuestos.optional(),
  encabezados: EncabezadosPropuestos.optional(),
  refutacion: RefutacionPropuesta.optional(),
  paginas: z.array(PaginaV3).optional(),
  navegados: z.record(z.string(), z.object({ fecha: z.string(), urls: z.array(z.string()) })).optional(),
  huellas: Huellas.optional(),
  costeUsd: z.number().optional(),
  /** Coste acumulado por etapa («marco», «vias», «cortes», «sedes», «formularios», «requisitos», «encabezados», «refutacion», «navegar»). */
  costes: z.record(z.string(), z.number()).optional(),
  fechas: z.record(z.string(), z.string()).optional(),
});
export type EstadoV3 = z.infer<typeof EstadoV3>;

export function leerEstadoV3(dir: string, estado: string): EstadoV3 {
  const ruta = join(dir, `${estado}.json`);
  return existsSync(ruta) ? EstadoV3.parse(JSON.parse(readFileSync(ruta, "utf8"))) : {};
}

function guardarEstadoV3(dir: string, estado: string, e: EstadoV3): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${estado}.json`), `${JSON.stringify(e, null, 2)}\n`, "utf8");
}

export interface ContextoFabrica {
  estado: string;
  nombre: string;
  dominios: string[];
  condados: Condado[];
  capturas: Map<string, CapturaGuardada>;
  ia: IaFabrica;
  modelos: Record<string, string>;
  version: string;
  dirEstado?: string;
  /** Donde viven los textos y PDF capturados (`<salida>/<ST>/pruebas`). */
  dirPruebas?: string;
  /** Si está, se navegan los huecos que faltan (Brave + Urban VPN). */
  navegacion?: NavegacionFabrica;
  /** Pasar las reglas por el verificador que refuta (F6). */
  refutar?: boolean;
  /**
   * Medir un cambio del código: solo lo guardado en estado-v3, aunque su huella no case con el prompt de ahora. Ninguna
   * llamada a la IA, ninguna navegación, y el estado no se escribe. Un paso sin respuesta guardada lanza SinCacheError;
   * la refutación que falte se omite (sin F6).
   */
  soloCache?: boolean;
  ahora?: () => Date;
  log?: (linea: string) => void;
}

/**
 * Formato de cada PDF capturado, por cada clave del mapa de capturas (nivel 4): `pdfs.get(k)` es siempre el PDF de
 * `capturas.get(k)`, aunque una captura vieja comparta su URL o su URL final. Solo cuenta un archivo `pdf-<sha>.pdf`
 * cuyos bytes tengan ese sha: otro nombre, o bytes distintos, no prueban de qué URL es. Un PDF ilegible se salta. Cada
 * archivo se lee y clasifica una sola vez.
 */
export async function infoPdfs(capturas: Map<string, CapturaGuardada>, dirPruebas: string): Promise<Map<string, InfoPdf>> {
  const m = new Map<string, InfoPdf>();
  const porArchivo = new Map<string, InfoPdf | null>();
  const clasificar = async (ruta: string, esperado: string): Promise<InfoPdf | null> => {
    if (!existsSync(ruta)) return null;
    const bytes = readFileSync(ruta);
    if (createHash("sha256").update(bytes).digest("hex") !== esperado) return null;
    try {
      return await clasificarPdf(bytes);
    } catch {
      // PDF ilegible: el formulario se descarta con la nota «no es un PDF capturado» en vez de tumbar la corrida.
      return null;
    }
  };
  for (const [k, c] of capturas) {
    if (!c.pdfPath) continue;
    const nombre = basename(c.pdfPath);
    const esperado = NOMBRE_PDF_POR_BYTES.exec(nombre)?.[1];
    if (!esperado) continue;
    const ruta = join(dirPruebas, nombre);
    if (!porArchivo.has(ruta)) porArchivo.set(ruta, await clasificar(ruta, esperado));
    const info = porArchivo.get(ruta);
    if (info) m.set(k, info);
  }
  return m;
}

/**
 * Cuando el marco se vuelve a pedir (cambian las páginas), un tipo con el mismo nombre oficial (entero, con su
 * aclaración) conserva la clave que tenía: las cortes y las sedes guardadas van por clave de tipo, y una clave nueva las
 * haría pedir otra vez sin motivo. No se reasigna una clave que ya usa otro tipo de la respuesta nueva, ni la de un nombre
 * repetido en una de las dos respuestas: no se sabría de cuál de esos tipos es.
 */
export function estabilizarTipos(nuevo: MarcoPropuesto, previo: MarcoPropuesto | undefined): MarcoPropuesto {
  if (!previo) return nuevo;
  const nombre = (t: { officialName: string }) => slug(t.officialName);
  const veces = (ts: readonly { officialName: string }[]) => {
    const n = new Map<string, number>();
    for (const t of ts) n.set(nombre(t), (n.get(nombre(t)) ?? 0) + 1);
    return n;
  };
  const enPrevio = veces(previo.courtTypes);
  const enNuevo = veces(nuevo.courtTypes);
  const porNombre = new Map(previo.courtTypes.map((t) => [nombre(t), t.key]));
  const propias = new Set(nuevo.courtTypes.map((t) => t.key));
  const usadas = new Set<string>();
  const courtTypes = nuevo.courtTypes.map((t) => {
    const n = nombre(t);
    if (enPrevio.get(n) !== 1 || enNuevo.get(n) !== 1) return t;
    const k = porNombre.get(n);
    if (k === undefined || k === t.key || propias.has(k) || usadas.has(k)) return t;
    usadas.add(k);
    return { ...t, key: k };
  });
  return { ...nuevo, courtTypes };
}

/** Niveles 0-6 de un estado, con navegación de lo que falte y F6 opcionales, y el paquete v2 resultante. */
export async function fabricarEstado(ctx: ContextoFabrica): Promise<Paquete> {
  const dir = ctx.dirEstado ?? DIR_ESTADO_V3;
  const log = ctx.log ?? console.log;
  const ahora = ctx.ahora ?? (() => new Date());
  const dirPruebas = ctx.dirPruebas ?? join("salida", ctx.estado, "pruebas");
  const e = leerEstadoV3(dir, ctx.estado);
  let capturas = anadirPaginasV3(ctx.capturas, e.paginas ?? [], dirPruebas);
  const modelo = ctx.modelos.extraer ?? MODELOS_POR_DEFECTO.extraer;
  const modeloRefutar = ctx.modelos.refutar ?? MODELOS_POR_DEFECTO.refutar;
  const huellas = (e.huellas ??= {});
  const huellaDe = (m: string, prompt: string) => sha256Hex(`${m}\n${prompt}`);
  const solo = ctx.soloCache === true;
  /**
   * Reutilizable si la huella coincide; un estado anterior a las huellas se adopta tal cual (misma versión de prompts).
   * En modo medición vale todo lo guardado: se mide el código, no los prompts.
   */
  const vale = (guardada: string | undefined, actual: string) => solo || guardada === undefined || guardada === actual;
  const persistir = () => {
    if (!solo) guardarEstadoV3(dir, ctx.estado, e);
  };
  /** Suma el coste al total y a su etapa: «cortes:juvenile-court:3» cuenta en «cortes». */
  const sumarCoste = (etapa: string, usd: number) => {
    e.costeUsd = (e.costeUsd ?? 0) + usd;
    const clave = etapa.split(":")[0]!;
    e.costes = { ...(e.costes ?? {}), [clave]: (e.costes?.[clave] ?? 0) + usd };
  };
  const anotar = (etapa: string, r: Respuesta<unknown>) => {
    sumarCoste(etapa, r.costUsd);
    e.fechas = { ...(e.fechas ?? {}), [etapa]: ahora().toISOString() };
    persistir();
  };
  const unPaso = async <T>(
    etapa: string,
    m: string,
    prompt: string,
    guardado: T | undefined,
    huella: string | undefined,
    llamar: (p: string) => Promise<Respuesta<T>>,
    guardar: (dato: T, h: string) => void,
  ): Promise<T> => {
    const h = huellaDe(m, prompt);
    if (guardado !== undefined && vale(huella, h)) {
      if (huella === undefined && !solo) {
        guardar(guardado, h);
        persistir();
      }
      return guardado;
    }
    if (solo) throw new SinCacheError(ctx.estado, etapa);
    log(`→ ${ctx.estado}: ${etapa}`);
    const r = await llamar(prompt);
    guardar(r.data, h);
    anotar(etapa, r);
    return r.data;
  };
  /**
   * Un paso por lotes: el prompt de un lote puede depender de los anteriores, así que desde el primero que no vale se
   * repiten todos. Con `independientes` (los lotes no se leen entre sí) solo se repite el lote que no vale.
   */
  const porLotes = async <T>(
    etapa: string,
    hechos: T[],
    firmas: string[],
    total: number,
    promptDe: (i: number, previos: T[]) => string,
    llamar: (p: string) => Promise<Respuesta<T>>,
    independientes = false,
  ): Promise<void> => {
    for (let i = 0; i < total; i++) {
      const prompt = promptDe(i, hechos.slice(0, i));
      const h = huellaDe(modelo, prompt);
      if (i < hechos.length && vale(firmas[i], h)) {
        if (firmas[i] === undefined && !solo) {
          firmas[i] = h;
          persistir();
        }
        continue;
      }
      if (solo) throw new SinCacheError(ctx.estado, `${etapa}, lote ${i + 1}`);
      if (!independientes) {
        hechos.length = i;
        firmas.length = i;
      }
      log(`→ ${ctx.estado}: ${etapa}, lote ${i + 1}/${total}`);
      const r = await llamar(prompt);
      hechos[i] = r.data;
      firmas[i] = h;
      anotar(`${etapa}:${i + 1}`, r);
    }
  };

  /** Navega los huecos que falten (quedan en e.navegados) y rehace el mapa de capturas con lo nuevo. Devuelve cuántos navegó. */
  const navegar = async (huecos: Hueco[], nav: NavegacionFabrica): Promise<number> => {
    const pendientes = huecos.filter((h) => !(e.navegados ?? {})[h.id]);
    // Las páginas que ya se tienen bien capturadas, por URL canónica: ningún hueco las recaptura. Crece con lo que trae
    // cada hueco, para que el siguiente tampoco recapture lo que acaba de capturar otro.
    const buenas = capturasUnicas(capturas).filter((c) => c.problema === null);
    const conocidas = new Set(buenas.flatMap((c) => [c.url, c.finalUrl].map(urlCanonica)));
    const mismaPagina = (u: string) => (x: { url: string; finalUrl: string }) => urlCanonica(x.url) === urlCanonica(u) || urlCanonica(x.finalUrl) === urlCanonica(u);
    for (const h of pendientes) {
      log(`→ ${ctx.estado}: navegar ${h.id}`);
      const r = await navegarHueco(h, ctx.dominios, nav, ahora, conocidas);
      // A una página que ya se tenía se le suma el uso de este hueco, con el texto que ya tenía.
      const reusadas: PaginaV3[] = r.yaCapturadas.flatMap((u) => {
        const c = buenas.find(mismaPagina(u)) ?? (e.paginas ?? []).find(mismaPagina(u));
        return c ? [{ url: c.url, finalUrl: c.finalUrl, title: c.title, sha256: c.sha256, fecha: c.fecha, usos: [h.uso], pdfPath: c.pdfPath ?? null, capturaPath: c.capturaPath }] : [];
      });
      e.paginas = fusionarPaginas(e.paginas ?? [], [...r.paginas, ...reusadas]);
      for (const p of r.paginas) for (const u of [p.url, p.finalUrl]) conocidas.add(urlCanonica(u));
      // Un arranque que no trajo ninguna página (ni nueva ni ya capturada) no queda navegado: la orden siguiente lo vuelve a intentar.
      if (r.paginas.length > 0 || r.yaCapturadas.length > 0 || !h.id.startsWith("arranque:")) e.navegados = { ...(e.navegados ?? {}), [h.id]: r.navegado };
      sumarCoste("navegar", r.costUsd);
      persistir();
    }
    if (pendientes.length > 0) capturas = anadirPaginasV3(ctx.capturas, e.paginas ?? [], dirPruebas);
    return pendientes.length;
  };
  // Un estado sin ninguna página guardada (Virginia) empieza navegando lo básico: el marco, las vías y el directorio de cortes.
  if (capturasUnicas(capturas).length === 0 && ctx.navegacion && !solo) await navegar(huecosArranque(ctx.nombre), ctx.navegacion);
  if (capturasUnicas(capturas).length === 0) {
    throw new Error(
      ctx.navegacion && !solo
        ? `${ctx.estado}: la navegación de arranque no trajo ninguna página oficial; comprueba la salida de la VPN y vuelve a lanzar la orden.`
        : `${ctx.estado}: no hay capturas guardadas; hay que navegar (--navegar).`,
    );
  }

  const lotes = dividirEnLotes(ctx.condados, 25);
  const niveles02 = async () => {
    // Mientras se pide, e.marco sigue siendo el guardado: la respuesta nueva conserva sus claves de tipo.
    const pedirMarco = async (p: string) => {
      const r = await ctx.ia.marco(p);
      return { ...r, data: estabilizarTipos(r.data, e.marco) };
    };
    const marco = await unPaso("marco", modelo, promptMarco(ctx.estado, ctx.nombre, paginasPara(capturas, ["reglas", "cortes", "marco"])), e.marco, huellas.marco, pedirMarco, (d, h) => {
      e.marco = d;
      huellas.marco = h;
    });
    const tipos = marco.courtTypes.map((t) => ({ key: t.key, officialName: t.officialName }));
    const vias = await unPaso("vias", modelo, promptVias(ctx.estado, ctx.nombre, paginasPara(capturas, ["reglas", "marco"]), tipos), e.vias, huellas.vias, (p) => ctx.ia.vias(p), (d, h) => {
      e.vias = d;
      huellas.vias = h;
    });
    const usados = [...new Set(vias.routes.map((v) => v.courtTypeKey))].filter((k) => tipos.some((t) => t.key === k));
    const cortes = (e.cortes ??= {});
    const firmasCortes = (huellas.cortes ??= {});
    const paginasCortes = paginasPara(capturas, "cortes");
    for (const tipoKey of usados) {
      const tipo = tipos.find((t) => t.key === tipoKey)!;
      const hechos = (cortes[tipoKey] ??= []);
      const firmas = (firmasCortes[tipoKey] ??= []);
      await porLotes(
        `cortes:${tipoKey}`,
        hechos,
        firmas,
        lotes.length,
        (i, previos) => promptCortes(ctx.estado, ctx.nombre, paginasCortes, lotes[i]!, tipo, [...new Set(previos.flatMap((l) => l.courts.map((c) => c.canonicalName)))]),
        (p) => ctx.ia.cortes(p),
      );
    }
    return { marco, vias, cortes: usados.map((k) => ({ tipoPropuesto: k, lotes: cortes[k] ?? [] })) };
  };
  const entradaDe = (b: Awaited<ReturnType<typeof niveles02>>): EntradaConstruccion => ({
    estado: ctx.estado,
    nombre: ctx.nombre,
    generadoEn: ahora().toISOString(),
    version: ctx.version,
    modelos: ctx.modelos,
    dominios: ctx.dominios,
    condados: ctx.condados,
    capturas,
    marco: b.marco,
    vias: b.vias,
    cortes: b.cortes,
  });

  let b = await niveles02();
  let p0 = construirPaquete(entradaDe(b));

  if (ctx.navegacion && !solo && (await navegar(huecosDe(ctx.nombre, p0), ctx.navegacion)) > 0) {
    b = await niveles02();
    p0 = construirPaquete(entradaDe(b));
  }

  // ── Niveles 3-6: solo si hay páginas de su uso; los prompts reciben claves del paquete p0 ─────────────────────
  const cortesPkg = p0.courts.map((c) => ({ key: c.key, canonicalName: c.canonicalName, courtTypeKey: c.courtTypeKey }));
  const viasPkg = p0.routes.map((r) => ({ key: r.key, officialName: r.officialName, category: r.category, courtTypeKey: r.courtTypeKey }));
  const tiposPkg = p0.courtTypes.map((t) => ({ key: t.key, officialName: t.officialName }));
  const corteDe = new Map(p0.courts.map((c) => [c.key, c.canonicalName]));

  const sedesPorTipo: SedesDeUnTipo[] = [];
  if (paginasDe(capturas, ["sedes"]).length > 0) {
    const paginas = paginasDe(capturas, ["sedes", "cortes"]);
    const sedes = (e.sedes ??= {});
    const firmasSedes = (huellas.sedes ??= {});
    for (const t of [...new Set(p0.routes.map((r) => r.courtTypeKey))]) {
      const hechos = (sedes[t] ??= []);
      const firmas = (firmasSedes[t] ??= []);
      const loteDe = (lote: Condado[]) =>
        lote.map((c) => {
          const a = p0.assignments.find((x) => x.courtTypeKey === t && (x.territory.code === c.fips || x.territory.kind === "estado_unico"));
          return { fips: c.fips, name: c.name, courtKey: a?.courtKey ?? null, courtName: a ? (corteDe.get(a.courtKey) ?? null) : null };
        });
      await porLotes(
        `sedes:${t}`,
        hechos,
        firmas,
        lotes.length,
        (i) => promptSedes(ctx.estado, ctx.nombre, paginas, loteDe(lotes[i]!), cortesPkg.filter((c) => c.courtTypeKey === t)),
        (p) => ctx.ia.sedes(p),
        true,
      );
      sedesPorTipo.push({ tipoKey: t, lotes: hechos });
    }
  }
  const pForms = paginasDe(capturas, ["formularios"]);
  const formularios =
    pForms.length > 0
      ? await unPaso("formularios", modelo, promptFormularios(ctx.estado, ctx.nombre, pForms, viasPkg, tiposPkg), e.formularios, huellas.formularios, (p) => ctx.ia.formularios(p), (d, h) => {
          e.formularios = d;
          huellas.formularios = h;
        })
      : undefined;
  const requisitos =
    paginasDe(capturas, ["requisitos"]).length > 0
      ? await unPaso(
          "requisitos",
          modelo,
          promptRequisitos(ctx.estado, ctx.nombre, paginasDe(capturas, ["requisitos", "reglas"]), viasPkg, tiposPkg),
          e.requisitos,
          huellas.requisitos,
          (p) => ctx.ia.requisitos(p),
          (d, h) => {
            e.requisitos = d;
            huellas.requisitos = h;
          },
        )
      : undefined;
  const pEnc = paginasDe(capturas, ["formularios", "encabezado"]);
  const encabezados =
    pEnc.length > 0
      ? await unPaso("encabezados", modelo, promptEncabezados(ctx.estado, ctx.nombre, pEnc, cortesPkg, viasPkg), e.encabezados, huellas.encabezados, (p) => ctx.ia.encabezados(p), (d, h) => {
          e.encabezados = d;
          huellas.encabezados = h;
        })
      : undefined;
  const pdfs = await infoPdfs(capturas, dirPruebas);
  const completa = (refutaciones?: Map<string, ResultadoFiltro>): EntradaConstruccion => ({
    ...entradaDe(b),
    sedes: sedesPorTipo,
    formularios,
    pdfs,
    requisitos,
    encabezados,
    ...(refutaciones ? { refutaciones } : {}),
  });

  let p = construirPaquete(completa());
  // En modo medición, sin refutación guardada no hay F6 (no se pide).
  if (ctx.refutar && (!solo || e.refutacion !== undefined)) {
    const afirmaciones = afirmacionesParaRefutar(p);
    const paginas = paginasPara(capturas, ["reglas", "marco", "requisitos", "cortes"]);
    const r = await unPaso("refutacion", modeloRefutar, promptRefutar(ctx.estado, ctx.nombre, afirmaciones, paginas), e.refutacion, huellas.refutacion, (x) => ctx.ia.refutar(x), (d, h) => {
      e.refutacion = d;
      huellas.refutacion = h;
    });
    p = construirPaquete(completa(resultadosF6(afirmaciones, r, capturas)));
  }
  return p;
}
