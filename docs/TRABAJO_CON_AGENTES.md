# Trabajo con agentes ligeros

## Propósito

El 9 de septiembre de 2026 se autorizó usar agentes ligeros para aprovechar mejor las sesiones. Los modelos ligeros pueden encargarse de tareas repetibles y acotadas que dejen resultados revisables en archivos. La delegación sirve para acelerar la recolección y normalización, pero no sustituye la decisión técnica principal ni la revisión de calidad. Primera aplicación: un agente gpt-5.6-luna preparó una ficha de Mandalay y borradores de planificación; el principal los revisó e integró.

## Tareas adecuadas para delegar

- investigar una estación, corredor, parada o servicio a partir de fuentes oficiales;
- preparar una ficha con atributos publicados, fecha, URL, confianza y lagunas;
- extraer tablas pequeñas de páginas, JSON o GeoJSON públicos;
- normalizar nombres, identificadores, sentidos y fechas en un archivo de investigación;
- comparar dos fuentes ya delimitadas y señalar discrepancias;
- revisar documentación por campos faltantes, enlaces rotos o afirmaciones sin fuente;
- proponer casos de prueba o listas de verificación para una pieza ya diseñada.

Cada paquete debe tener una pregunta concreta, una estación o conjunto pequeño claramente delimitado y un formato de salida definido antes de iniciarse. Preferencia actual: gpt-5.6-luna con razonamiento medio y contexto mínimo para estas tareas; el principal resolverá ambigüedades o trabajo que exceda ese contrato.

## Trabajo que permanece con el agente principal

La arquitectura de IA, física, control del vehículo, integración con el grafo y escenas, decisiones de alcance, resolución de contradicciones importantes y revisión final permanecen con el agente principal. También corresponde al principal decidir si un dato es suficientemente confiable para entrar al juego.

## Paquetes para las próximas etapas

| Paquete | Responsable previsto | Entrega | Estado y dependencia |
|---|---|---|---|
| Ficha inicial de Mandalay | Agente ligero + revisión principal | ESTACION_MANDALAY.md, datos publicados y lagunas | Entregada y revisada; aún faltan cotas y plano actual. |
| Estación Av. Américas–Av. Boyacá | Agente ligero + revisión principal | BOYACA_NIVELES_REFERENCIAS.md, atributos y fuentes con límites | Entregada y revisada; cotas de niveles pendientes. La ingeniería del cruce y rampas corresponde al principal. |
| Estación Marsella | Agente ligero | Ficha equivalente, con medidas publicadas y dudas | Pendiente; reutilizar esquema de Mandalay y cartografía existente. |
| Auditoría de geografía para 2D | Agente ligero + revisión principal | Conteos, partes, IDs y distancias de estaciones | Completada el 10 de septiembre; principal integró selección conservadora. No aceptar la inferencia de que tipo_tra=2 indica proyección sin su dominio. |
| Auditoría de candidatos de rutas del piloto | Agente ligero | Tabla de IDs, sentidos y evidencia de paradas, sin habilitarlos | Pendiente; empezar por los candidatos ya descargados, sin repetir el catálogo completo. |
| Revisión de procedencia de módulos urbanos | Agente ligero | Lista de fuentes, licencias declaradas y campos ausentes | Pendiente; cuando exista la primera biblioteca de módulos. |

Son paquetes preparados para asignar en sesiones activas, no agentes ejecutándose ni tareas programadas. Abrir cada uno cuando desbloquee trabajo útil del principal y exista capacidad; no ejecutar toda la lista simultáneamente.

## Contrato de un paquete

Un encargo debe incluir:

1. objetivo y límites geográficos o funcionales;
2. archivos que puede leer y archivo(s) que puede escribir;
3. fuentes permitidas y fecha de consulta;
4. campos requeridos y distinción entre publicado, medido, inferido y pendiente;
5. prohibiciones explícitas, como no modificar scripts, no incorporar assets externos y no afirmar vigencia sin fecha;
6. criterio de terminado y forma de reportar lagunas.

El resultado se entrega en uno o pocos archivos pequeños dentro de `docs/` o `data/research/`, con URLs, fechas, confianza y procedencia. Las descargas temporales van en `work/` y no se convierten automáticamente en assets del juego.

## Coordinación y revisión

Antes de delegar, comprobar si ya existe una ficha o investigación para evitar duplicados. No enviar el contexto entero del proyecto: compartir solo el contrato, los archivos relevantes y las decisiones necesarias para resolverlo. No abrir paquetes adicionales por inercia ni promover delegación masiva.

El agente principal revisa cada resultado, comprueba enlaces o muestras representativas, integra solo lo que sea compatible con el plan y deja constancia de conflictos. Una investigación incompleta debe terminar como una lista de lagunas, no como una estimación presentada como hecho.

## No automatización implícita

Esta guía describe colaboración durante sesiones activas. La autorización permite continuar con otros paquetes acotados del proyecto sin volver a pedir permiso por cada uno. No crea tareas automáticas, monitores ni ejecución cuando la sesión no esté activa.

## Cuota y expectativas

La delegación puede reducir trabajo manual en algunas tareas, pero no se promete un porcentaje de ahorro de una cuota de cinco horas. La medida de éxito es la calidad, trazabilidad y utilidad del archivo entregado, además del tiempo total observado en el caso concreto.
