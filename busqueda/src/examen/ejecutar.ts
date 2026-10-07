import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cargarCondados } from "../condados.js";
import { Paquete } from "../contrato/paquete.js";
import { validarPaquete } from "../contrato/validar.js";
import { evaluar, type Informe } from "./evaluar.js";
import { cargarRespuestas, RUTA_RESPUESTAS } from "./respuestas.js";

export interface InformeCarpeta extends Informe {
  erroresDeCarga: string[];
}

export const NOMBRE_INFORME = "examen-informe.json";

/** Lee `<carpeta>/<ST>/paquete.json`, evalúa contra las respuestas y deja el informe en la carpeta. */
export function ejecutarExamen(carpeta: string, rutaRespuestas: string = RUTA_RESPUESTAS): InformeCarpeta {
  const respuestas = cargarRespuestas(rutaRespuestas);
  const todos = cargarCondados();
  const paquetes = new Map<string, Paquete>();
  const erroresDeCarga: string[] = [];

  for (const estado of readdirSync(carpeta).filter((d) => /^[A-Z]{2}$/.test(d)).sort()) {
    const ruta = join(carpeta, estado, "paquete.json");
    if (!existsSync(ruta)) continue;
    let crudo: unknown;
    try {
      crudo = JSON.parse(readFileSync(ruta, "utf8"));
    } catch (err) {
      erroresDeCarga.push(`${estado}: JSON ilegible (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const r = Paquete.safeParse(crudo);
    if (!r.success) {
      erroresDeCarga.push(`${estado}: no cumple el contrato v2 (${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")})`);
      continue;
    }
    if (r.data.state !== estado) {
      erroresDeCarga.push(`${estado}: la carpeta ${estado} contiene el paquete de ${r.data.state}`);
      continue;
    }
    const condados = new Set(todos.filter((c) => c.state === estado).map((c) => c.fips));
    const problemas = validarPaquete(r.data, { condados });
    if (problemas.length > 0) {
      erroresDeCarga.push(`${estado}: ${problemas.length} problemas del validador (${problemas.slice(0, 3).map((x) => `${x.codigo} ${x.clave}`).join("; ")})`);
      continue;
    }
    paquetes.set(estado, r.data);
  }

  const informe = evaluar(respuestas, paquetes);
  const final: InformeCarpeta = { ...informe, aprobado: informe.aprobado && erroresDeCarga.length === 0, erroresDeCarga };
  writeFileSync(join(carpeta, NOMBRE_INFORME), `${JSON.stringify(final, null, 2)}\n`, "utf8");
  return final;
}
