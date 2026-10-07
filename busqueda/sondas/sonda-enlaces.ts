// Sonda de usar y tirar: lista los enlaces de páginas oficiales (texto de su fila + URL) con la ventana de Brave del recolector.
import { chromium } from "playwright-core";
const urls = process.argv.slice(2);
const navegador = await chromium.connectOverCDP("http://127.0.0.1:9333");
const pestana = await navegador.contexts()[0]!.newPage();
try {
  for (const url of urls) {
    await pestana.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await pestana.waitForTimeout(2500);
    const enlaces = (await pestana.evaluate(
      "[...document.querySelectorAll('a[href]')].map((a) => [((a.closest('tr,li,p') || a).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220), (a.textContent || '').replace(/\s+/g, ' ').trim(), a.href])",
    )) as [string, string, string][];
    console.log(JSON.stringify({ url, final: pestana.url(), enlaces }));
  }
} finally {
  await pestana.close();
  process.exit(0);
}
