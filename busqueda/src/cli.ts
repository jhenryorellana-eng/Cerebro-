import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Cita } from "./esquemas.js";
import { diferencias } from "./cambios.js";
import { guardarCobertura, leerCobertura, resumenCobertura, type ResumenEstado } from "./cobertura.js";
import { cargarCondados, condadosDeEstado, type Condado } from "./condados.js";
import { conEtapa, guardarEstado, leerEstado, type EstadoCorrida } from "./estado.js";
import { nombreEstado } from "./estados.js";
import { cargarFuentes, dominiosDe, esDominioOficial, type ListaFuentes } from "./fuentes.js";
import { LimiteDeUsoError, type Respuesta } from "./ia.js";
import { generarInforme } from "./informe.js";
import { abrirMotorBrave, capturar, comprobarSalida, Cortesia, recordarSalidaOk, SinSalidaError, vigilarCaptura, type Captura, type Motor } from "./navegador.js";
import { nivelesV2 } from "./nivelesV2.js";
import { citaVerificada, construirPaquete } from "./paquete.js";
import { conReintentos, Presupuesto, PresupuestoAgotadoError } from "./reintentos.js";
import { investigarCortes, muestraDe } from "./tareas/cortesCondados.js";
import { investigarReglas } from "./tareas/reglasEstado.js";
import { citasVerificables, muestraFalla, reverificar } from "./tareas/verificarCitas.js";
import { Paquete } from "./tipos.js";

export const DIR_ESTADO = "estado";
export const DIR_SALIDA = "salida";

export interface ArgsCli {
  estados: string[];
  niveles: Set<number>;
  maxLlamadas: number;
  refrescar: boolean;
  navegador: "playwright" | "extension";
  /** Solo reconstruye paquete, informe y cobertura desde lo guardado: sin navegador ni llamadas. */
  soloPaquete: boolean;
}

export function parsearArgs(argv: string[]): ArgsCli {
  const valor = (clave: string): string | undefined => {
    const i = argv.indexOf(clave);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const estados = (valor("--estados") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (estados.length === 0) {
    throw new Error(
      "Uso: npm run recolector -- --estados UT,VA,NY [--niveles 1,2] [--max-llamadas 40] [--refrescar] [--navegador playwright|extension] [--solo-paquete]",
    );
  }
  for (const e of estados) nombreEstado(e);
  const niveles = new Set((valor("--niveles") ?? "1,2").split(",").map((n) => Number(n.trim())));
  for (const n of niveles) if (n !== 1 && n !== 2) throw new Error(`Nivel inválido: ${n}`);
  const maxLlamadas = Number(valor("--max-llamadas") ?? "40");
  if (!Number.isInteger(maxLlamadas) || maxLlamadas < 1) throw new Error("--max-llamadas debe ser un entero ≥ 1");
  const navegador = valor("--navegador") ?? "playwright";
  if (navegador !== "playwright" && navegador !== "extension") throw new Error(`Navegador inválido: ${navegador}`);
  return { estados, niveles, maxLlamadas, refrescar: argv.includes("--refrescar"), navegador, soloPaquete: argv.includes("--solo-paquete") };
}

const CARPETA_CAPTURAS = /^claude-chrome-screenshots-[\w-]+$/;
const ARCHIVO_CAPTURA = /^screenshot-[\w-]+\.(jpe?g|png)$/i;

function rutaReal(ruta: string): string {
  try {
    return realpathSync.native(ruta).toLowerCase();
  } catch {
    return resolve(ruta).toLowerCase();
  }
}

function esImagen(ruta: string): boolean {
  const cabecera = readFileSync(ruta).subarray(0, 4);
  const jpeg = cabecera[0] === 0xff && cabecera[1] === 0xd8;
  const png = cabecera.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return jpeg || png;
}

/**
 * Copia a pruebas/ una captura que la IA dice haber guardado. Solo acepta archivos de la carpeta temporal
 * de Claude in Chrome, con nombre de captura y cabecera de imagen: la ruta la escribe la IA, que lee páginas
 * no confiables. Si ya se copió antes, la reutiliza aunque el temporal se haya borrado.
 */
export function copiarCaptura(origen: string | null, dirPruebas: string, temporal: string = tmpdir()): string | null {
  if (!origen) return null;
  const nombre = basename(origen);
  if (!ARCHIVO_CAPTURA.test(nombre)) return null;
  const destino = join(dirPruebas, nombre);
  if (existsSync(destino)) return `pruebas/${nombre}`;
  const absoluto = resolve(origen);
  const carpeta = dirname(absoluto);
  if (!CARPETA_CAPTURAS.test(basename(carpeta))) return null;
  if (!existsSync(absoluto) || rutaReal(dirname(carpeta)) !== rutaReal(temporal)) return null;
  if (!esImagen(absoluto)) return null;
  mkdirSync(dirPruebas, { recursive: true });
  copyFileSync(absoluto, destino);
  return `pruebas/${nombre}`;
}

/** Las capturas v2 las escribe el código directamente en pruebas/ con su hash; las de la extensión se copian. */
export function rutaCapturaV2(origen: string | null, dirPruebas: string): string | null {
  if (origen && /^pruebas\/[0-9a-f]{64}\.jpg$/.test(origen)) return origen;
  return copiarCaptura(origen, dirPruebas);
}

function copiarCapturasDe(citas: Cita[], dirPruebas: string): void {
  for (const c of citas) copiarCaptura(c.screenshotPath, dirPruebas);
}

const REINTENTOS = {
  esperaLimiteMs: 15 * 60_000,
  maxEsperasLimite: 24,
  maxErrores: 1,
  alEsperar: (motivo: string, ms: number) => console.log(`⏸  ${motivo}; espero ${Math.max(1, Math.round(ms / 60_000))} min…`),
};

interface Contexto {
  estado: string;
  nombre: string;
  dominios: string[];
  condados: Condado[];
  e: EstadoCorrida;
  args: ArgsCli;
  dirPruebas: string;
  llamar: <T>(fn: () => Promise<Respuesta<T>>) => Promise<T>;
  navegacion: Navegacion;
}

/** La ventana del recolector: se reabre si murió, y la salida por la VPN se puede comprobar en cualquier momento. */
interface Navegacion {
  motor: () => Promise<Motor>;
  salida: () => Promise<Captura>;
}

/** v1: la IA navega con Claude in Chrome y verifica en la página. */
async function nivelesExtension(ctx: Contexto): Promise<void> {
  const { estado, nombre, dominios, condados, e, args, dirPruebas, llamar } = ctx;
  if (args.niveles.has(1)) {
    console.log(`→ ${estado}: nivel 1 (reglas del estado)`);
    const reglas = await conEtapa(DIR_ESTADO, estado, e, "reglas", args.refrescar, () => llamar(() => investigarReglas(estado, nombre, dominios)));
    const todas = reglas.routes.flatMap((v) => [v.route, v.courtType, v.ageLimitExclusive, v.venueRule].flatMap((a) => a.citations));
    copiarCapturasDe(todas, dirPruebas);
    const citas = citasVerificables(todas, dominios);
    if (citas.length > 0) {
      console.log(`→ ${estado}: re-verificación de ${citas.length} citas de nivel 1`);
      await conEtapa(DIR_ESTADO, estado, e, "verificacionReglas", args.refrescar, () => llamar(() => reverificar(citas)));
    }
  }

  if (args.niveles.has(2)) {
    // Solo un tipo de corte con al menos una cita oficial comprobada guía el nivel 2.
    const tipoCorte =
      e.reglas?.routes.find(
        (v) => v.courtType.value && v.courtType.citations.some((c) => citaVerificada(c) && esDominioOficial(c.url, dominios)),
      )?.courtType.value ?? null;
    for (let intento = 1; intento <= 2; intento++) {
      const refrescar = args.refrescar && intento === 1;
      console.log(`→ ${estado}: nivel 2 (corte por condado, intento ${intento})`);
      const cortes = await conEtapa(DIR_ESTADO, estado, e, "cortes", refrescar, () =>
        llamar(() => investigarCortes(estado, nombre, dominios, condados, tipoCorte)),
      );
      copiarCapturasDe([...cortes.courts.flatMap((c) => c.citations), ...cortes.counties.flatMap((c) => c.citations)], dirPruebas);
      const conCita = cortes.counties.filter((c) => c.citations.some((x) => x.found && esDominioOficial(x.url, dominios)));
      const citas = citasVerificables(muestraDe(conCita).flatMap((c) => c.citations), dominios);
      if (citas.length === 0) break;
      console.log(`→ ${estado}: re-verificación de una muestra de ${citas.length} citas de nivel 2`);
      const verificacion = await conEtapa(DIR_ESTADO, estado, e, "verificacionCortes", refrescar, () => llamar(() => reverificar(citas)));
      if (!muestraFalla(verificacion) || intento === 2) break;
      console.log(`⚠  ${estado}: la muestra de nivel 2 no pasó la re-verificación; repito el nivel 2.`);
      delete e.cortes;
      delete e.verificacionCortes;
      guardarEstado(DIR_ESTADO, estado, e);
    }
  }
}

/** v2: la orquestación vive en nivelesV2; aquí solo se conecta con la ventana real y su vigilancia de salida. */
async function nivelesPlaywright(ctx: Contexto): Promise<void> {
  const { estado, nombre, dominios, condados, e, args, dirPruebas, llamar, navegacion } = ctx;
  const cortesia = new Cortesia(3_000);
  const capturarUrl = vigilarCaptura(
    async (url) => capturar(await navegacion.motor(), url, { dominios, dirPruebas, cortesia }),
    recordarSalidaOk(async () => (await navegacion.salida()).problema === null, 120_000),
  );
  await nivelesV2({
    dirEstado: DIR_ESTADO,
    estado,
    nombre,
    dominios,
    condados,
    e,
    niveles: args.niveles,
    refrescar: args.refrescar,
    llamar,
    capturar: capturarUrl,
  });
}

async function procesarEstado(
  estado: string,
  args: ArgsCli,
  todos: Condado[],
  fuentes: ListaFuentes,
  presupuesto: Presupuesto,
  navegacion: Navegacion,
): Promise<ResumenEstado> {
  const nombre = nombreEstado(estado);
  const dominios = dominiosDe(fuentes, estado);
  const condados = condadosDeEstado(todos, estado);
  const e = leerEstado(DIR_ESTADO, estado);
  const dirPruebas = join(DIR_SALIDA, estado, "pruebas");
  const llamar = <T>(fn: () => Promise<Respuesta<T>>): Promise<T> =>
    conReintentos(async () => {
      presupuesto.consumir();
      try {
        const r = await fn();
        console.log(`   · llamada ${presupuesto.usadas}/${presupuesto.maximo}: ${Math.round(r.durationMs / 1000)} s, ref. ${r.costUsd.toFixed(2)} USD`);
        return r.data;
      } catch (err) {
        // Una llamada rechazada por límite de uso no se hizo: no gasta el tope mientras se espera.
        if (err instanceof LimiteDeUsoError) presupuesto.devolver();
        throw err;
      }
    }, REINTENTOS);

  const ctx: Contexto = { estado, nombre, dominios, condados, e, args, dirPruebas, llamar, navegacion };
  if (args.soloPaquete) {
    // Nada que investigar: el paquete sale de lo guardado.
  } else if (args.navegador === "extension") await nivelesExtension(ctx);
  else await nivelesPlaywright(ctx);

  const dirSalida = join(DIR_SALIDA, estado);
  mkdirSync(dirSalida, { recursive: true });
  const paquete = construirPaquete({
    estado,
    nombre,
    condados,
    dominios,
    ahora: new Date().toISOString(),
    reglas: e.reglas,
    verificacionReglas: e.verificacionReglas,
    cortes: e.cortes,
    verificacionCortes: e.verificacionCortes,
    fechas: e.fechas,
    rutaCaptura: (origen) => rutaCapturaV2(origen, dirPruebas),
  });
  const rutaPaquete = join(dirSalida, "paquete.json");
  if (existsSync(rutaPaquete)) {
    const anterior = Paquete.parse(JSON.parse(readFileSync(rutaPaquete, "utf8")));
    writeFileSync(join(dirSalida, "cambios.json"), JSON.stringify(diferencias(anterior, paquete), null, 2));
  }
  writeFileSync(rutaPaquete, JSON.stringify(paquete, null, 2));
  writeFileSync(join(dirSalida, "informe.html"), generarInforme(paquete));
  return resumenCobertura(paquete, condados.length);
}

async function main(): Promise<void> {
  const args = parsearArgs(process.argv.slice(2));
  const todos = cargarCondados();
  const fuentes = cargarFuentes();
  const presupuesto = new Presupuesto(args.maxLlamadas);
  const cobertura = leerCobertura(DIR_SALIDA);
  console.log(
    args.navegador === "extension"
      ? "Recolector SIJS — usa la ventana abierta de Brave con Urban VPN activa. No cierres Brave durante la corrida."
      : "Recolector SIJS — abre Brave con el perfil del recolector (Urban VPN) cuando haga falta. No cierres esa ventana durante la corrida.",
  );
  // En un objeto: TypeScript no sigue asignaciones hechas dentro de un cierre.
  const ventana: { motor: Motor | null } = { motor: null };
  const motor = async (nuevo: boolean): Promise<Motor> => {
    if (!nuevo && ventana.motor?.vivo()) return ventana.motor;
    await ventana.motor?.cerrar().catch(() => undefined);
    ventana.motor = await abrirMotorBrave();
    return ventana.motor;
  };
  const navegacion: Navegacion = {
    motor: () => motor(false),
    salida: () => comprobarSalida(motor, join(DIR_ESTADO, "_salida")),
  };
  try {
    // La salida por la VPN se comprueba antes de gastar una sola llamada.
    if (args.navegador === "playwright" && !args.soloPaquete) {
      const s = await navegacion.salida();
      if (s.problema !== null) throw new SinSalidaError(s);
    }
    await recorrerEstados(args, todos, fuentes, presupuesto, cobertura, navegacion);
  } catch (err) {
    if (!(err instanceof SinSalidaError)) throw err;
    console.log(`⏹  ${err.message}`);
    process.exitCode = 1;
  } finally {
    await ventana.motor?.cerrar().catch(() => undefined);
  }
}

async function recorrerEstados(
  args: ArgsCli,
  todos: Condado[],
  fuentes: ListaFuentes,
  presupuesto: Presupuesto,
  cobertura: ReturnType<typeof leerCobertura>,
  navegacion: Navegacion,
): Promise<void> {
  for (const estado of args.estados) {
    try {
      const r = await procesarEstado(estado, args, todos, fuentes, presupuesto, navegacion);
      cobertura.estados[estado] = r;
      console.log(`✔ ${estado}: ${r.condadosConCorte}/${r.condados} condados con corte · reglas ${r.reglas} · ${r.preguntasAbiertas} preguntas abiertas`);
    } catch (err) {
      if (err instanceof SinSalidaError) throw err;
      if (err instanceof PresupuestoAgotadoError) {
        console.log(`⏹  ${err.message}. Repite la misma orden (también con --refrescar) para continuar donde se quedó.`);
        guardarCobertura(DIR_SALIDA, cobertura);
        return;
      }
      const mensaje = err instanceof Error ? err.message : String(err);
      cobertura.estados[estado] = { error: mensaje, actualizadoEn: new Date().toISOString() };
      console.error(`✘ ${estado}: ${mensaje}`);
    }
    guardarCobertura(DIR_SALIDA, cobertura);
  }
}

const esEntrada = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esEntrada) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
