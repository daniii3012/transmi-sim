# Arquitectura

Actualizada: 28 de septiembre de 2026. La aplicación es estática: los archivos de `app/dist` son sus
fuentes editables y no hay paso obligatorio de npm ni empaquetador. Three.js r186 está vendorizado
con su licencia. Cómo se simula, en palabras, está en [Cómo se simula](COMO_SE_SIMULA.md); el motor
con sus decisiones y mediciones, en [Espacio físico](ESPACIO_FISICO_20260927.md).

## Módulos

| Archivo | Responsabilidad |
|---|---|
| `app.mjs` | Interfaz: reloj, paneles, fichas de bus y estación, Parámetros, selección y ciclo de vida del worker |
| `worker.mjs` | Corre el motor fuera del hilo de interfaz: traduce la hora pedida a su día de servicio, simula por tandas de 45 ms, avisa del avance y manda arreglos compactos |
| `traffic.mjs` | El motor: red de tramos con carriles (`Guideway`) y microsimulación por carril (`Traffic`), puntos de control y llave del escenario |
| `checkpoints.mjs` | Puntos de control guardados: los publicados con la página y los que el navegador ya simuló (IndexedDB) |
| `operation.mjs` | El plan: servicios seleccionados, vagón y sentido de cada visita, salidas del día, semáforos por recorrido, parámetros |
| `signals.mjs` | Intersecciones (nodos a menos de 60 m), desfases de onda verde y fase de cada semáforo |
| `calendar.mjs` | Fechas civiles de Bogotá, festivos, tipos de día, vigencias y calendarios del GTFS |
| `passengers.mjs` | Llegadas por estación, sentido y hora desde las validaciones; descenso estimado |
| `vehicles.mjs` | Tipo, largo y capacidad por servicio |
| `station-layouts.mjs` | Proyección de los puestos de OSM sobre los recorridos |
| `travel.mjs` | Perfil distancia/velocidad (lo usan el planificador y las pruebas del plan) |
| `planner.mjs` | Planificador de viajes, independiente de la simulación |
| `map.mjs` | Render Three.js: cámara en perspectiva (2D desde arriba, 3D inclinada), calzada con carriles, andenes, buses articulados instanciados, semáforos, edificios por teselas |
| `theme.css` | Sistema visual único: radios, sombras, superficies y márgenes para todo lo que flota sobre el mapa |
| `webmcp.mjs` | Lectura opcional del estado y control del reloj; funciona sin esa API |
| `simulation.mjs` | `MetricPath` compartido y el laboratorio sintético anterior, conservado para regresión |

## Datos que carga la página

`services.json` (catálogo y red), `schedule.json` (horario GTFS por servicio), `speed_profiles.json`
(velocidad medida por trecho), `busway_geometry.json` (carriles medidos cada 5 m), `busway_lanes.json`
(carriles de OSM), `busway_signals.json`, `station_layouts.json`, `station_wagons.json`,
`demand.json` y `context.json`. Los edificios (`buildings/`) se piden por teselas solo en la vista 3D;
los puntos de control (`checkpoints/`) los genera el flujo de Pages y no se versionan.

## El motor

Proyección AEQD WGS84 con origen `(-74.136, 4.63027)`, X este, Y norte, en metros. La red de tramos
sale de los vértices que comparten los recorridos: 525 tramos dirigidos y 141 empalmes con la red
entera. Cada tramo guarda sus carriles cada 5 m, si es estación, calle o puente.

`Traffic` guarda el estado en arreglos tipados por viaje —tramo, carril, posición, velocidad, estado,
carga, vehículo— y una lista ordenada de buses por tramo y carril, de la que cada bus lee al de
adelante. Un paso de 1 s decide primero empalmes y cambios de carril, en orden fijo por número de
viaje, y después mueve a todos con el IDM y sus topes duros. Cada 15 minutos simulados guarda un
punto de control: retroceder restaura el anterior y vuelve a simular. Un punto de control se exporta
en binario compacto (0,43 MB con la red entera) y se restaura en otro motor del mismo escenario con
el mismo resultado; la llave del escenario resume todo lo que el motor usa del día.

Para la página, `frame()` devuelve arreglos compactos —viaje, servicio, abscisa, desplazamiento
lateral, largo, estado, velocidad, carga— que viajan transferidos, sin copiar. La ficha del bus
seleccionado pide su detalle aparte: carril, qué lo detiene, de dónde salió su vehículo.

## Tiempos de espera

Llegar a una hora exige simular desde las 03:00. El worker lo hace por tandas cortas para seguir
atendiendo a la página, manda cada medio segundo cómo va el día para que el mapa lo muestre ponerse
al día, y antes de simular busca el punto de control guardado más cercano: el publicado con la página
para el escenario inicial, o el que este navegador guardó de una visita anterior. Las 18:05 de un
lunes abren en medio segundo en vez de unos 25.

## Render

Una sola cámara en perspectiva: desde arriba es el mapa 2D; inclinada, la vista 3D. La calzada, los
andenes y las cubiertas son mallas fijas; los buses, cuerpos instanciados —uno, dos o tres según
sean padrón, articulado o biarticulado— con fuelles entre cuerpos, así que miles de buses son pocas
llamadas a la GPU. El suelo se dibuja sin escribir profundidad para que nada lo tape. Los edificios
llegan por teselas de 1 km cerca de la cámara y se sueltan las lejanas.

La interfaz pide un estado hasta 20 veces por segundo y dibuja al ritmo de `requestAnimationFrame`;
entre respuestas interpola a los buses sobre su trazado. Un cambio de parámetros cancela el worker
anterior y sus respuestas se distinguen por generación.

## Publicación

`.github/workflows/pages.yml` se dispara a mano. Corre las pruebas, comprueba que los datos estén
completos y coherentes —copias curadas idénticas, una sola versión `?v=`, rutas relativas—, genera
los puntos de control del escenario inicial para los próximos ocho días y
publica solo `app/dist`.
