# Cerebro Contygo — flujo de expedientes SIJS y sistema de búsqueda

Este repositorio explica **cómo se arma un expediente SIJS** (custodia o tutela con hallazgos para Special Immigrant Juvenile Status)
y **cómo se buscan y verifican las fuentes oficiales** de cada estado. No contiene ningún dato de clientes.

## Qué hay aquí

| Carpeta / archivo | Qué es |
|---|---|
| `FLUJO.md` | **El flujo de trabajo (fuente de verdad).** 16 pasos con 4 puertas de control y la tabla de lecciones aprendidas por estado. Empieza por aquí. |
| `busqueda/` | El **sistema de búsqueda** (recolector «Cerebro Contygo», TypeScript): abre Brave por CDP, comprueba que la salida sea por la VPN de EE. UU., captura cada página oficial (texto + pantallazo + PDF) y guarda el **sha256** de lo capturado. |
| `busqueda/sondas/` | Scripts de usar y tirar con los que se capturan las páginas de un caso concreto (ver abajo). |
| `aprendizaje/<ESTADO>.json` | Lo **ya verificado por estado** (corte, sede, teléfonos, vías por edad y por quién pide, formularios, tasas, leyes citadas, regla de privacidad, URL de las fuentes). Estados hechos: ID, NJ, NY, WA, CA y FEDERAL (8 C.F.R. 204.11). |
| `scripts/control_privacidad.py` | Control que impide subir datos de clientes (ver «Privacidad»). |

## Cómo funciona el sistema de búsqueda

Regla de base: **cada dato de corte, ley o formulario sale de una fuente oficial capturada, con su hash.** Lo que no se puede
verificar se marca **APUESTA** en la guía del caso. No se usa NotebookLM.

1. **Navegador con VPN.** En `busqueda/`: `npm install` y luego `npm run navegador`. Abre (o reutiliza) una ventana de Brave con el
   perfil del recolector y el puerto CDP **9333**, y comprueba la IP de salida: tiene que decir **«Salida por la VPN correcta»**
   (Urban VPN conectada a Estados Unidos; desde otro país, muchos sitios oficiales bloquean o cambian el contenido).
   Una sola sesión usa esa ventana a la vez.
2. **Captura.** `npx tsx sondas/sonda-captura.ts <carpetaDestino> <url1> <url2> ...` (copiada dentro de `busqueda/`, porque importa
   `./src/navegador.js`). Para cada URL guarda `<sha256>.txt` (texto), `<sha256>.jpg` (pantallazo), `<sha256>.pdf` si era un PDF y
   `<sha256>.meta.json` (url, estado HTTP, título, enlaces a PDF). Solo acepta los dominios oficiales que se le pasan en `dominios`
   (cámbialos en el script para cada estado: leyes, cortes, condado).
3. **Enlaces y descargas.** `sonda-enlaces.ts` lista los enlaces de una página (para encontrar formularios y reglas locales);
   `sonda-bajar.ts` descarga archivos (.doc/.docx) **desde dentro de la pestaña** (`fetch` en la página), porque la petición directa
   desde Node falla por DNS a través de la VPN.
4. **Lectura.** Se lee el texto capturado y se cita **literal**; cada cita lleva su URL y el hash de la captura.
5. **Registro (paso 16 del flujo).** Lo verificado pasa a `aprendizaje/<ESTADO>.json` y las capturas a su carpeta de capturas
   (en local), **sin ningún dato del cliente**. Así el siguiente caso del mismo estado empieza con todo eso ya comprobado.

Sitios que no responden por la VPN (anotado en `FLUJO.md`): eCFR → usar govinfo.gov; ocfs.ny.gov → lo baja el usuario con su
navegador y se registra el hash. leginfo.legislature.ca.gov responde lento (~2 min por página).

## Cómo se trabaja un caso (resumen de `FLUJO.md`)

1. **Jurisdicción y vía:** condado por ciudad y ZIP → corte (primero `aprendizaje/`, luego la fuente oficial) → **puerta: quién pide
   y qué edad tiene el joven** (menor de 18 con el padre o la madre: custodia; un tercero: tutela; 18–20: la vía del estado para
   jóvenes, p. ej. WA RCW 13.90, CA Prob. Code § 1510.1) → formularios (¿trae el estado los hallazgos de USCIS? si no, orden propia).
2. **Hechos:** inventario de documentos por hash, revisar traducciones existentes, usar solo declaraciones firmadas reales →
   **puerta: preguntas al cliente** en un `.txt` (UTF-8, CRLF). **Aquí el trabajo se detiene**: el equipo llama al cliente y,
   con las respuestas, se crea el expediente. Nunca antes.
3. **Producción:** traducción **delante** del original con el certificado firmado del traductor tal cual al final; formularios
   rellenados y aplanados; anexos con portada; tachados según la regla de privacidad del estado; un PDF con portada, índice,
   marcadores y «Page N of T».
4. **Control y entrega:** generar en carpeta de prueba, revisar cada página, versión final, guía «0 - LEER PRIMERO» en español, y
   registrar lo aprendido.

## Requisitos

- Node 20+ (recolector, `busqueda/`), Brave, Urban VPN (EE. UU.).
- Python 3.12+ con `pypdf pypdfium2 pillow reportlab pdfplumber python-docx` (generación de los PDF).
- Microsoft Word (para pasar a PDF los formularios oficiales en Word por COM, en WA y NY).

## Privacidad (obligatorio)

- **Ningún dato de cliente entra al repositorio**: ni nombres, ni documentos, ni relatos, ni los generadores de cada caso.
  Los expedientes y sus generadores se quedan en la máquina de cada uno.
- Antes de cada commit: `python scripts/control_privacidad.py --todo`. Busca en lo que se va a subir los términos de
  `pii_terms.local.txt` (nombres, números de documento, teléfonos, correos y direcciones de los clientes). Ese archivo es
  **local** (está en `.gitignore`): cada uno mantiene el suyo.
- El certificado del traductor con su firma no se sube.
