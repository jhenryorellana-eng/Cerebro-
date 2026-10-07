// Sonda de usar y tirar: captura páginas oficiales de Washington con la ventana de Brave del recolector (VPN), con las
// mismas funciones de la fábrica, y guarda los enlaces de cada página. Uso: npx tsx sonda-wa.tmp.ts <dirPruebas> <url>...
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { abrirMotorBrave, capturar, Cortesia, verificarSalida } from "./src/navegador.js";

const [dir, ...urls] = process.argv.slice(2);
if (!dir) throw new Error("falta dirPruebas");
mkdirSync(dir, { recursive: true });
const motor = await abrirMotorBrave();
try {
  const s = await verificarSalida(motor, dir);
  if (s.problema !== null) { console.log(JSON.stringify({ vpn: "mal", problema: s.problema })); process.exit(1); }
  const cortesia = new Cortesia(1500);
  for (const url of urls) {
    const c = await capturar(motor, url, { dominios: ["leginfo.legislature.ca.gov", "courts.ca.gov", "www.courts.ca.gov", "selfhelp.courts.ca.gov", "stanct.org", "www.stanct.org", "www.stanislaus.courts.ca.gov", "stanislaus.courts.ca.gov"], dirPruebas: dir, cortesia });
    const fila = { url, finalUrl: c.finalUrl, status: c.status, problema: c.problema, sha: c.sha256, chars: c.texto.length, title: c.title, pdfs: c.enlacesPdf ?? [] };
    writeFileSync(join(dir, `${c.sha256}.meta.json`), JSON.stringify(fila, null, 1));
    console.log(JSON.stringify({ ...fila, pdfs: fila.pdfs.length }));
  }
} finally {
  await motor.cerrar();
}
