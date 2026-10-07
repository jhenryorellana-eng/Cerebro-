import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cargarCondados, condadosDeEstado } from "../condados.js";
import { Paquete } from "../contrato/paquete.js";
import { nombreEstado } from "../estados.js";
import { cargarFuentes, dominiosDe } from "../fuentes.js";
import { LimiteDeUsoError } from "../ia.js";
import { abrirMotorBrave, capturar, comprobarSalida, Cortesia, recordarSalidaOk, SinSalidaError, vigilarCaptura, type Motor } from "../navegador.js";
import { descubrir } from "../tareas/descubrir.js";
import { parsearArgsFabrica } from "./args.js";
import { cargarCapturasGuardadas } from "./capturasGuardadas.js";
import { DIR_ESTADO_V3, fabricarEstado, iaSinLlamadas, leerEstadoV3 } from "./fabrica.js";
import { iaReal } from "./iaReal.js";
import { auditoria, informeMedicion, medir, type Medicion } from "./medicion.js";
import { modelosUsados } from "./modelos.js";
import { fijarPdfPorBytes } from "./pdfPorBytes.js";
import type { NavegacionFabrica } from "./navegar.js";

const VERSION_FABRICA = "3.2.0-rendimiento";

const args = parsearArgsFabrica(process.argv.slice(2));
const todos = cargarCondados();
const fuentes = cargarFuentes();
const modelos = modelosUsados();
const ia = args.soloCache ? iaSinLlamadas() : iaReal(modelos.extraer, undefined, modelos.refutar);
console.log(
  args.soloCache
    ? `Fábrica v3 en modo medición: solo lo guardado en ${DIR_ESTADO_V3}/, sin llamar a la IA ni navegar. Paquetes en ${args.salida}/.`
    : `Fábrica v3: extrae ${modelos.extraer}${args.refutar ? `, refuta ${modelos.refutar}` : ""}${args.navegar ? ", navega con Brave + Urban VPN" : ""}. Capturas de ${resolve(args.origen)}.`,
);

// Una sola ventana, la del recolector: se engancha por CDP (puerto 9333) y al final solo se desconecta.
const ventana: { motor: Motor | null } = { motor: null };
const motor = async (nuevo: boolean): Promise<Motor> => {
  if (!nuevo && ventana.motor?.vivo()) return ventana.motor;
  await ventana.motor?.cerrar().catch(() => undefined);
  ventana.motor = await abrirMotorBrave();
  return ventana.motor;
};
const salida = () => comprobarSalida(motor, join(args.origen, "estado", "_salida"));
const mediciones: Medicion[] = [];

try {
  if (args.navegar) {
    const s = await salida();
    if (s.problema !== null) throw new SinSalidaError(s);
  }
  for (const estado of args.estados) {
    const dominios = dominiosDe(fuentes, estado);
    const dirPruebas = join(args.origen, "salida", estado, "pruebas");
    const capturas = cargarCapturasGuardadas(estado, { estado: join(args.origen, "estado"), salida: join(args.origen, "salida") });
    const cortesia = new Cortesia(3_000);
    const navegacion: NavegacionFabrica | undefined = args.navegar
      ? {
          descubrir: (objetivo, doms) => descubrir(objetivo, doms, undefined, modelos.buscar),
          confirmarSalida: async () => {
            const s = await salida();
            if (s.problema !== null) throw new SinSalidaError(s);
          },
          capturar: vigilarCaptura(
            async (url) => fijarPdfPorBytes(await capturar(await motor(false), url, { dominios, dirPruebas, cortesia }), dirPruebas),
            recordarSalidaOk(async () => (await salida()).problema === null, 120_000),
          ),
        }
      : undefined;
    try {
      const p = await fabricarEstado({
        estado,
        nombre: nombreEstado(estado),
        dominios,
        condados: condadosDeEstado(todos, estado),
        capturas,
        ia,
        modelos,
        version: VERSION_FABRICA,
        dirPruebas,
        refutar: args.refutar,
        soloCache: args.soloCache,
        ...(navegacion ? { navegacion } : {}),
      });
      const dir = join(args.salida, estado);
      // La base se lee antes de escribir: puede ser la misma carpeta que la salida.
      const rutaBase = args.base ? join(args.base, estado, "paquete.json") : null;
      const antes = rutaBase && existsSync(rutaBase) ? Paquete.parse(JSON.parse(readFileSync(rutaBase, "utf8"))) : null;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "paquete.json"), `${JSON.stringify(p, null, 2)}\n`, "utf8");
      const todosLosDatos = [p.framework, ...p.courtTypes, ...p.routes, ...p.courts, ...p.courthouses, ...p.assignments, ...p.forms, ...p.filingRequirements];
      const cuenta = (s: string) => todosLosDatos.filter((x) => x.status === s).length;
      console.log(
        `✔ ${estado}: ${cuenta("verificado")} verificados, ${cuenta("a_revisar")} a revisión, ${cuenta("sin_dato")} sin dato ` +
          `(sedes ${p.courthouses.length}, formularios ${p.forms.length}, requisitos ${p.filingRequirements.length}, cortes con encabezado ${p.courts.filter((c) => c.caption.length > 0).length}) → ${join(dir, "paquete.json")}`,
      );
      if (args.base) {
        const m = medir(estado, antes, p);
        mediciones.push(m);
        if (m.nuevos.length > 0) writeFileSync(join(dir, "auditoria.md"), auditoria(p, m.nuevos, condadosDeEstado(todos, estado)), "utf8");
        console.log(`  ${m.nuevos.length} datos pasan a verificado y ${m.perdidos.length} dejan de estarlo${m.nuevos.length > 0 ? `: revísalos en ${join(dir, "auditoria.md")}` : ""}`);
      }
      const costes = leerEstadoV3(DIR_ESTADO_V3, estado).costes;
      if (!args.soloCache && costes) {
        console.log(`  coste acumulado por etapa (USD): ${Object.entries(costes).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}`);
      }
    } catch (err) {
      if (err instanceof SinSalidaError) throw err;
      if (err instanceof LimiteDeUsoError) {
        console.log(`✘ ${estado}: límite de uso de Claude. Vuelve a lanzar la misma orden más tarde: continúa donde se quedó.`);
        process.exitCode = 1;
        break;
      }
      console.log(`✘ ${estado}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
  if (mediciones.length > 0) {
    mkdirSync(args.salida, { recursive: true });
    writeFileSync(join(args.salida, "medicion.md"), informeMedicion(mediciones), "utf8");
    console.log(`Medición: ${join(args.salida, "medicion.md")}`);
  }
} catch (err) {
  if (!(err instanceof SinSalidaError)) throw err;
  console.log(`⏹  ${err.message}`);
  process.exitCode = 1;
} finally {
  await ventana.motor?.cerrar().catch(() => undefined);
}
