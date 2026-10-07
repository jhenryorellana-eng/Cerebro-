// src/v3/construirSedes.ts
import type { Asignacion, Corte, Sede } from "../contrato/paquete.js";
import type { ReglaSede } from "../contrato/vocabularios.js";
import type { Cita } from "../esquemas.js";
import type { SedesPropuestas } from "./esquemas.js";
import { f1, f3, f5Sede, f7, fallo, nombraAlguno, type ResultadoFiltro } from "./filtros.js";
import { estadoDe, EXTRAIDO_POR_DIRECCION, slug, type CtxNivel } from "./nivel.js";

/** Las propuestas del nivel 3 para un tipo de corte (clave de paquete): un resultado por lote de condados. */
export interface SedesDeUnTipo {
  tipoKey: string;
  lotes: SedesPropuestas[];
}

interface EntradaSede {
  sede: Sede;
  /** Todas las citas propuestas, comprobadas. */
  citas: Cita[];
  /** Las que nombran la sede: encontradas y de una página oficial. */
  nombran: Cita[];
  /** Las que, sin nombrarla, muestran su dirección (su calle y, detrás, el ZIP de su ciudad): del extractor o del código. */
  direcciones: Cita[];
  dudas: string[];
  notas: string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const plano = (sha: string) => sha.replace(/-/g, "").toLowerCase();

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Dónde aparece la frase en el texto como palabras completas, sin distinguir mayúsculas: [inicio, fin) de cada vez. */
function apariciones(texto: string, frase: string): [number, number][] {
  const f = frase.replace(/\s+/g, " ").trim();
  if (!f) return [];
  const r = new RegExp(`(?<![A-Za-z0-9])${escapar(f).replace(/ /g, String.raw`\s+`)}(?![A-Za-z0-9])`, "gi");
  return [...texto.matchAll(r)].map((m) => [m.index, m.index + m[0].length]);
}

/**
 * El tramo de la cita que habla de esta sede: lo que va DESPUÉS de su nombre y ANTES del siguiente nombre de otra sede
 * propuesta para el estado (en las páginas reales todas las sedes van seguidas, sin puntos). Si el nombre aparece
 * varias veces, los tramos se unen con un salto de línea; un nombre que solo es parte del de otra sede más largo
 * («Matheson Courthouse» dentro de «Matheson Courthouse Annex») no abre tramo. Null si la cita no nombra la sede.
 */
export function tramoDeSede(quote: string, nombre: string, otrosNombres: readonly string[]): string | null {
  const otras = otrosNombres.filter((o) => o.replace(/\s+/g, " ").trim().toLowerCase() !== nombre.replace(/\s+/g, " ").trim().toLowerCase()).flatMap((o) => apariciones(quote, o));
  const tramos: string[] = [];
  for (const [inicio, fin] of apariciones(quote, nombre)) {
    if (otras.some(([i, f]) => i <= inicio && f >= fin && f - i > fin - inicio)) continue;
    const corte = Math.min(quote.length, ...otras.filter(([i]) => i >= fin).map(([i]) => i));
    tramos.push(quote.slice(fin, corte));
  }
  return tramos.length > 0 ? tramos.join("\n") : null;
}

/**
 * La cita sin los tramos de las OTRAS sedes propuestas (desde el nombre de otra sede hasta el siguiente nombre de
 * cualquiera, o hasta el final): lo que queda habla de esta sede o de ninguna. Así una sede no se queda con el condado
 * que la misma cita atribuye a otra (N2).
 */
export function sinTramosDeOtras(quote: string, nombre: string, otrosNombres: readonly string[]): string {
  const mias = apariciones(quote, nombre);
  const otras = otrosNombres
    .filter((o) => norm(o) !== norm(nombre))
    .flatMap((o) => apariciones(quote, o))
    // El nombre de otra sede dentro del mío, más largo, no es otra sede («Matheson Courthouse» en «Matheson Courthouse Annex»).
    .filter(([i, f]) => !mias.some(([a, b]) => a <= i && b >= f && b - a > f - i))
    .sort((x, y) => x[0] - y[0]);
  const inicios = [...mias, ...otras].map(([i]) => i);
  let salida = "";
  let desde = 0;
  for (const [i] of otras) {
    if (i < desde) continue;
    salida += `${quote.slice(desde, i)} `;
    desde = Math.min(quote.length, ...inicios.filter((x) => x > i));
  }
  return salida + quote.slice(desde);
}

/** El ZIP de 5 dígitos de «Salt Lake City, UT 84114-0431» (el último que aparezca), o null si no trae. */
function zipDe(ciudad: string): string | null {
  const zips = [...ciudad.matchAll(/(?<!\d)(\d{5})(?:-\d{4})?(?!\d)/g)].map((m) => m[1]!);
  return zips.at(-1) ?? null;
}

/**
 * La dirección de una sede tal como la escribe un texto: su calle y, a menos de 80 caracteres detrás, el ZIP de su
 * ciudad como primer ZIP tras la calle (si antes sale otro, esa calle es de otra ciudad), sin el nombre de otra sede
 * propuesta entre medias. Devuelve ese trozo literal (de la calle al ZIP), o null.
 */
export function direccionEn(texto: string, calle: string | null, zip: string | null, otrosNombres: readonly string[]): string | null {
  if (!calle || !zip) return null;
  for (const [inicio, fin] of apariciones(texto, calle)) {
    const ventana = texto.slice(fin, fin + 80);
    const z = /(?<!\d)\d{5}(?!\d)/.exec(ventana);
    if (!z || z[0] !== zip) continue;
    const entre = ventana.slice(0, z.index);
    if (otrosNombres.some((o) => apariciones(entre, o).length > 0)) continue;
    return texto.slice(inicio, fin + z.index + zip.length);
  }
  return null;
}

/**
 * Qué impide aplicar una regla de sede sin romper el contrato (§5.3: tantas sedes como pida la regla, y de su corte).
 * «No atiende este condado» mira también el territorio que propuso el extractor aunque las citas no lo probaran: si él
 * mismo dijo que la sede atiende otros condados, la regla contradice su propia propuesta.
 */
function problemaRegla(
  regla: ReglaSede,
  sedes: (Sede | undefined)[],
  courtKey: string,
  fips: string | null,
  propuesto: (s: Sede) => Sede["serves"],
): string | null {
  if (sedes.some((s) => s === undefined)) return "cita sedes que no están en su lote o con una clave repetida en su lote";
  const lista = [...new Set(sedes as Sede[])];
  if (lista.some((s) => s.courtKey !== courtKey)) return "cita sedes de otra corte";
  const excluye = (sv: Sede["serves"]) => fips !== null && sv?.kind === "condado" && !sv.codes.includes(fips);
  if (lista.some((s) => excluye(s.serves) || excluye(propuesto(s)))) return "la sede no atiende este condado";
  if (regla === "unica" && lista.length !== 1) return "«unica» exige una sola sede";
  if (regla === "por_zip" && (lista.length === 0 || lista.some((s) => s.serves?.kind !== "zip"))) return "las sedes no dicen qué códigos postales atienden";
  if (regla === "por_pueblo" && (lista.length === 0 || lista.some((s) => s.serves?.kind !== "pueblo"))) return "las sedes no dicen qué pueblos atienden";
  if (regla === "a_eleccion" && lista.length < 2) return "«a_eleccion» exige varias sedes";
  return null;
}

/**
 * «unica» es una afirmación negativa («ninguna otra sede lo atiende») que ninguna cita prueba de frente. Solo se acepta
 * si todas las OTRAS sedes de la misma corte en el paquete dicen atender otros condados y ninguna este; con una sola
 * corte para el estado, si la corte no tiene otras sedes. Una hermana solo prueba que no atiende el condado si está
 * verificada, con su territorio cotejado (N1): una que no pasó sus filtros podría atenderlo.
 */
function unicaSinPrueba(propias: Sede[], todas: Sede[], courtKey: string, fips: string | null): string | null {
  const claves = new Set(propias.map((s) => s.key));
  const otras = todas.filter((s) => s.courtKey === courtKey && !claves.has(s.key));
  const podrian = fips === null ? otras : otras.filter((s) => s.status !== "verificado" || s.serves?.kind !== "condado" || s.serves.codes.includes(fips));
  return podrian.length > 0 ? "«unica» no se puede probar: la corte tiene otras sedes que podrían atender este condado" : null;
}

/**
 * Nivel 3. Las sedes pasan F1, F3, F5 y F7 como las asignaciones (§6.3). F1: alguna cita nombra la sede. F3: dos páginas
 * oficiales la nombran o muestran su dirección; si el extractor solo dio una, el código busca la segunda (otra página
 * oficial con la misma calle y el ZIP de su ciudad). Esas páginas de dirección solo cuentan para F3: la calle, el ZIP y
 * el territorio de la sede los prueban las citas que la nombran (F5), para que una sede no se quede con la dirección de
 * otra. La regla de sede solo se aplica a una asignación si es coherente
 * con sus sedes, todas verificadas, no contradice a otra regla, la confirman dos páginas oficiales que nombran el condado
 * (como condado) y sus sedes, y, si es «unica», ninguna otra sede de la corte puede atender el condado; si no, la
 * asignación queda «sin_regla» (el resolvedor da la excepción sede_sin_regla) y queda la nota del motivo.
 */
export function construirSedes(ctx: CtxNivel, grupos: SedesDeUnTipo[], courts: Corte[], assignments: Asignacion[]): Sede[] {
  const cortes = new Map(courts.map((c) => [c.key, c]));
  const fipsEstado = new Set(ctx.condados.map((c) => c.fips));
  /** Los nombres de todas las sedes propuestas para el estado (también las descartadas): acotan el tramo de cada una. */
  const nombresPropuestos = [...new Set(grupos.flatMap((g) => g.lotes.flatMap((l) => l.courthouses.map((s) => s.name.replace(/\s+/g, " ").trim()))))].filter(Boolean);
  const otrosNombres = (nombre: string) => nombresPropuestos.filter((n) => norm(n) !== norm(nombre));
  const sedes = new Map<string, EntradaSede>();
  const reglas: { a: Asignacion; r: SedesPropuestas["rules"][number]; claves: (string | undefined)[]; nota: string }[] = [];

  for (const g of grupos) {
    for (const lote of g.lotes) {
      const delLote = new Map<string, string>();
      const repetidas = new Set<string>();
      for (const s of lote.courthouses) {
        const corte = cortes.get(s.courtKey);
        const nombre = s.name.replace(/\s+/g, " ").trim();
        if (!corte || corte.courtTypeKey !== g.tipoKey || !nombre) {
          ctx.nota(null, `Sede «${s.name}» descartada: «${s.courtKey}» no es una corte de este tipo en el paquete.`);
          continue;
        }
        // La clave lleva la clave de la corte (que ya incluye su tipo): dos cortes de tipos distintos no funden sedes.
        const key = `${ctx.st}:sede:${slug(corte.key.split(":").slice(2).join("-"))}:${slug(nombre)}`;
        if (delLote.has(s.key)) {
          repetidas.add(s.key);
          ctx.nota(null, `La clave de sede «${s.key}» está repetida en su lote: las reglas que la citen no se aplican.`);
        }
        delLote.set(s.key, key);
        const calle = s.street?.trim() || null;
        const ciudad = s.cityStateZip?.trim() || null;
        const zip = ciudad ? zipDe(ciudad) : null;
        const citas = ctx.comprobar(s.citations);
        const vale = (i: number) => citas[i]!.found && ctx.oficial(citas[i]!.url);
        const nombranSede = s.citations.filter((_, i) => vale(i) && nombraAlguno(citas[i]!.quote, [nombre]));
        const muestranDireccion = s.citations.filter(
          (_, i) => vale(i) && !nombraAlguno(citas[i]!.quote, [nombre]) && direccionEn(citas[i]!.quote, calle, zip, otrosNombres(nombre)) !== null,
        );
        const ev = ctx.citar(key, "name", nombranSede);
        const evDireccion = ctx.citar(key, "street", muestranDireccion);
        const nombran = ev.citas.filter((c) => c.found);
        const direcciones = evDireccion.citas.filter((c) => c.found);
        const codes = [...new Set((s.serves?.codes ?? []).map((x) => x.trim()).filter(Boolean))];
        const serves = s.serves && codes.length > 0 ? { kind: s.serves.kind, codes } : null;
        const previa = sedes.get(key);
        if (previa) {
          const p = previa.sede;
          if (p.street && calle && norm(p.street) !== norm(calle)) previa.dudas.push(`la sede tiene dos calles distintas en los lotes: «${p.street}» y «${calle}»`);
          if (p.cityStateZip && ciudad && norm(p.cityStateZip) !== norm(ciudad)) previa.dudas.push(`la sede tiene dos ciudades distintas en los lotes: «${p.cityStateZip}» y «${ciudad}»`);
          p.street ??= calle;
          p.cityStateZip ??= ciudad;
          if (serves && p.serves && p.serves.kind === serves.kind) {
            p.serves.codes = [...new Set([...p.serves.codes, ...serves.codes])];
          } else if (serves && p.serves) {
            previa.dudas.push(`la sede dice atender territorios de dos clases distintas en los lotes: «${p.serves.kind}» y «${serves.kind}»`);
          } else if (serves) {
            p.serves = serves;
          }
          p.evidenceKeys.push(...ev.claves, ...evDireccion.claves);
          previa.citas.push(...citas);
          previa.nombran.push(...nombran);
          previa.direcciones.push(...direcciones);
          previa.dudas.push(...s.dudas);
          previa.notas.push(lote.notes);
        } else {
          sedes.set(key, {
            sede: { key, status: "a_revisar", filters: [], evidenceKeys: [...ev.claves, ...evDireccion.claves], courtKey: corte.key, name: nombre, street: calle, cityStateZip: ciudad, serves },
            citas: [...citas],
            nombran: [...nombran],
            direcciones: [...direcciones],
            dudas: [...s.dudas],
            notas: [lote.notes],
          });
        }
      }
      for (const r of lote.rules) {
        const a = assignments.find((x) => x.courtTypeKey === g.tipoKey && (x.territory.code === r.fips || x.territory.kind === "estado_unico"));
        if (!a) {
          ctx.nota(null, `Regla de sede para ${r.fips} descartada: el condado no tiene asignación de este tipo.`);
          continue;
        }
        reglas.push({ a, r, claves: r.courthouseKeys.map((k) => (repetidas.has(k) ? undefined : delLote.get(k))), nota: lote.notes });
      }
    }
  }

  // La segunda fuente de una sede la busca también el código: otra página oficial con su dirección (calle y ZIP).
  for (const x of sedes.values()) {
    const { sede } = x;
    const zip = sede.cityStateZip ? zipDe(sede.cityStateZip) : null;
    const propias = new Set([...x.nombran, ...x.direcciones].map((c) => plano(c.pageSha256)));
    if (propias.size >= 2 || !sede.street || !zip) continue;
    for (const p of ctx.paginas) {
      if (propias.has(p.sha)) continue;
      const trozo = direccionEn(p.texto, sede.street, zip, otrosNombres(sede.name));
      if (!trozo) continue;
      const ev = ctx.citar(sede.key, "street", [{ url: p.url, quote: trozo }], EXTRAIDO_POR_DIRECCION);
      sede.evidenceKeys.push(...ev.claves);
      x.direcciones.push(...ev.citas.filter((c) => c.found));
      break;
    }
  }

  /**
   * F5 de una sede y el territorio que le queda: lo que afirma tiene que aparecer en las citas que la nombran (las que
   * solo muestran una dirección no dicen de qué sede es). Un ZIP sin cita, un pueblo (las tablas de pueblos son de otro
   * subproyecto), una dirección o el ZIP de la ciudad fuera del tramo de esta sede dejan F5 en rojo; un condado que esas
   * citas no nombran fuera de los tramos de las otras sedes solo tira el territorio (null, con nota), porque sin él la
   * sede sigue siendo cierta.
   */
  const comprobarSede = (sede: Sede, nombran: Cita[]): { f5: ResultadoFiltro; serves: Sede["serves"] } => {
    const territorio = f5Sede(sede.serves, fipsEstado);
    if (!territorio.ok) return { f5: territorio, serves: sede.serves };
    const suyas = nombran.map((c) => c.quote);
    const aparece = (x: string) => suyas.some((t) => nombraAlguno(t, [x]));
    // La calle y el ZIP de la ciudad, en el tramo de esta sede: no los de otra sede de la misma cita.
    const tramos = nombran.map((c) => tramoDeSede(c.quote, sede.name, nombresPropuestos)).filter((t): t is string => t !== null);
    const enSuTramo = (x: string) => tramos.some((t) => nombraAlguno(t, [x]));
    const problemas: string[] = [];
    let serves = sede.serves;
    if (serves?.kind === "zip") {
      const sinCita = serves.codes.filter((z) => !aparece(z));
      if (sinCita.length > 0) problemas.push(`códigos postales sin cita: ${sinCita.join(", ")}`);
    } else if (serves?.kind === "pueblo") {
      problemas.push("una sede no atiende pueblos en este nivel (las tablas de pueblos son del subproyecto 2c)");
    } else if (serves?.kind === "condado") {
      const libres = suyas.map((q) => sinTramosDeOtras(q, sede.name, nombresPropuestos));
      const sinCita = serves.codes.filter((f) => !libres.some((t) => ctx.lector.nombra(t, f)));
      if (sinCita.length > 0) {
        ctx.nota(sede.key, `Territorio de la sede descartado: ninguna cita que la nombra nombra el condado ${sinCita.join(", ")} (fuera de lo que dice de otras sedes).`);
        serves = null;
      }
    }
    if (sede.street && !enSuTramo(sede.street)) problemas.push("la dirección no aparece en las citas tras el nombre de la sede");
    if (sede.cityStateZip) {
      const zip = zipDe(sede.cityStateZip);
      if (zip === null) problemas.push("la ciudad no trae código postal que comprobar");
      else if (!enSuTramo(zip)) problemas.push("el código postal de la ciudad no aparece en las citas tras el nombre de la sede");
    }
    return { f5: problemas.length > 0 ? fallo("F5", problemas.join("; ")) : territorio, serves };
  };

  const propuestos = new Map<string, Sede["serves"]>();
  const lista: Sede[] = [...sedes.values()].map(({ sede, citas, nombran, direcciones, dudas, notas }) => {
    const f1Base = f1(citas);
    const f1s = !f1Base.ok || nombran.length > 0 ? f1Base : fallo("F1", "ninguna cita nombra la sede");
    propuestos.set(sede.key, sede.serves);
    const { f5, serves } = comprobarSede(sede, nombran);
    const filtros = [f1s, f3([...nombran, ...direcciones]), f5, f7(dudas, notas)];
    for (const d of dudas) ctx.nota(sede.key, d);
    return { ...sede, serves, filters: filtros, status: estadoDe("sede", filtros, true) };
  });
  const porKey = new Map(lista.map((s) => [s.key, s]));
  const propuestoDe = (s: Sede) => propuestos.get(s.key) ?? s.serves;

  const aceptadas = new Map<string, { a: Asignacion; regla: ReglaSede; claves: string[]; firma: string; citas: { url: string; quote: string }[] }[]>();
  for (const { a, r, claves, nota } of reglas) {
    if (r.rule === "sin_regla") continue;
    // Se decide sin crear evidencia: solo una regla aplicada deja filas de evidencia (una rechazada las dejaría huérfanas).
    const citas = ctx.comprobar(r.citations);
    const porCondado = a.territory.kind !== "estado_unico";
    const sedesRegla = claves.map((k) => (k ? porKey.get(k) : undefined));
    const nombres = sedesRegla.filter((s): s is Sede => s !== undefined).map((s) => s.name);
    // El condado se nombra COMO condado: «Salt Lake City» no nombra a Salt Lake County.
    const aceptan = citas.filter((c) => c.found && ctx.oficial(c.url) && (!porCondado || ctx.lector.nombra(c.quote, r.fips)) && nombraAlguno(c.quote, nombres));
    const problema =
      problemaRegla(r.rule, sedesRegla, a.courtKey, porCondado ? r.fips : null, propuestoDe) ??
      (sedesRegla.some((s) => s !== undefined && s.status !== "verificado") ? "alguna sede citada no está verificada" : null) ??
      (r.rule === "unica" ? unicaSinPrueba(sedesRegla as Sede[], lista, a.courtKey, porCondado ? r.fips : null) : null) ??
      (!f1(citas).ok || !f3(aceptan).ok ? "sin dos páginas oficiales que nombren el condado y su sede" : null) ??
      (nombres.some((n) => !aceptan.some((c) => nombraAlguno(c.quote, [n]))) ? "alguna sede citada no la nombra ninguna cita aceptada" : null) ??
      (!f7(r.dudas, [nota]).ok ? "el extractor duda" : null);
    if (problema) {
      ctx.nota(a.key, `Regla de sede «${r.rule}» no aplicada: ${problema}.`);
      continue;
    }
    const unicas = [...new Set(claves as string[])];
    const previas = aceptadas.get(a.key) ?? [];
    previas.push({ a, regla: r.rule, claves: unicas, firma: `${r.rule}|${[...unicas].sort().join(",")}`, citas: aceptan.map((c) => ({ url: c.url, quote: c.quote })) });
    aceptadas.set(a.key, previas);
  }
  for (const candidatas of aceptadas.values()) {
    const primera = candidatas[0]!;
    if (new Set(candidatas.map((c) => c.firma)).size > 1) {
      ctx.nota(primera.a.key, "Reglas de sede contradictorias para la misma asignación: ninguna se aplica.");
      continue;
    }
    const ev = ctx.citar(primera.a.key, "courthouseRule", primera.citas);
    primera.a.courthouseRule = primera.regla;
    primera.a.courthouseKeys = primera.claves;
    primera.a.evidenceKeys.push(...ev.claves);
  }
  return lista;
}
