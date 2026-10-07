import { join } from "node:path";
import { abrirMotorBrave, MENSAJE_SIN_SALIDA, verificarSalida } from "./navegador.js";

/** Abre (o reutiliza) la ventana de Brave del recolector y dice si la salida por la VPN funciona. */
const motor = await abrirMotorBrave();
try {
  const c = await verificarSalida(motor, join("estado", "_salida"));
  if (c.problema === null) {
    console.log("✔ Salida por la VPN correcta. Deja abierta esa ventana de Brave y lanza el recolector.");
  } else {
    console.log(`✘ ${MENSAJE_SIN_SALIDA}`);
    console.log(`  (${c.problema}: ${c.detalle.split("\n")[0]})`);
    process.exitCode = 1;
  }
} finally {
  await motor.cerrar();
}
