export interface ArgsFabrica {
  estados: string[];
  salida: string;
  /** Carpeta de la corrida v2 que tiene `estado/` y `salida/<ST>/pruebas/` (no están en git). */
  origen: string;
  /** Navegar lo que falta con Brave + Urban VPN (la ventana del recolector tiene que estar abierta y conectada). */
  navegar: boolean;
  /** Pasar las reglas por el verificador que refuta (Opus). */
  refutar: boolean;
  /** Medir un cambio del código: reconstruir con lo guardado en estado-v3, sin llamar a la IA, sin navegar y sin escribir el estado. */
  soloCache: boolean;
  /** Carpeta con los paquetes de antes, para comparar (medición y auditoría); null si no se compara. */
  base: string | null;
}

export function parsearArgsFabrica(argv: string[]): ArgsFabrica {
  const valor = (clave: string) => {
    const i = argv.indexOf(clave);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const estados = (valor("--estados") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  if (estados.length === 0) {
    throw new Error(
      "Uso: npm run fabrica -- --estados UT,NE [--origen <carpeta de la corrida v2>] [--salida salida-v3] [--navegar] [--refutar] [--solo-cache] [--base <carpeta de paquetes>]",
    );
  }
  const navegar = argv.includes("--navegar");
  const soloCache = argv.includes("--solo-cache");
  if (navegar && soloCache) throw new Error("--solo-cache no navega ni llama a la IA: quita --navegar.");
  return {
    estados,
    salida: valor("--salida") ?? (soloCache ? "salida-medicion" : "salida-v3"),
    origen: valor("--origen") ?? ".",
    navegar,
    refutar: argv.includes("--refutar"),
    soloCache,
    base: valor("--base") ?? (soloCache ? "salida-v3" : null),
  };
}
