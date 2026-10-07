# Flujo de trabajo: expediente SIJS

Versión local y fuente de verdad del flujo. Toda sesión de Claude que trabaje un caso SIJS lo sigue paso a paso, y al terminar lo actualiza con lo aprendido (paso 16). Aprobado el 30-09-2026 con el caso de Idaho y mejorado con New Jersey, Washington y Nueva York.

## Cómo se trabaja

- **Un caso por terminal**, abierta siempre en `C:\Users\PepitoLee\Downloads\Contygoo\x-legal-main\x-legal-main`, para que cargue la memoria.
- **La ventana de Brave con la VPN** (CDP 9333) la usa una sola terminal a la vez. Antes de capturar: `npm run navegador` en `C:\Users\PepitoLee\Downloads\Cerebro Contygo` tiene que decir «Salida por la VPN correcta».
- **Datos del cliente:** solo en su carpeta y en la carpeta temporal de la sesión. Nunca en memoria, docs, artifacts ni en `_aprendizaje`.
- **Recursos compartidos** en `C:\Users\PepitoLee\Downloads\Contygoo-expedientes\`:
  - `_motor-referencia\`: generadores de casos anteriores y formularios oficiales ya bajados.
  - `_aprendizaje\<ESTADO>\`: lo ya verificado por estado (JSON y capturas con hash).
  - Certificado del traductor: `C:\Users\PepitoLee\Downloads\certificado_Traduccion.png`.

## Reglas que valen en todo el flujo

1. Los datos del cliente no salen del equipo. A internet solo van la ciudad y el ZIP.
2. Cada dato de corte, ley o formulario sale de una fuente oficial capturada con Brave y la VPN, con su hash. Lo que no se pudo verificar se marca **APUESTA**.
3. No se firma por nadie ni se altera un documento firmado. El certificado del traductor va tal cual, con su propia fecha.
4. Cada hecho que alguien jura tiene su fuente: un documento o una respuesta del cliente. Si no la tiene, se deja un hueco para que lo escriba a mano.
5. Nada se borra. La versión anterior se mueve a `_versiones-anteriores`.
6. Cada decisión queda escrita con su porqué en la guía que acompaña al expediente.
7. Todo en español con el usuario; los escritos para la corte, en inglés.

## Los pasos

**A · Jurisdicción y vía**

1. **Condado.** Se saca de la ciudad y el ZIP.
2. **Corte.**
   - Primero se mira `_aprendizaje\<ESTADO>\` y el cerebro (`Cerebro Contygo\salida\<ST>` y `salida-v3\<ST>`).
   - Después se confirma en la fuente oficial: corte, división, sede, teléfonos y encabezado del escrito.
   - Los formularios en Word se bajan desde dentro de la pestaña de Brave.
3. **Puerta: quién pide y qué edad tiene el joven.**
   - Si es menor de 18 y pide el padre o la madre con quien vive: custodia, con la herramienta propia del estado.
   - Si pide un tercero: tutela.
   - Si tiene entre 18 y 20: la vía del estado para jóvenes (en WA, la Vulnerable Youth Guardianship, RCW 13.90). Hay que comprobar que exista.
   - Se calcula siempre la **fecha límite**: los 21 años según el acta, no según la ficha.
4. **Formularios.**
   - Primero se busca si el estado tiene un formulario SIJS propio (NJ: CN 13321).
   - Se lee qué obliga a jurar cada formulario. Si le haría jurar al cliente algo falso, se sustituye por un escrito propio.
   - Se comprueba si la orden o las conclusiones oficiales traen **los dos hallazgos de USCIS**: que la reunificación no es viable y que volver al país no le conviene. Si no los traen, se añade una orden propuesta propia.
   - Si el estado lo exige, se hace un expediente por cada menor.

**B · Hechos**

5. **Documentos.**
   - Inventario y quitar duplicados por hash; los escaneos se pasan a imagen y se leen todos.
   - **Se revisan las traducciones que ya existan contra su original.** En WA las dos estaban mal.
   - Las cartas y declaraciones largas del equipo son borradores. Solo se usan las declaraciones **firmadas o notariadas reales**, porque los borradores añaden hechos que nadie juró.
6. **Puerta: preguntas al cliente. Aquí el trabajo SE DETIENE.**
   - No se redacta ni se genera ningún expediente antes de tener las respuestas. El equipo llama al cliente con las preguntas y, con esos datos, se crea el expediente final.
   - Se avisa en el chat en ese momento: dónde está el archivo y qué se pregunta. Luego se espera.
   - Las contradicciones y los huecos se convierten en preguntas cortas.
   - **Siempre en documento:** `expediente-<caso>\1 - Preguntas para la cliente (WhatsApp).txt` (UTF-8, saltos CRLF), y se abre en el Bloc de notas.
   - Se incluye la fecha límite si existe.
   - Ningún hecho se jura sin fuente.
7. **Decisiones.** La vía, la competencia, los hallazgos con la ley del estado citada literal, el contacto con el otro padre, qué documentos no van y por qué.
8. **Redacción.**
   - Petición o declaración del que presenta, y orden propuesta con los hechos que sostienen cada hallazgo.
   - Traducción de cortesía al español de todo lo que firme alguien que no lee inglés.
   - Un menor no firma «of full age».
   - Un niño pequeño no firma una declaración escrita como si fuera adulto.

**C · Producción**

9. **Puerta: traducciones.**
   - Primero va la traducción y después el original.
   - Al final de cada traducción, la imagen del certificado del traductor tal cual.
   - Se traduce todo: sellos, firmas y notas a mano entre corchetes.
   - El traductor revisa cada una antes de presentar.
10. **Formularios.**
    - PDF con campos: se rellenan y luego se aplanan, escribiendo el valor sobre la página, porque al unir varios PDF los campos se pierden.
    - PDF sin campos: se escribe encima por coordenadas.
    - Word (WA): con python-docx, o con Word por COM, abriendo el original en solo lectura.
    - Cada página se renderiza y se revisa.
11. **Anexos.**
    - Van todos los documentos del cliente, en orden lógico, cada uno con su portada (contenido y número de páginas).
    - **Se tacha según la regla de privacidad del estado** (ID: Seguro Social; NJ: R. 1:38-7; WA: GR 31(e)). La página se convierte en imagen para que el número no quede debajo.
    - Un documento solo se excluye con la razón escrita en la guía.
12. **Ensamblaje.** Un PDF por expediente: portada e índice con números de página, partes, marcadores, «Page N of T» en cada página y todo en tamaño carta.
    - Se aplica la **regla de formato del estado**, capturada (WA: GR 14(a), márgenes de 1", 3" arriba en la primera página de cada escrito y nada de color, ni en los anexos).

**D · Control y entrega**

13. **Puerta: prueba.**
    - Se genera primero en una carpeta de prueba.
    - Se renderiza todo y se revisan las hojas de miniaturas, ampliando tachaduras, casillas y textos largos.
    - Se busca en el texto que no queden marcadores sin rellenar (BLANK) ni números de Seguro Social.
    - Se corrige y se vuelve a generar hasta que todo esté bien.
14. **Versión final** en la carpeta del cliente; la anterior pasa a `_versiones-anteriores`.
15. **Guía** «0 - LEER PRIMERO», en español:
    - qué hay en la carpeta;
    - qué formularios van y por qué no los demás;
    - qué documentos van, cuáles se tacharon y cuáles se excluyeron;
    - qué completa a mano cada persona, quién firma qué y en qué orden;
    - dónde y cómo se presenta, la notificación y los plazos, y el paso a USCIS.
16. **Registrar lo aprendido.** Así el cerebro aprende.
    - En `_aprendizaje\<ESTADO>\<ESTADO>.json` se añade o corrige: el condado y su corte, la sede, los teléfonos, las vías por edad y por quién pide, los formularios, la tasa, la ley citada, la regla de privacidad y las URL de las fuentes. **Sin datos del cliente.**
    - Las capturas oficiales del caso se copian a `_aprendizaje\<ESTADO>\capturas\`.
    - Si el caso enseñó algo nuevo, se añade una fila a «Lecciones», abajo.
    - Al usuario se le dice en una línea qué aprendió el cerebro.

## Lecciones

| Caso | Lección | Paso |
|---|---|---|
| Idaho (custodia, madre) | Saber quién pide antes de elegir la vía; la tutela no es para un padre o una madre | 3 |
| Idaho | Un expediente único con todos los formularios que aplican y todos los documentos; traducción delante y certificado tal cual | 9-12 |
| Idaho | Un hecho sin fuente se deja en blanco para que lo escriba el cliente | 6 |
| New Jersey (dos hijos) | Buscar primero si el estado tiene un formulario SIJS propio; un expediente por cada hijo si la norma lo pide | 4 |
| New Jersey | Si no hay dirección del otro padre, preparar la búsqueda diligente oficial | 6 |
| New Jersey | Tachar según la regla de privacidad del estado; un menor no firma «of full age» | 8, 11 |
| Washington (joven de 20) | Con 18 a 20 años presenta el propio joven; fecha límite según el acta (14-01, no 15-01) | 3 |
| Washington | El formulario oficial de conclusiones no traía los hallazgos de USCIS: orden propia | 4 |
| Washington | Las traducciones certificadas que ya existían tenían errores: revisarlas siempre | 5 |
| Washington | Los affidavits del equipo añadían hechos no jurados: usar solo las declaraciones notariadas reales | 5 |
| Washington | Las preguntas al cliente siempre en documento | 6 |
| New York (tutela, madre, joven de 18) | Con 18 a 20 años en NY la madre puede pedir ser tutora (FCA 661(a), formulario 6-1) con el consentimiento jurado del joven (6-3); la UCCJEA no se aplica a mayores de 18, así que una llegada reciente no impide presentar | 3 |
| New York | Comprobar la versión de cada formulario: la ficha web enlazaba la versión de otro condado (6-2 de Nassau) y el Word del 6-5 era de 2010; usar la vigente | 4, 10 |
| New York | Las declaraciones notariales reales también pueden traer hechos redactados por el equipo que no son ciertos: contrastarlas con las respuestas del cliente y corregirlas en la declaración del que presenta | 5 |
| New York | Identificar cada documento por hash y contenido, no por nombre: el «contrato de arrendamiento» era la carta de la madre | 5 |
| New York | Preguntar desde el principio las direcciones de 28 años con mes y año (OCFS-3909) y el teléfono de EE. UU. | 6 |
| New York | ocfs.ny.gov y otros sitios de la red del estado no responden por la VPN: el usuario baja el archivo con su navegador y se registra el hash | 2, 4 |
| New York | Los Word con campos heredados (OCFS-3909) se rellenan por COM; en NY las declaraciones se firman sin notario (CPLR 2106) y cada anexo traducido necesita la afirmación del traductor (CPLR 2101(b)) | 8, 10 |
| Washington | Capturar la regla de formato del estado antes de ensamblar: la GR 14(a) prohíbe el color también en los anexos, así que las copias de la cliente y el certificado del traductor van en escala de grises (los originales a color, a la audiencia) | 2, 12 |
| Washington | Tachar también el número de cuenta de las facturas de servicios y los códigos QR o de barras que lo llevan; y en la tarjeta de identidad, la línea DD y los códigos del reverso | 11 |
| Washington | Un escaneo al revés se gira para leerlo (no altera el documento); se dice en la portada del anexo | 11 |
| Washington | Al rellenar un Word oficial pueden aparecer una página en blanco al final y un «Page 4 of 4» falso: quitar los párrafos vacíos del final y revisar el pie | 10 |
| Washington | Si el testigo es pariente del que presenta (la «vecina» era la cuñada), decirlo en la portada del anexo y en la declaración | 7 |
| Washington | No marcar «abuse» si la violencia fue contra la madre y no contra el joven; no marcar «otra base» si las causas ya están en el formulario | 7 |
| Federal | eCFR no responde por la VPN: 8 C.F.R. 204.11 se captura en govinfo.gov (edición anual del CFR); lo verificado vale para todos los estados en `_aprendizaje\FEDERAL\` | 2, 4 |
| Todos | Correr `control.py` (texto sin marcadores ni números prohibidos, sin color, márgenes) además de mirar las miniaturas | 13 |
| California (madre, hija a 1 mes de los 18) | Si el joven cumple 18 en semanas, no empezar una custodia que no llegará a tiempo: preparar la vía de 18-20 (CA: Prob. Code 1510.1, la madre puede ser tutora) y presentar desde el día del cumpleaños; antes, un padre no puede ser tutor (Prob. 1514(b)(2)) | 3 |
| California | El formulario oficial de hallazgos (FL-357/GC-224/JV-357) ya trae los tres hallazgos de USCIS: no hace falta orden propia. Comprobarlo siempre antes de redactar una | 4 |
| California | Buscar los formularios y reglas LOCALES del condado (Stanislaus: GR001, GR005, declaración confidencial de la regla 7.27, copias al investigador): sin ellos la corte no tramita | 2, 4 |
| California | Los formularios del Judicial Council son XFA-híbridos: rellenar por índice de widget con un mapa visual (mapa.py) y aplanar; los escritos propios van en pleading paper (reglas 2.108 y 2.111) | 10 |
| California | Las declaraciones de testigos redactadas por el equipo, sin fecha y sin la fórmula del CCP 2015.5, son débiles aunque el testigo lea inglés: adjuntarlas como apoyo y sostener el caso en la petición verificada y la declaración del joven | 5 |
| California | Contrastar cada respuesta con los documentos: el contrato de alquiler (2017) no casaba con «unos 6 años» y otra dirección en 2018-2019, y la fecha de llegada de la madre era distinta a la de la hija. No afirmar la fecha dudosa, decirlo en la guía y que el cliente lo aclare antes de firmar | 6, 7 |
| California | Los formularios locales sin campos (GR001, GR005) se rellenan escribiendo junto a sus etiquetas (coordenadas sacadas con pdfplumber) y rodeando las opciones; solo lo que tiene fuente, el resto a mano | 10 |
| California | Si la clienta tiene Medi-Cal, preparar la exención de tasas (FW-001/FW-002) | 15 |
| California | Error: se generó el expediente sin esperar las respuestas. Regla del usuario: primero las preguntas para que el equipo llame al cliente; con esa data, el expediente final. Nunca antes | 6 |
