import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIR_ESQUEMAS, esquemasJson } from "./generarEsquemas.js";

mkdirSync(DIR_ESQUEMAS, { recursive: true });
for (const [nombre, contenido] of Object.entries(esquemasJson())) {
  writeFileSync(join(DIR_ESQUEMAS, nombre), contenido, "utf8");
  console.log(`✔ ${join(DIR_ESQUEMAS, nombre)}`);
}
