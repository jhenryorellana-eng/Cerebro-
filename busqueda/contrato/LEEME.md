# Contrato v2 del cerebro jurisdiccional

Lo que la fábrica (este repo) envía y lo que el resolvedor de x-legal devuelve. Spec:
`docs/specs/2026-09-28-cerebro-jurisdiccional-v3-design.md` §5.

- **Fuente de verdad:** los esquemas Zod de `src/contrato/` (`paquete.ts`, `resolucion.ts`,
  `vocabularios.ts`) y el validador semántico `validar.ts`.
- **Para x-legal:** copia **`src/contrato/*.ts`** (x-legal ya usa Zod 4) y ejecuta en su entrada el
  esquema **y** `validarPaquete`. El JSON Schema solo no basta: las referencias entre elementos, los
  filtros por tipo, la evidencia A del campo clave, el prefijo del estado y la coherencia de
  territorios viven en el validador, y ningún JSON Schema los expresa.
- **`contrato/esquemas/*.schema.json`** (generados con `npm run contrato:esquemas`; un test falla si
  quedan desfasados) documentan la forma y sirven a otros lenguajes. Llevan en su `$id` la versión
  del contrato. Expresan la estrictez, los vocabularios, los `pattern` y la regla de la resolución
  confirmada.
- **Fixtures:** `contrato/fixtures/paquetes` y `resoluciones` son válidas; `contrato/fixtures/invalidos`
  trae un caso por defecto conocido, con el resultado esperado en `esperados.json` (`esquema` o el
  código del validador). El kit de x-legal prueba **que acepta las válidas y rechaza las inválidas**
  con esos mismos archivos.
- **Las fixtures son datos de prueba, no fuentes.** Sus citas existen en capturas reales, pero los
  nombres de corte de NE y la sede de UT son ejemplos para ejercitar el contrato.
- **Cambiar un vocabulario o un campo es un cambio de contrato:** sube `CONTRATO_VERSION`, regenera
  los esquemas y actualiza las fixtures en el mismo commit.
