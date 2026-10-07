import { hayBloqueos, reverificarConCodigo } from "./comprobar.js";
import type { Condado } from "./condados.js";
import { conEtapa, guardarEstado, guardarLote, type EstadoCorrida } from "./estado.js";
import { esDominioOficial } from "./fuentes.js";
import type { Respuesta } from "./ia.js";
import type { Captura } from "./navegador.js";
import { citaVerificada } from "./paquete.js";
import { muestraDe } from "./tareas/cortesCondados.js";
import { dividirEnLotes, fusionarLotes, investigarLoteV2, investigarReglasV2, prepararDirectorio } from "./tareas/v2.js";
import { citasVerificables } from "./tareas/verificarCitas.js";

/** Las tareas con IA, inyectables para probar la orquestación sin llamar a Claude. */
export interface ImplV2 {
  investigarReglasV2: typeof investigarReglasV2;
  prepararDirectorio: typeof prepararDirectorio;
  investigarLoteV2: typeof investigarLoteV2;
}

const IMPL_REAL: ImplV2 = { investigarReglasV2, prepararDirectorio, investigarLoteV2 };

export interface ContextoV2 {
  dirEstado: string;
  estado: string;
  nombre: string;
  dominios: string[];
  condados: Condado[];
  e: EstadoCorrida;
  niveles: Set<number>;
  refrescar: boolean;
  llamar: <T>(fn: () => Promise<Respuesta<T>>) => Promise<T>;
  /** Ya vigilada: si la salida por la VPN cae, lanza SinSalidaError en vez de devolver un fallo. */
  capturar: (url: string) => Promise<Captura>;
  log?: (linea: string) => void;
}

/** --refrescar borra cada nivel una sola vez: si la corrida se corta, la misma orden continúa donde se quedó. */
function empezarRefresco(ctx: ContextoV2): void {
  const { e } = ctx;
  if (!ctx.refrescar) return;
  const enCurso = new Set(e.refrescoEnCurso ?? []);
  const nuevos = [...ctx.niveles].filter((n) => !enCurso.has(n));
  if (nuevos.length === 0) return;
  if (nuevos.includes(1)) {
    delete e.reglas;
    delete e.verificacionReglas;
  }
  if (nuevos.includes(2)) {
    delete e.directorio;
    delete e.lotesCortes;
    delete e.cortes;
    delete e.verificacionCortes;
  }
  e.refrescoEnCurso = [...enCurso, ...nuevos].sort();
  guardarEstado(ctx.dirEstado, ctx.estado, e);
}

/** v2: el código captura y comprueba cada cita; la IA solo busca URLs y lee textos. */
export async function nivelesV2(ctx: ContextoV2, impl: ImplV2 = IMPL_REAL): Promise<void> {
  const { dirEstado, estado, nombre, dominios, condados, e, llamar, capturar } = ctx;
  const log = ctx.log ?? console.log;
  const deps = { capturar };
  empezarRefresco(ctx);

  if (ctx.niveles.has(1)) {
    log(`→ ${estado}: nivel 1 (reglas, Playwright)`);
    const reglas = await conEtapa(dirEstado, estado, e, "reglas", false, () =>
      llamar(() => impl.investigarReglasV2(estado, nombre, dominios, deps)),
    );
    const citas = citasVerificables(
      reglas.routes.flatMap((v) => [v.route, v.courtType, v.ageLimitExclusive, v.venueRule].flatMap((a) => a.citations)),
      dominios,
    );
    if (citas.length > 0) {
      log(`→ ${estado}: re-verificación por código de ${citas.length} citas de nivel 1`);
      await conEtapa(dirEstado, estado, e, "verificacionReglas", hayBloqueos(e.verificacionReglas), () => reverificarConCodigo(citas, capturar));
    }
  }

  if (ctx.niveles.has(2)) {
    // Un nivel 2 ya hecho (también el de la extensión) no se repite: para rehacerlo está --refrescar.
    if (!e.cortes) {
      // Solo un tipo de corte con al menos una cita oficial comprobada guía el nivel 2.
      const tipoCorte =
        e.reglas?.routes.find(
          (v) => v.courtType.value && v.courtType.citations.some((c) => citaVerificada(c) && esDominioOficial(c.url, dominios)),
        )?.courtType.value ?? null;
      const directorio = await conEtapa(dirEstado, estado, e, "directorio", false, () =>
        llamar(() => impl.prepararDirectorio(estado, nombre, dominios, tipoCorte, deps)),
      );
      const lotes = dividirEnLotes(condados, 25);
      for (let i = e.lotesCortes?.length ?? 0; i < lotes.length; i++) {
        log(`→ ${estado}: nivel 2, lote ${i + 1}/${lotes.length}`);
        // Los nombres ya usados viajan al lote siguiente: así la misma entidad se llama igual en todo el estado.
        const previas = [...new Set((e.lotesCortes ?? []).flatMap((l) => l.courts.map((c) => c.name)))];
        const r = await llamar(() => impl.investigarLoteV2(estado, nombre, dominios, lotes[i]!, tipoCorte, directorio, deps, previas));
        guardarLote(dirEstado, estado, e, r);
      }
      await conEtapa(dirEstado, estado, e, "cortes", false, async () => fusionarLotes(e.lotesCortes ?? []));
    }
    const cortes = e.cortes!;
    const conCita = cortes.counties.filter((c) => c.citations.some((x) => citaVerificada(x) && esDominioOficial(x.url, dominios)));
    const citas = citasVerificables(muestraDe(conCita).flatMap((c) => c.citations), dominios);
    if (citas.length > 0) {
      log(`→ ${estado}: re-verificación por código de una muestra de ${citas.length} citas de nivel 2`);
      await conEtapa(dirEstado, estado, e, "verificacionCortes", hayBloqueos(e.verificacionCortes), () => reverificarConCodigo(citas, capturar));
    }
  }

  if (e.refrescoEnCurso) {
    delete e.refrescoEnCurso;
    guardarEstado(dirEstado, estado, e);
  }
}
