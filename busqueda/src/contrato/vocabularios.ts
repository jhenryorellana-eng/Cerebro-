/** Contrato v2 del cerebro jurisdiccional (spec §5.2). Ampliar un vocabulario es un cambio de contrato. */
export const CONTRATO_VERSION = "2.1.0";
export const VERSION_ESQUEMA_PAQUETE = "2.0";

export const UNIDADES_ASIGNACION = ["condado", "pueblo", "estado_unico"] as const;
export const CATEGORIAS_VIA = [
  "custodia",
  "tutela",
  "dependencia",
  "hallazgos_independientes",
  "adopcion",
  "delincuencia",
  "otra",
] as const;
export const BASES_EDAD = ["ley_sijs", "jurisdiccion_via", "mayoria_edad", "definicion_general"] as const;
export const CONDICIONES = [
  "padre_fallecido",
  "padre_ausente_o_abandono",
  "maltrato_o_negligencia",
  "sin_orden_custodia_previa",
  "consentimiento_menor_18_o_mas",
  "residencia_minima_meses",
  "soltero",
  "bajo_custodia_estatal",
] as const;
export const REGLAS_SEDE = ["unica", "por_pueblo", "por_zip", "a_eleccion", "sin_regla"] as const;
/** Qué territorio atiende una sede, para aplicar las reglas por ZIP o por pueblo dentro de un condado. */
export const TERRITORIOS_SEDE = ["condado", "pueblo", "zip"] as const;
export const PROPOSITOS_FORMULARIO = [
  "peticion",
  "mocion_hallazgos_sijs",
  "orden_propuesta",
  "portada",
  "exencion_tasas",
  "notificacion",
  "declaracion",
  "otro",
] as const;
export const FORMATOS_FORMULARIO = ["acroform", "xfa", "plano", "escaneado", "sin_formulario_oficial"] as const;
export const TIPOS_REQUISITO = [
  "tasa",
  "exencion_tasa",
  "notificacion_padres",
  "residencia_minima",
  "interprete",
  "copias",
  "presentacion_electronica",
] as const;
export const ESTADOS_DATO = ["verificado", "a_revisar", "sin_dato"] as const;
export const ESTADOS_PUBLICACION = ["candidato", "autoaprobado", "aprobado", "rechazado", "publicado", "retirado"] as const;
export const MOTIVOS_EXCEPCION = [
  "estado_no_publicado",
  "direccion_no_geocodificable",
  "condado_sin_asignacion",
  "requiere_nivel_pueblo",
  "falta_dato_caso",
  "ninguna_via_aplica",
  "varias_vias_sin_preferencia",
  "plazo_vencido",
  "sede_sin_regla",
  "caso_familiar_abierto",
] as const;
export const FILTROS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7"] as const;
export const NIVELES_FUENTE = ["A", "B"] as const;

export type UnidadAsignacion = (typeof UNIDADES_ASIGNACION)[number];
export type CategoriaVia = (typeof CATEGORIAS_VIA)[number];
export type BaseEdad = (typeof BASES_EDAD)[number];
export type CodigoCondicion = (typeof CONDICIONES)[number];
export type ReglaSede = (typeof REGLAS_SEDE)[number];
export type TerritorioSede = (typeof TERRITORIOS_SEDE)[number];
export type PropositoFormulario = (typeof PROPOSITOS_FORMULARIO)[number];
export type FormatoFormulario = (typeof FORMATOS_FORMULARIO)[number];
export type TipoRequisito = (typeof TIPOS_REQUISITO)[number];
export type EstadoDato = (typeof ESTADOS_DATO)[number];
export type EstadoPublicacion = (typeof ESTADOS_PUBLICACION)[number];
export type MotivoExcepcion = (typeof MOTIVOS_EXCEPCION)[number];
export type Filtro = (typeof FILTROS)[number];
export type NivelFuente = (typeof NIVELES_FUENTE)[number];
