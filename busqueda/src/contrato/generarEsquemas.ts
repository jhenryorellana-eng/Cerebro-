import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Paquete } from "./paquete.js";
import { Resolucion } from "./resolucion.js";
import { CONTRATO_VERSION } from "./vocabularios.js";

export const DIR_FIXTURES = join("contrato", "fixtures");
export const DIR_ESQUEMAS = join("contrato", "esquemas");

/** Lee y valida con Zod un paquete de ejemplo: lanza si no cumple el esquema. */
export function cargarFixturePaquete(estado: string): Paquete {
  return Paquete.parse(JSON.parse(readFileSync(join(DIR_FIXTURES, "paquetes", `${estado}.json`), "utf8")));
}

/** Un JSON Schema con su identidad: el nombre del documento y la versión del contrato que lo generó. */
function conIdentidad(nombre: string, titulo: string, esquema: object): string {
  const { $schema, ...resto } = esquema as { $schema?: string } & Record<string, unknown>;
  const conId = { $schema, $id: `urn:contygo:cerebro:contrato:${CONTRATO_VERSION}:${nombre}`, title: `${titulo} (contrato ${CONTRATO_VERSION})`, ...resto };
  return `${JSON.stringify(conId, null, 2)}\n`;
}

/** Los JSON Schema que se copian a x-legal, con el contenido exacto que se commitea. */
export function esquemasJson(): Record<string, string> {
  return {
    "paquete-v2.schema.json": conIdentidad("paquete", "Paquete v2 del cerebro jurisdiccional", z.toJSONSchema(Paquete)),
    "resolucion-v2.schema.json": conIdentidad("resolucion", "Respuesta del resolvedor jurisdiccional", z.toJSONSchema(Resolucion)),
  };
}
