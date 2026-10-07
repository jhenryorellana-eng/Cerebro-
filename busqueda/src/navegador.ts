import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Response as RespuestaPlaywright } from "playwright-core";
import { esDominioOficial } from "./fuentes.js";
import { normalizar } from "./normalizar.js";
import { esPdf, leerPdf, MAX_BYTES_PDF, type TextoPdf } from "./pdf.js";

export type ProblemaCaptura = "bloqueada" | "fuera_de_lista" | "pdf" | "error";

export interface Captura {
  url: string;
  finalUrl: string;
  status: number | null;
  title: string;
  texto: string;
  sha256: string;
  textoPath: string | null;
  capturaPath: string | null;
  problema: ProblemaCaptura | null;
  detalle: string;
  /** Solo si la página era un PDF: el archivo original, junto al texto que se sacó de él. */
  pdfPath?: string;
  /** Solo en una página HTML con enlaces a PDF: esos enlaces, absolutos (como mucho MAX_ENLACES_PDF). */
  enlacesPdf?: string[];
}

/** Lo que el recolector necesita de una pestaña: separado del navegador para probarlo sin abrir nada. */
export interface Pestana {
  ir(url: string): Promise<{ status: number | null; contentType: string }>;
  urlActual(): string;
  titulo(): Promise<string>;
  texto(): Promise<string>;
  /** Bytes de la respuesta de la última navegación: de ahí sale el texto de un PDF. */
  cuerpo(): Promise<Buffer>;
  capturarPantalla(): Promise<Buffer>;
  /** Los enlaces de la página (href absolutos). Opcional: sin él no se guarda ningún enlace. */
  enlaces?(): Promise<string[]>;
  cerrar(): Promise<void>;
}

export interface Motor {
  nuevaPestana(): Promise<Pestana>;
  cerrar(): Promise<void>;
  /** false si el navegador se cerró o se desconectó: hay que volver a abrirlo. */
  vivo(): boolean;
}

export const RUTA_BRAVE = process.env.RECOLECTOR_BRAVE ?? "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
export const PERFIL_BRAVE = "perfil-brave";
export const PATRON_BLOQUEO =
  /access denied|you have been blocked|restricted access|attention required|verify(ing)? you are human|request unsuccessful|request rejected|requested url was rejected|captcha/i;

export function sha256Hex(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

const dormirReal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Pausa mínima entre cargas del mismo dominio, también con varias pestañas en paralelo. */
export class Cortesia {
  private readonly ultimo = new Map<string, number>();
  private readonly esperaMs: number;
  private readonly ahora: () => number;
  private readonly dormir: (ms: number) => Promise<void>;
  constructor(esperaMs: number, ahora: () => number = () => Date.now(), dormir: (ms: number) => Promise<void> = dormirReal) {
    this.esperaMs = esperaMs;
    this.ahora = ahora;
    this.dormir = dormir;
  }
  async turno(url: string): Promise<void> {
    const host = hostDe(url);
    const t = this.ahora();
    const previo = this.ultimo.get(host);
    const inicio = previo === undefined ? t : Math.max(t, previo + this.esperaMs);
    this.ultimo.set(host, inicio);
    if (inicio > t) await this.dormir(inicio - t);
  }
}

export interface OpcionesCaptura {
  dominios: string[];
  dirPruebas: string;
  cortesia: Cortesia;
  intentos?: number;
  dormir?: (ms: number) => Promise<void>;
}

function vacia(url: string, problema: ProblemaCaptura, detalle: string, extra: Partial<Captura> = {}): Captura {
  return { url, finalUrl: url, status: null, title: "", texto: "", sha256: "", textoPath: null, capturaPath: null, problema, detalle, ...extra };
}

function mensajeDe(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 200);
}

/** Enlaces a PDF que se guardan de una página HTML, como mucho. */
export const MAX_ENLACES_PDF = 20;

/**
 * Alto máximo (px) de la captura de pantalla. Pintar entera una página enorme tumba el navegador, y con él la VPN: le
 * pasó dos veces a Brave el 2026-09-29 con el capítulo 11 del título 16.1 del código de Virginia (~900 KB de texto).
 * El texto, que es la prueba con su sha, se guarda entero igual; la imagen es solo su parte de arriba.
 */
export const MAX_ALTO_CAPTURA = 10000;
/**
 * Con fullPage, Playwright recorta la página a `clip` antes de pintarla (trimClipToSize, comprobado en
 * playwright-core/lib/coreBundle.js): una página normal sale entera y una enorme, solo sus primeros píxeles.
 */
export const OPCIONES_CAPTURA = { fullPage: true, type: "jpeg", quality: 60, clip: { x: 0, y: 0, width: 4000, height: MAX_ALTO_CAPTURA } } as const;

/** Ruta que termina en .pdf (sin contar la consulta ni el fragmento). */
function rutaPdf(url: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Último tramo de la ruta, legible: título de un PDF sin Title en sus metadatos. */
function nombreArchivo(url: string): string {
  let ultimo: string;
  try {
    ultimo = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return url;
  }
  try {
    return decodeURIComponent(ultimo);
  } catch {
    return ultimo;
  }
}

/** Tipos con los que un servidor entrega un archivo sin decir cuál es: puede ser un PDF. */
const TIPO_DESCARGA = /octet-stream|x-download|force-download/;
/** Por debajo de esto de media por página, el PDF es una imagen (escaneo): números de página y sellos no son texto. */
const MIN_CARACTERES_POR_PAGINA = 40;

/**
 * Un PDF se captura como una página: el texto sale del archivo (pdf.js), se normaliza igual y se guarda con su
 * hash, junto al original. La vista del visor es un extra: si no se deja fotografiar, la captura sigue valiendo.
 * Devuelve null si al final no era un PDF y tampoco se había anunciado como tal: se sigue como página HTML.
 */
async function capturarPdf(p: Pestana, url: string, finalUrl: string, status: number | null, anunciado: boolean, o: OpcionesCaptura): Promise<Captura | null> {
  const base = { finalUrl, status };
  let bytes: Buffer;
  try {
    bytes = await p.cuerpo();
  } catch (err) {
    return anunciado ? vacia(url, "pdf", `No se pudo leer el archivo PDF: ${mensajeDe(err)}`, base) : null;
  }
  if (!esPdf(bytes)) return anunciado ? vacia(url, "pdf", "El servidor anuncia un PDF, pero el contenido no empieza por %PDF", base) : null;
  if (bytes.length > MAX_BYTES_PDF) {
    return vacia(url, "pdf", `PDF de ${(bytes.length / 2 ** 20).toFixed(1)} MB: supera el tope de ${MAX_BYTES_PDF / 2 ** 20} MB`, base);
  }
  let leido: TextoPdf;
  try {
    leido = await leerPdf(bytes);
  } catch (err) {
    return vacia(url, "pdf", `PDF ilegible: ${mensajeDe(err)}`, base);
  }
  const title = leido.titulo || nombreArchivo(finalUrl);
  const texto = normalizar(leido.texto);
  if (texto.length < MIN_CARACTERES_POR_PAGINA * leido.paginasLeidas) return vacia(url, "pdf", "PDF sin texto extraíble (escaneado)", { ...base, title });
  const sha = sha256Hex(texto);
  mkdirSync(o.dirPruebas, { recursive: true });
  writeFileSync(join(o.dirPruebas, `${sha}.txt`), texto, "utf8");
  writeFileSync(join(o.dirPruebas, `${sha}.pdf`), bytes);
  let capturaPath: string | null = null;
  try {
    writeFileSync(join(o.dirPruebas, `${sha}.jpg`), await p.capturarPantalla());
    capturaPath = `pruebas/${sha}.jpg`;
  } catch {
    // El visor de PDF del navegador puede no dejarse fotografiar: el texto y el original ya son la prueba.
  }
  const detalle = leido.paginasLeidas < leido.paginas ? `PDF de ${leido.paginas} páginas: se leyeron las ${leido.paginasLeidas} primeras` : "";
  return { url, finalUrl, status, title, texto, sha256: sha, textoPath: `pruebas/${sha}.txt`, capturaPath, problema: null, detalle, pdfPath: `pruebas/${sha}.pdf` };
}

export async function capturar(motor: Motor, url: string, o: OpcionesCaptura): Promise<Captura> {
  if (!esDominioOficial(url, o.dominios)) return vacia(url, "fuera_de_lista", "La URL no está en la lista de dominios oficiales");
  const intentos = o.intentos ?? 3;
  const dormir = o.dormir ?? dormirReal;
  let ultimo = "";
  for (let i = 1; i <= intentos; i++) {
    await o.cortesia.turno(url);
    let p: Pestana | null = null;
    try {
      // Dentro del try: un navegador cerrado da una captura con error, no tumba la corrida.
      p = await motor.nuevaPestana();
      const r = await p.ir(url);
      const finalUrl = p.urlActual();
      if (!esDominioOficial(finalUrl, o.dominios)) {
        return vacia(url, "fuera_de_lista", `Redirigió fuera de la lista: ${finalUrl}`, { finalUrl, status: r.status });
      }
      if (r.status === 429 || (r.status !== null && r.status >= 500)) {
        ultimo = `HTTP ${r.status}`;
      } else {
        const tipo = r.contentType.toLowerCase();
        const esHtml = /text\/html|xhtml/.test(tipo);
        // Anunciado: el servidor lo declara PDF, o la ruta acaba en .pdf y no llega como HTML (una página de error sí).
        const anunciado = tipo.includes("application/pdf") || (!esHtml && (rutaPdf(url) || rutaPdf(finalUrl)));
        // El cuerpo solo se pide cuando puede ser un PDF: una página HTML no lo necesita.
        const quizaPdf = anunciado || (!esHtml && (tipo === "" || TIPO_DESCARGA.test(tipo)));
        const pdf = quizaPdf ? await capturarPdf(p, url, finalUrl, r.status, anunciado, o) : null;
        if (pdf) return pdf;
        const title = await p.titulo();
        const texto = normalizar(await p.texto());
        if (r.status === 403 || PATRON_BLOQUEO.test(title) || (texto.length < 3000 && PATRON_BLOQUEO.test(texto))) {
          return vacia(url, "bloqueada", "La página muestra un bloqueo", { finalUrl, status: r.status, title });
        }
        const sha = sha256Hex(texto);
        mkdirSync(o.dirPruebas, { recursive: true });
        writeFileSync(join(o.dirPruebas, `${sha}.txt`), texto, "utf8");
        writeFileSync(join(o.dirPruebas, `${sha}.jpg`), await p.capturarPantalla());
        // Los enlaces a PDF de la página: la ficha de un formulario enlaza su PDF, y la fábrica puede seguirlo.
        // Un fallo al leer los enlaces nunca tumba la captura: sin enlaces, sin más.
        const crudos: unknown = p.enlaces ? await p.enlaces().catch(() => []) : [];
        const enlaces = Array.isArray(crudos) ? crudos.filter((x): x is string => typeof x === "string") : [];
        const enlacesPdf = [...new Set(enlaces.filter(rutaPdf))].slice(0, MAX_ENLACES_PDF);
        return {
          url,
          finalUrl,
          status: r.status,
          title,
          texto,
          sha256: sha,
          textoPath: `pruebas/${sha}.txt`,
          capturaPath: `pruebas/${sha}.jpg`,
          problema: null,
          detalle: "",
          ...(enlacesPdf.length > 0 ? { enlacesPdf } : {}),
        };
      }
    } catch (err) {
      ultimo = err instanceof Error ? err.message : String(err);
    } finally {
      await p?.cerrar().catch(() => undefined);
    }
    if (i < intentos) await dormir(2_000 * 2 ** (i - 1));
  }
  return vacia(url, "error", ultimo.slice(0, 200));
}

/**
 * Todo el texto de la página, también el plegado (acordeones de preguntas frecuentes): innerText solo da lo visible
 * y perdía las respuestas (wyocourts.gov: 2.551 caracteres visibles de 35.312). Sin scripts ni estilos.
 */
const RECORRER_TEXTO = `(() => {
  if (!document.body) return "";
  const saltar = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let p = n.parentElement; p; p = p.parentElement) if (saltar.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const partes = [];
  let n;
  while ((n = w.nextNode())) partes.push(n.nodeValue);
  return partes.join(" ");
})()`;

/**
 * Se ejecuta en la página: descarga `url` con el fetch del navegador y la devuelve en base64 (lo único que cruza
 * CDP sin pérdidas). Más de `max` bytes lanza un error en vez de traer un archivo que no se va a leer.
 * Es texto, como RECORRER_TEXTO: una función compilada por tsx podría llevar ayudantes que la página no tiene.
 */
const DESCARGAR_EN_PAGINA = `async ({ url, max }) => {
  const r = await fetch(url, { credentials: "include" });
  const declarado = Number(r.headers.get("content-length") || 0);
  if (declarado > max) throw new Error("El archivo declara " + declarado + " bytes (tope " + max + ")");
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > max) throw new Error("El archivo tiene " + bytes.byteLength + " bytes (tope " + max + ")");
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}`;

/** Puerto poco común a propósito: así nunca se conecta a otro navegador del usuario. */
export const PUERTO_CDP = Number(process.env.RECOLECTOR_PUERTO ?? 9333);
/** Solo abren con la VPN desde el país del usuario: si una carga, la salida funciona. Dos, por si una está caída. */
export const SALIDAS = [
  { url: "https://le.utah.gov/xcode/Title80/Chapter3/80-3-S505.html", dominio: "le.utah.gov" },
  { url: "https://www.nycourts.gov/help/guardianship/guardianship-child-family-court", dominio: "nycourts.gov" },
] as const;
export const MENSAJE_SIN_SALIDA =
  "Sin salida por la VPN. En la ventana de Brave del recolector abre Urban VPN, conéctate a Estados Unidos y vuelve a correr: npm run navegador";

export class SinSalidaError extends Error {
  constructor(c: Captura) {
    super(`${MENSAJE_SIN_SALIDA} (${c.problema}: ${c.detalle.split("\n")[0]})`);
    this.name = "SinSalidaError";
  }
}

/** Con extensiones y sin la marca de automatización: Urban VPN tiene que funcionar en esa ventana. */
export function argsBrave(perfil: string, puerto: number): string[] {
  return [`--user-data-dir=${resolve(perfil)}`, `--remote-debugging-port=${puerto}`, "--no-first-run", "--no-default-browser-check"];
}

async function cdpDisponible(puerto: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}/json/version`, { signal: AbortSignal.timeout(2_000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Diagnóstico de Cloudflare: devuelve «loc=XX», el país por el que sale el navegador. */
export const URL_PAIS = "https://www.cloudflare.com/cdn-cgi/trace";

/** País de salida del navegador, o null si no se pudo saber. */
export async function paisDeSalida(motor: Motor): Promise<string | null> {
  let p: Pestana | null = null;
  try {
    p = await motor.nuevaPestana();
    await p.ir(URL_PAIS);
    return /\bloc=([A-Z]{2})\b/.exec(await p.texto())?.[1] ?? null;
  } catch {
    return null;
  } finally {
    await p?.cerrar().catch(() => undefined);
  }
}

/**
 * La salida vale si el navegador sale por Estados Unidos. Se decide por el país y no por páginas «bloqueadas»:
 * le.utah.gov y nycourts abren a ratos desde Perú, y así una VPN caída pasó por buena (10:08). Si el país no se
 * puede saber, se prueban las páginas de control como antes.
 */
export async function verificarSalida(motor: Motor, dirPruebas: string, dormir?: (ms: number) => Promise<void>): Promise<Captura> {
  const pais = await paisDeSalida(motor);
  if (pais !== null) {
    const base = { url: URL_PAIS, finalUrl: URL_PAIS, status: 200, title: "", texto: "", sha256: "", textoPath: null, capturaPath: null };
    return pais === "US"
      ? { ...base, problema: null, detalle: "salida por US" }
      : { ...base, problema: "bloqueada", detalle: `la salida es ${pais}, no Estados Unidos` };
  }
  let ultima: Captura | null = null;
  for (const s of SALIDAS) {
    ultima = await capturar(motor, s.url, { dominios: [s.dominio], dirPruebas, cortesia: new Cortesia(0), intentos: 2, ...(dormir ? { dormir } : {}) });
    if (ultima.problema === null) return ultima;
  }
  return ultima!;
}

/** Fallos del propio navegador (pestaña o conexión cerradas, página recargada), no de la red ni de la VPN. */
const ERROR_NAVEGADOR = /has been closed|Target closed|context was destroyed|browser has disconnected/i;

/**
 * Comprueba la salida; si el fallo es del navegador y no de la red, se reconecta una vez y vuelve a comprobar.
 * obtenerMotor(true) debe devolver una conexión nueva.
 */
export async function comprobarSalida(
  obtenerMotor: (nuevo: boolean) => Promise<Motor>,
  dirPruebas: string,
  dormir?: (ms: number) => Promise<void>,
): Promise<Captura> {
  let c = await verificarSalida(await obtenerMotor(false), dirPruebas, dormir);
  // A veces el contexto sigue cerrado justo después de que otro proceso se desconecte (Indiana, 11:22): pausa y otra vez.
  for (let i = 0; i < 3 && c.problema !== null && ERROR_NAVEGADOR.test(c.detalle); i++) {
    await (dormir ?? dormirReal)(5_000);
    c = await verificarSalida(await obtenerMotor(true), dirPruebas, dormir);
  }
  return c;
}

/**
 * Una salida comprobada como buena se da por buena durante `ms`: un estado con muchas páginas fallidas no puede
 * machacar las páginas de control hasta que nos limiten (Idaho, 06:51). Un fallo no se recuerda.
 */
export function recordarSalidaOk(
  comprobar: () => Promise<boolean>,
  ms: number,
  ahora: () => number = () => Date.now(),
): (forzar?: boolean) => Promise<boolean> {
  let ultimaOk = Number.NEGATIVE_INFINITY;
  return async (forzar = false) => {
    if (!forzar && ahora() - ultimaOk < ms) return true;
    const ok = await comprobar();
    if (ok) ultimaOk = ahora();
    return ok;
  };
}

/**
 * Una página que falla puede ser culpa del sitio o de la salida. Si la salida tampoco funciona, la corrida se
 * detiene antes de guardar nada: un bloqueo por VPN caída no puede quedar registrado como resultado.
 */
export function vigilarCaptura(
  capturarUrl: (url: string) => Promise<Captura>,
  salidaOk: (forzar?: boolean) => Promise<boolean>,
): (url: string) => Promise<Captura> {
  // Una VPN caída hace fallar todas las páginas seguidas: a la tercera se comprueba aunque haya una salida buena recordada.
  let seguidos = 0;
  return async (url) => {
    const c = await capturarUrl(url);
    if (c.problema !== "error" && c.problema !== "bloqueada") {
      seguidos = 0;
      return c;
    }
    seguidos++;
    const forzar = seguidos >= 3;
    if (!(await salidaOk(forzar))) throw new SinSalidaError(c);
    if (forzar) seguidos = 0;
    return c;
  };
}

/**
 * La ventana de Brave del recolector (su perfil, con Urban VPN). Se lanza desprendida y sobrevive a la corrida:
 * la VPN se conecta una vez y las corridas siguientes se enganchan a la misma ventana por CDP.
 */
export async function abrirMotorBrave(perfil: string = PERFIL_BRAVE, ejecutable: string = RUTA_BRAVE, puerto: number = PUERTO_CDP): Promise<Motor> {
  if (!(await cdpDisponible(puerto))) {
    spawn(ejecutable, argsBrave(perfil, puerto), { detached: true, stdio: "ignore" }).unref();
    const limite = Date.now() + 30_000;
    while (!(await cdpDisponible(puerto))) {
      if (Date.now() > limite) throw new Error(`Brave no abrió el puerto ${puerto} en 30 s`);
      await dormirReal(500);
    }
  }
  const { chromium } = await import("playwright-core");
  // Con la ventana ocupada (páginas pesadas de otra corrida) el enganche puede tardar: margen y reintentos.
  let navegador: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  let error: unknown = null;
  for (let i = 1; i <= 3 && !navegador; i++) {
    try {
      navegador = await chromium.connectOverCDP(`http://127.0.0.1:${puerto}`, { timeout: 90_000 });
    } catch (err) {
      error = err;
      await dormirReal(5_000);
    }
  }
  if (!navegador) throw error;
  let conectado = true;
  navegador.on("disconnected", () => {
    conectado = false;
  });
  const contexto = navegador.contexts()[0] ?? (await navegador.newContext());
  return {
    vivo: () => conectado,
    async nuevaPestana(): Promise<Pestana> {
      const page = await contexto.newPage();
      let respuesta: RespuestaPlaywright | null = null;
      return {
        async ir(url) {
          const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
          respuesta = resp;
          await page.waitForTimeout(2_500);
          // Deja asentarse las redirecciones por JavaScript antes de leer.
          await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
          return { status: resp?.status() ?? null, contentType: resp?.headers()["content-type"] ?? "" };
        },
        urlActual: () => page.url(),
        titulo: () => page.title(),
        async texto() {
          try {
            return (await page.evaluate(RECORRER_TEXTO)) as string;
          } catch (err) {
            // La página se recargó mientras se leía: se espera a que cargue y se lee otra vez.
            if (!/context was destroyed/i.test(String(err))) throw err;
            await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
            return (await page.evaluate(RECORRER_TEXTO)) as string;
          }
        },
        async cuerpo() {
          if (!respuesta) throw new Error("La navegación no dio respuesta");
          const directo = await respuesta.body().catch(() => null);
          if (directo && esPdf(directo)) return directo;
          // Con el visor de PDF de Brave, CDP no da los bytes del PDF sino la página del visor (comprobado en vivo el
          // 2026-09-28 con flcourts.gov y ujs.sd.gov): se pide otra vez desde la propia página, por la red del
          // navegador (con su VPN y sus cookies), no desde Node.
          const args = JSON.stringify({ url: respuesta.url(), max: MAX_BYTES_PDF });
          return Buffer.from((await page.evaluate(`(${DESCARGAR_EN_PAGINA})(${args})`)) as string, "base64");
        },
        capturarPantalla: () => page.screenshot(OPCIONES_CAPTURA),
        enlaces: async () => (await page.evaluate("[...document.querySelectorAll('a[href]')].map((a) => a.href)")) as string[],
        cerrar: () => page.close(),
      };
    },
    // Solo se desconecta: la ventana y la VPN siguen abiertas para la próxima corrida.
    cerrar: () => navegador.close(),
  };
}
