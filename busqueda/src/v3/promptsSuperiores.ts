import * as V from "../contrato/vocabularios.js";
import type { Captura } from "../navegador.js";
import { bloqueTextos, MAX_TEXTO_POR_PAGINA, MAX_TEXTO_TOTAL, nucleoCondado } from "../tareas/extraer.js";
import { lista, REGLAS_CITA } from "./prompts.js";

/** Lo que los prompts de los niveles 3-6 reciben del paquete de los niveles 0-2: claves de paquete, no inventadas. */
export interface CortePrompt {
  key: string;
  canonicalName: string;
}
export interface ViaPrompt {
  key: string;
  officialName: string;
  category: string;
  courtTypeKey: string;
}
export interface TipoPrompt {
  key: string;
  officialName: string;
}
export interface CondadoLote {
  fips: string;
  name: string;
  courtKey: string | null;
  courtName: string | null;
}

const listaCortes = (cortes: CortePrompt[]) => cortes.map((c) => `${c.key} = «${c.canonicalName}»`).join("\n");
const listaVias = (vias: ViaPrompt[]) => vias.map((v) => `${v.key} = «${v.officialName}» (${v.category}; tipo ${v.courtTypeKey})`).join("\n");
const listaTipos = (tipos: TipoPrompt[]) => tipos.map((t) => `${t.key} = «${t.officialName}»`).join("\n");

export function promptSedes(estado: string, nombre: string, capturas: Captura[], lote: CondadoLote[], cortes: CortePrompt[]): string {
  return [
    `TAREA — Sedes (edificios) de las cortes de ${nombre} (${estado}) y regla de sede de cada condado de este lote.`,
    "Cortes (courtKey tiene que ser EXACTAMENTE una de estas claves):",
    listaCortes(cortes),
    `Condados del lote (FIPS — nombre → corte asignada), ${lote.length}:`,
    lote.map((c) => `${c.fips} — ${c.name} → ${c.courtKey ? `${c.courtKey} «${c.courtName ?? ""}»` : "sin corte asignada"}`).join("\n"),
    `courthouses: cada sede (edificio) de esas cortes que aparezca en los textos: key (minúsculas con guiones, única en tu respuesta), courtKey, name (el nombre del edificio o de la sede COPIADO LETRA POR LETRA de los textos: no lo compongas uniendo el edificio y la oficina ni le añadas el condado), street (calle y número) o null, cityStateZip («Ciudad, ST 12345») o null, serves = el territorio que atiende según los textos: kind uno de ${lista(V.TERRITORIOS_SEDE)} con codes (FIPS de 5 dígitos para "condado", códigos postales para "zip"), o null si los textos no lo dicen. citations: líneas LITERALES que den el nombre y la dirección.`,
    `rules: una por cada FIPS del lote que tenga corte asignada (un condado sin corte asignada no lleva regla): rule, uno de ${lista(V.REGLAS_SEDE)}: "unica" (el condado tiene una sola sede de su corte), "por_zip" o "por_pueblo" (la sede depende del código postal o del pueblo), "a_eleccion" (quien presenta elige entre varias), "sin_regla" (los textos no lo dicen; entonces courthouseKeys y citations van vacíos). courthouseKeys = las key de courthouses que aplican. citations: líneas LITERALES que nombren el condado y su sede; si dos páginas distintas lo confirman, cita las dos.`,
    ...REGLAS_CITA,
    "",
    bloqueTextos(capturas, MAX_TEXTO_POR_PAGINA, MAX_TEXTO_TOTAL, lote.map((c) => nucleoCondado(c.name))),
  ].join("\n");
}

export function promptFormularios(estado: string, nombre: string, capturas: Captura[], vias: ViaPrompt[], tipos: TipoPrompt[]): string {
  return [
    `TAREA — Formularios oficiales de ${nombre} (${estado}) para las vías con las que se piden los hallazgos SIJS.`,
    "Vías (routeKeys tienen que ser EXACTAMENTE estas claves):",
    listaVias(vias),
    "Tipos de corte (courtTypeKey EXACTO):",
    listaTipos(tipos),
    `forms: uno por cada formulario oficial cuyo PDF esté entre las páginas de abajo. url = la url EXACTA de esa página PDF (la de su etiqueta <<<PÁGINA url=...>>>). purpose, uno de ${lista(V.PROPOSITOS_FORMULARIO)}. number: el número del formulario tal como aparece (p. ej. «1000JU») o null. title: el título literal. versionLabel: la versión o revisión (p. ej. «Rev. 7/26») o null. routeKeys: las vías para las que sirve. courtTypeKey. countyFips: el FIPS si el formulario es de un solo condado, si no null.`,
    "citations: al menos una cita LITERAL del propio PDF (su título o su número), con url = la del PDF. Una página que solo enlaza al formulario no basta.",
    "Si una vía no tiene formulario oficial entre los textos, no lo inventes: dilo en notes.",
    ...REGLAS_CITA,
    "",
    bloqueTextos(capturas),
  ].join("\n");
}

export function promptRequisitos(estado: string, nombre: string, capturas: Captura[], vias: ViaPrompt[], tipos: TipoPrompt[]): string {
  return [
    `TAREA — Requisitos para presentar en ${nombre} (${estado}) las vías con las que se piden los hallazgos SIJS.`,
    "Vías (routeKey EXACTA, o null):",
    listaVias(vias),
    "Tipos de corte (courtTypeKey EXACTO):",
    listaTipos(tipos),
    `requirements: kind, uno de ${lista(V.TIPOS_REQUISITO)}; text: el requisito en una frase, en español; amountUsd: el importe en dólares si es una tasa (0 si los textos dicen que no hay tasa), si no null; routeKey: la vía a la que se aplica, o null si vale para todas las de ese tipo de corte; courtTypeKey; citations LITERALES (si dos páginas distintas lo dicen, cita las dos).`,
    ...REGLAS_CITA,
    "",
    bloqueTextos(capturas),
  ].join("\n");
}

export function promptEncabezados(estado: string, nombre: string, capturas: Captura[], cortes: CortePrompt[], vias: ViaPrompt[]): string {
  return [
    `TAREA — Encabezado (caption) de las cortes de ${nombre} (${estado}) y título del caso de cada vía, tal como aparecen en formularios u órdenes oficiales.`,
    "Cortes (courtKey EXACTO):",
    listaCortes(cortes),
    "Vías (routeKey EXACTO):",
    listaVias(vias),
    "captions: para cada corte cuyo encabezado aparezca en los textos: courtKey; lines = las líneas del encabezado tal como aparecen, con {county} donde va el nombre del condado, {state} el del estado, {minor} el del menor y {petitioner} el de quien presenta; citations: la línea LITERAL del texto de donde sale, con los nombres reales que aparezcan. No uses otros huecos que esos cuatro.",
    "caseStyles: para cada vía cuyo título del caso aparezca: routeKey, caseStyle con los mismos huecos (p. ej. «In the Matter of {minor}, a minor») y su cita LITERAL.",
    ...REGLAS_CITA,
    "",
    bloqueTextos(capturas),
  ].join("\n");
}
