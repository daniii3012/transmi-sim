# Validación del segundo hito — 11 sep. 2026

Base: `f6fa207e3830ef75979640caf8ab9af4c64feac8`, subida y comprobada antes de esta revisión. La aplicación continúa local, con el lanzador LAN ya incluido; no se desplegó un sitio público.

## Resultado

- Los nueve portales usan su geometría OSM disponible. Se conservan los tres portales detallados previamente y Banderas, Ricaurte y Jiménez. No se dibuja la fila artificial continua de vagones en estos doce sitios.
- El inventario contiene 103 elementos de parada/plataforma (incluye puntos), 32 áreas y 246 líneas internas. Portal Norte conserva puntos y área sin inventar una plataforma. Hay 191 visitas compatibles de 201; diez mantienen la posición de referencia del servicio.
- Se incorporan 450 señales con evidencia directa, de las cuales 449 se asocian a recorridos compatibles. Son 112 variantes y 3.936 asociaciones. Se verificaron los hashes de 639 XML y pertenencia de cada nodo a su vía. La orientación usa los nodos vecinos reales de la vía completa.
- Ciclos estimados de 90 s, frenado métrico, espera roja/amarilla, arranque en verde, opción de desactivar y estado del bus. No se simula coordinación real ni separación longitudinal microscópica entre buses ante una luz.
- Planificador independiente del escenario: origen, destino, fecha, hora, servicios/sentidos y hasta dos transbordos. Se destacan solo los tramos del viaje; los tiempos son nominales, sin predicción de aforo/fases.
- Etiquetas de estaciones con nodos persistentes y posición actualizada con la cámara en cada cuadro. El cálculo de visibilidad/colisiones se mantiene separado.
- Los 23 registros pendientes siguen pendientes. No se modificaron ni completaron sus rutas por inferencia.

## Pruebas automáticas

`node --test app/tests/*.test.mjs`: **49/49 aprobadas**.

`../../work/venv/bin/python -m unittest discover -s tests`: **3/3 aprobadas**.

Se conserva la batería anterior y se añaden siete pruebas de planificación y siete de señales/geometría: viajes dirigidos, transbordos, paradas expresas, calendarios y medianoche; evidencia y sentido de semáforos, vueltas sin duplicar vértices, inversión tiempo/distancia, frenado exacto, fases y esperas, desactivación y reproducción al retroceder. Las plataformas conservan orden de visita y no crean conexiones.

Se verificaron sintaxis Python, paridad entre JSON curado y copia web, SHA-256 de las fuentes semafóricas, datos geométricos y `git diff --check`.

## Rendimiento del motor

Benchmarks Node del escenario completo, con los nueve portales y semáforos activados. Muestreo cada minuto entre 04:00 y 24:00, comprobando posición/velocidad finitas y ocupación dentro de capacidad. Cada prueba incluye cálculo de día previo para servicios que terminan después de medianoche.

| Medida | Referencia 4/8 min, demanda 1× | Estrés 2/3 min, demanda 3× |
|---|---:|---:|
| Preparación | 8,85 s | 17,28 s |
| Muestreo medio | 0,86 ms | 4,60 ms |
| Máximo de buses muestreado | 1.078 | 3.218 |
| Máximo exacto por eventos | 1.088 | 3.221 |
| Máximo esperando atención, toda la red | 72 | 1.455 |
| Máximo esperando semáforo, toda la red | 112 | 217 |
| Heap Node al medir | 505 MB | 1.042 MB |

No son mediciones de FPS ni requisitos mínimos certificados. El estrés produce congestión y requiere más memoria; el motor no elimina buses para ocultarla. Perfiles de velocidad compartidos evitan calcular cada viaje cuadro a cuadro. Resultados en `data/processed/operation_benchmark*.json`.

## Navegador

Revisión mediante controles reales del navegador integrado:

- Portal Norte, 80, Eldorado, Tunal, Usme y 20 de Julio: plataformas/áreas y vías independientes, sin fila artificial. Portal 20 de Julio revisado también en modo oscuro. Las geometrías anteriores se preservan y sus visitas siguen pasando las pruebas.
- Viaje Sur → Suba directo. Escuela Militar → Biblioteca Tintal para el sábado 12 sep.: alternativas con uno y dos transbordos; reloj del escenario permaneció en viernes 11 sep., 07:25:36. Itinerarios muestran sentido, subida, bajada y caminata; los segmentos conservan la geometría real.
- Seguimiento de C15: las posiciones de los rótulos Portal Suba y Br. Lombardía cambiaron en incrementos pequeños sucesivos, en lugar de quedar fijas entre reconstrucciones periódicas. Al finalizar un viaje vuelve el detalle del servicio.
- H20 a las 07:25:36 del 11 sep.: “Esperando luz verde”, 0 km/h y 19 s restantes. A las 07:25:56 aparece “En recorrido”, 3 km/h, conservando el bus y pasajeros.
- Escenario de estrés cargado con frecuencias 2/3 min, demanda 3× y semáforos activos: 2.601 buses al comenzar la prueba de interfaz. Reproducción acelerada y controles comprobados; resultado final anotado al cerrar la revisión.

Las primeras pruebas se hicieron a 1280×720; al reabrir el panel integrado también se inspeccionó una vista estrecha. Esto no certifica móviles físicos ni gestos pinch. La evidencia histórica de la primera revisión —reloj, guardado, fuentes y LAN— permanece en `VALIDACION_20260911.md`.

## Cierre de la revisión

Comprobación final ejecutada de nuevo sobre el árbol completo antes del commit, con el escenario en sus valores normales (4/8 min, demanda 1×, crucero 60/50):

- `node --test app/tests/*.test.mjs`: 49/49. `python -m unittest discover -s tests`: 3/3.
- `data/curated/station_layouts.json` y `data/curated/busway_signals.json` tienen el mismo SHA-256 que su copia en `app/dist`.
- SHA-256 verificado de `osm_map.json`, `evidence.json`, `overpass.json` y de los 639 XML de detalle (189 `way/full` y 450 nodos): sin discrepancias.
- Conteos recontados desde los datos: 450 señales, 449 asociadas, 112 variantes, 3.936 asociaciones, 103 elementos de parada, 32 áreas, 246 líneas internas, 191 de 201 visitas ubicadas. 137 registros con 114 utilizables y 23 pendientes, K86 incluido.
- Navegador: la simulación reprodujo exactamente el benchmark de Node (1.054 buses, 77.540 a bordo, 180 en parada, 105 en espera) sin errores de consola.
- Control **Semáforos corroborados**: activado da `27 esperando atención · 93 en semáforo`; al desactivarlo y reconstruir, `29 esperando atención · 0 en semáforo` con 879 buses; al reactivarlo vuelve a 1.050 buses. El desglose aparece al posar el cursor sobre el indicador de espera.
- Bus detenido en rojo: A60 TM-1492 (Calle 72) el 10 sep. a las 07:02:52 muestra “Esperando luz verde”, 0 km/h y “Luz verde en 7 s · est.”. A las 07:03:02 pasa a “En recorrido” con 10 km/h, conservando bus y 63 pasajeros. Al retroceder el reloj al mismo segundo reaparece el estado idéntico, incluidos los 7 s restantes.
- Planificador: Escuela Militar → Biblioteca Tintal del sábado 12 sep. a las 09:30 devuelve dos transbordos y 38 min con llegada 10:07, mientras el reloj del escenario permanece en el 10 sep. y sigue corriendo.
- Límite detectado en esta comprobación: la vigencia publicada deja el corredor de Portal Usme sin viajes planificables desde el 12 sep. Se documenta en [PLANIFICADOR.md](PLANIFICADOR.md); no se modificó el código.
