import { ErrorDeClaude, LimiteDeUsoError } from "./ia.js";

export class PresupuestoAgotadoError extends Error {
  constructor(maximo: number) {
    super(`Tope de ${maximo} llamadas a Claude alcanzado`);
    this.name = "PresupuestoAgotadoError";
  }
}

export class Presupuesto {
  usadas = 0;
  readonly maximo: number;
  constructor(maximo: number) {
    this.maximo = maximo;
  }
  consumir(): void {
    if (this.usadas >= this.maximo) throw new PresupuestoAgotadoError(this.maximo);
    this.usadas++;
  }
  /** Devuelve una llamada que no llegó a hacerse (p. ej. rechazada por límite de uso). */
  devolver(): void {
    if (this.usadas > 0) this.usadas--;
  }
}

export interface OpcionesReintento {
  esperaLimiteMs: number;
  maxEsperasLimite: number;
  maxErrores: number;
  dormir?: (ms: number) => Promise<void>;
  alEsperar?: (motivo: string, ms: number) => void;
}

export async function conReintentos<T>(fn: () => Promise<T>, o: OpcionesReintento): Promise<T> {
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let esperas = 0;
  let errores = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof LimiteDeUsoError && esperas < o.maxEsperasLimite) {
        esperas++;
        o.alEsperar?.(`Límite de uso del plan (${esperas}/${o.maxEsperasLimite})`, o.esperaLimiteMs);
        await dormir(o.esperaLimiteMs);
        continue;
      }
      if (err instanceof ErrorDeClaude && errores < o.maxErrores) {
        errores++;
        o.alEsperar?.(`Error de Claude, reintento ${errores}/${o.maxErrores}: ${err.message}`, 5_000);
        await dormir(5_000);
        continue;
      }
      throw err;
    }
  }
}
