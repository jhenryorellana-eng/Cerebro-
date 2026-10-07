import { ejecutarExamen, NOMBRE_INFORME } from "./ejecutar.js";

const carpeta = process.argv[2];
if (!carpeta) {
  console.error("Uso: npm run examen -- <carpeta con <ST>/paquete.json>");
  process.exit(2);
}

const informe = ejecutarExamen(carpeta);
for (const e of informe.erroresDeCarga) console.log(`✘ carga  ${e}`);
const icono: Record<string, string> = { acierto: "✔", error_detectado: "△", error_peligroso: "✘", sin_dato: "·", sin_paquete: "–" };
for (const i of informe.items) console.log(`${icono[i.resultado]} ${i.estado} ${i.id.padEnd(28)} ${i.resultado.padEnd(16)} ${i.detalle}`);
for (const [tipo, t] of Object.entries(informe.porTipo)) console.log(`  ${tipo.padEnd(12)} ${t.aciertos}/${t.total}`);
console.log(
  `${informe.aprobado ? "✔ APROBADO" : "✘ NO APROBADO"}: ${informe.aciertos}/${informe.total} aciertos, ` +
    `${informe.erroresPeligrosos} errores peligrosos, ${informe.erroresDeCarga.length} errores de carga. Informe: ${carpeta}/${NOMBRE_INFORME}`,
);
process.exitCode = informe.aprobado ? 0 : 1;
