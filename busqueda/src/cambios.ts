import type { Paquete } from "./tipos.js";

export interface Cambio {
  tipo: "nueva" | "retirada" | "cambiada";
  id: string;
  detalle: string;
}

export function diferencias(anterior: Paquete, nuevo: Paquete): Cambio[] {
  const antes = new Map(anterior.edges.map((a) => [a.id, a]));
  const despues = new Map(nuevo.edges.map((a) => [a.id, a]));
  const cambios: Cambio[] = [];
  for (const [id, a] of antes) {
    const b = despues.get(id);
    if (!b) {
      cambios.push({ tipo: "retirada", id, detalle: `${a.from} → ${a.to}` });
      continue;
    }
    const partes: string[] = [];
    if (a.confidence !== b.confidence) partes.push(`confianza: ${a.confidence} → ${b.confidence}`);
    const attrsA = JSON.stringify(a.attrs);
    const attrsB = JSON.stringify(b.attrs);
    if (attrsA !== attrsB) partes.push(`attrs: ${attrsA} → ${attrsB}`);
    if (partes.length > 0) cambios.push({ tipo: "cambiada", id, detalle: partes.join("; ") });
  }
  for (const [id, b] of despues) if (!antes.has(id)) cambios.push({ tipo: "nueva", id, detalle: `${b.from} → ${b.to}` });
  return cambios;
}
