// Sonda de usar y tirar: descarga archivos oficiales (doc/docx) DESDE la página de la ventana de Brave del recolector,
// para que la petición salga por la VPN del navegador.
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const [dir, origen, ...urls] = process.argv.slice(2);
const navegador = await chromium.connectOverCDP("http://127.0.0.1:9333");
const pestana = await navegador.contexts()[0]!.newPage();
try {
  await pestana.goto(origen, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (const url of urls) {
    const r = (await pestana.evaluate(async (u) => {
      const res = await fetch(u); const buf = new Uint8Array(await res.arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { status: res.status, tipo: res.headers.get("content-type"), b64: btoa(s) };
    }, url)) as { status: number; tipo: string; b64: string };
    const b = Buffer.from(r.b64, "base64"); const sha = createHash("sha256").update(b).digest("hex");
    const nombre = decodeURIComponent(url.split("/").pop()!);
    writeFileSync(join(dir, nombre), b);
    console.log(JSON.stringify({ nombre, status: r.status, bytes: b.length, sha, tipo: r.tipo }));
  }
} finally { await pestana.close(); process.exit(0); }
