# Continuidad — Transmi 2D

Actualizado: 13 septiembre de 2026. Leer README.md, docs/OPERACION_Y_DATOS.md y docs/VALIDACION_FASE2_20260911.md. El checkpoint de la primera revisión es `f6fa207e3830ef75979640caf8ab9af4c64feac8`, verificado y subido antes de esta segunda revisión. La segunda revisión integra todos los portales, semáforos corroborados, planificador y etiquetas fluidas. No reiniciar la arquitectura.

## Proyecto y autorizaciones

Repo: `/Users/daniel/Documents/Codex/2026-09-08/ho/outputs/BogotaTransmi`, rama main, remoto `https://github.com/daniii3012/transmi-sim.git`. Push autorizado. Simulador 2D geográfico 1:1 de troncales y duales; zonales/cable fuera, conducción 3D pausada en archive/transmi3d. Diseño inspirado en Subway Builder/Mini Metro, sin construcción. La simulación no usa posiciones GPS en vivo; la pestaña En vivo las consulta aparte, solo con el servidor local, y no entra al modelo.

Estimaciones ajustables y QA de navegador autorizadas; dos carriles por sentido como abstracción y paso expreso independiente de atención. Daniel autorizó servir por LAN, pero no publicar una versión jugable en internet. Investigación acotada con agentes ligeros autorizada por AGENTS; la investigación de plataformas terminó. La captura semafórica se revisó y completó localmente después de que el agente alcanzara su límite; no hay trabajo pendiente que esperar de agentes ni automatizaciones.

## Ejecutar y desarrollar

- Fuentes estáticas editables `app/dist`, Three.js 0.186.0 local y cámara ortográfica. No hace falta npm ni bundler.
- `ABRIR_SIMULACION_2D.command`: loopback `http://127.0.0.1:8766/`.
- `ABRIR_EN_RED_LOCAL.command`: escucha LAN en puerto 8767; imprime IP actual. Ambos sirven solo app/dist, no-store, sin listar directorios. Mantener Terminal abierta. Cada navegador tiene su propia simulación.
- Python geográfico: `../../work/venv/bin/python`, con shapely/pyproj. Python del sistema sirve la web pero no trae esas bibliotecas. Node en PATH.
- `work/` está ignorado. ZIP de validaciones en la carpeta work/passengers de la tarea original, fuera del repo. Nunca añadir transacciones crudas a Git. El agregado versionado basta para reproducir.
- `web/transmi2d` es compatibilidad histórica. No confundirlo con otra aplicación.

## Estado después de las observaciones

137 registros: 117 utilizables de 105 códigos, 20 pendientes. El jueves inicial 10 sep. hay 115 variantes con ventanas. El mapa bruto tiene 116 registros/100 códigos, no 116 rutas únicas. C15 zonal/366 excluida; C15/3915 y H15/367 troncales tienen 19 paradas. F23/10082 Banderas excluida por indicación de Daniel; se conserva F23/396 Portal Américas. **Los 20 pendientes deben permanecer pendientes por ahora.** E48/12444, H76/1213 y K86 completo/629 salieron de esa lista el 11 sep. al reimportar su detalle publicado; los demás siguen sin trazado o con calendario Ciclovía ambiguo. No confundirlo con aeropuerto/5316.

- Reloj, calendarios/festivos colombianos, medianoche, demanda pico/valle, geometría métrica, curvas, aceleración y frenado integrados. Motor por eventos en worker; recorridos y reservas reproducibles al retroceder.
- **Tipo de bus leído de la flota** (12/09/2026): el alimentador publica la etiqueta que cada bus lleva pintada
  (`VehicleDescriptor` campo 2, que la captura descartaba). Esa etiqueta separa articulados, biarticulados y duales,
  y en la jornada del 12 sep. los 87 servicios con lecturas salen de una sola familia, sin mezcla: 21 de articulado,
  55 de biarticulado, 11 duales. Se retira el criterio de 18 km, que erraba en 25 de 76. `tools/classify_fleet.py`
  escribe `data/curated/fleet_types.json` y `build_services.py` lo adjunta como `vehicle_profile`. Capacidad fija
  80/160/240 por decisión de modelo; los 34 servicios sin lecturas usan articulado y lo declaran estimación;
  F63/Z63 conservan su perfil publicado de 160. Evidencia, rangos por serie y pendientes en
  docs/TIPOS_DE_BUS_20260912.md. La captura sigue corriendo (`--days 8`, ventana 4:00–23:30) y desde el 13 sep.
  escribe ya la columna `etiqueta`; `classify_fleet.py` compara etiqueta publicada contra reconstruida y lista
  discrepancias, series nuevas y servicios mezclados en cada corrida. **Pendiente:** confirmar con la semana
  completa, contrastar la proporción (780 de 1.094 troncales en la familia biarticulada) contra un conteo
  publicado de flota, y decidir si vale la pena una captura `--scope todo` para clasificar las series
  alimentadoras y zonales, que hoy quedan fuera.
- **Velocidad por trecho medido** (13/09/2026): se retira el crucero plano de 60 en calzada segregada y la regla de
  gastar el sobrante parado en la aproximación, que dejaba media flota quieta contra el 28 % real. `build_speed_field.py`
  escribe `data/curated/speed_field.json` —corredor, sentido y cubeta de 100 m, con la velocidad de travesía de quien
  pasa de largo— y `build_services.py` lo resuelve a `app/dist/speed_profiles.json` (117 servicios, cobertura 98 %).
  Del denominador de esa velocidad se descuentan la atención, lo quieto en cualquier andén y la espera junto a un
  semáforo corroborado, porque el motor ya modela las tres: contarlas dos veces sacaba los viajes siete minutos tarde.
  **Un bus solo se detiene por rojo o por andén ocupado**: en calzada segregada no se fabrica ninguna espera. Lo que
  sobra se gasta rodando más despacio y, si aun así llega antes, el adelanto viaja con el viaje y se devuelve en el
  tramo siguiente (hasta 90 s por tramo). Detenidos en tráfico 33 % → 1 %; flota quieta 51 % → 20 %; tramos con espera
  82 % → 6 %, y esos son todos de calzada mixta, con máximo 45 s. El viaje dura 1,5 min más que el horario publicado
  y ninguno se adelanta más de 5 min. Banco: preparación 15,5 s, muestreo 1,0–1,3 ms, heap 674 MB, máximo de buses
  detenidos a la vez 629 → 21.
  Evidencia, siete suposiciones y pendientes en docs/VELOCIDAD_POR_LUGAR_20260913.md.
  **Pendiente:** rehacer solo el campo con la semana capturada, añadir hora y tipo de día, revisar los tramos cuyo
  tiempo publicado no se alcanza ni al crucero, y decidir el término de densidad, que hoy no se implementa porque
  controlando por lugar vale solo un 5–8 %.
- Cruceros 60 troncal/50 calle, variación por vehículo −5/−2/0/+2/+5. Los buses frenan en curvas/paradas; calle en pico factor 0,82.
- Nuevo 1× de demanda = 2,25 del modelo previo. Demanda medida sobre 17 días (24 ago.–9 sep. 2026, 28.014.777 validaciones): perfil horario por tipo de día en `hourly_by_day_type`, 13 días de semana, 2 sábados y 2 domingos. Factores medidos sábado 0,654 y domingo 0,302, frente a los 0,70/0,55 estimados que reemplazan; el domingo estaba sobreestimado ~80%. Entre días de semana la variación es 2,0%. OD, descensos, direcciones y abandono medio 30 min siguen estimados. Denegaciones son oportunidades repetidas, no personas únicas. Detalle en docs/DEMANDA_MULTIDIA_20260911.md. Contraste estacional con 15 días de marzo (21.156.110 validaciones) en docs/DEMANDA_COMPARACION_MARZO_20260911.md: factores por tipo de día estables (sábado 0,654 vs 0,642; domingo 0,302 vs 0,289), nivel de marzo −7,3 % uniforme, reparto horario casi idéntico. Dos hallazgos: un festivo entre semana queda 16,5 % por debajo de un domingo —mejora pendiente, falta medir más festivos— y la red cambió entre marzo y septiembre (Calle 76 y Calle 45 desaparecen, Calle 72 - Areandina aparece), lo que corrobora la retirada de los pendientes 6/692 y A60/1187. La calibración sigue siendo la de agosto–septiembre por ser contemporánea del catálogo.
- **Salidas del horario publicado** (12/09/2026, ampliado el 13): 115 de los 117 servicios utilizables despachan a las horas
  del GTFS de TRANSMILENIO; los 2 restantes, casi todos duales cuyo registro publicado es una vuelta completa,
  conservan la regla y constan con motivo en `app/dist/schedule.json`. Interruptor «Salidas del horario publicado».
- **Vueltas completas que cierran el bucle** (13/09/2026): un registro publicado que regresa al andén desde el que salió
  trae un tramo de más, el que cierra el bucle, y la cuenta local salía por uno: el registro se descartaba entero.
  Afectaba a FZ63 —los 347 viajes de día laborable de F63 y Z63, que dejaban ese servicio sin un bus entre las 5 y las
  21 h— y a MK86/M86, 556 viajes más. `build_schedule.py` aparta ese tramo, pero solo cuando la cuenta no cuadra sin
  hacerlo, para no tocar los cinco registros que ya encajaban. Cortes 5 → 8, salidas 44.402 → 47.190, servicios con
  tiempos por tramo 108 → 114. Los únicos servicios utilizables sin buses un jueves son las dos variantes de Ciclovía
  (K86/1186 y D81/5279), que su propio calendario declara de domingo y festivo.
  Sábado a las 12:30: 477 activos con la regla, 634 con el horario, 975 viajes GTFS en curso. La diferencia que
  queda es duración, no frecuencia: los 91 servicios comparables terminan antes de lo programado, razón mediana
  0,67. **Corregido el mismo día**: la velocidad de cada tramo se despeja del tiempo publicado tras descontar
  atención y coste esperado de semáforos, con el crucero como techo. Velocidad comercial simulada 21,3 km/h
  frente a 21,1 programada; dentro de banda p10–p90 99/104 viernes, 77/91 sábado, 39/53 domingo; 874 activos
  el sábado a las 12:30 frente a 850 viajes GTFS en curso de servicios emparejados. Interruptores separados
  «Salidas del horario publicado» y «Duración del recorrido publicada». Ver docs/HORARIO_GTFS_20260912.md
  y docs/COMO_SE_SIMULA.md.
- **Captura de la operación** (12/09/2026): `tools/capture_rt.py` graba el alimentador GTFS-Realtime abierto cada
  30 s —sin credencial— y `tools/analyse_capture.py` lo convierte en flota por hora, tiempo real de cada tramo
  contra el publicado, y agrupamiento. ~50 MB/día; las lecturas no se versionan, el informe sí. El feed trae la
  cabecera congelada y repite la última posición de cada bus, así que el análisis se construye sobre los cambios
  de parada, nunca sobre velocidades entre lotes. Primera lectura de 1,32 h: en tramos de más de 240 s los buses
  tardaron el 85% de lo programado; 6% de los intervalos troncales por debajo de un minuto. **No aplicado al
  simulador**: hace falta de 7 a 14 días con laborables y fin de semana. Ver docs/CAPTURA_RT_20260912.md.
- **Vista En vivo sobre datos abiertos** (12/09/2026): `/api/en-vivo/red` sale de `tools/live_network.py`, que lee
  el alimentador GTFS-Realtime: sin credencial, sin truncar, ~1.010 buses troncales y duales por lectura. Publica
  antigüedad del lote y los ~120 vehículos de servicios fuera del catálogo, que se dibujan rotulados. Con un
  servicio en foco no se repiten buses: las dos fuentes comparten identificadores y la red omite los ya dibujados.
  «Por servicio» sigue en la consulta local, que es la única con ocupación, accesibilidad y avance sobre la ruta.
  Se retiró la instantánea de red que usaba el servicio local, ya sin uso. 30 pruebas Python.
- Regla de reserva, ahora solo para los pendientes: salidas 4/8 min, variación opcional ±12%; refuerzos limitados a una minoría de salidas pico con presión estimada alta, intercalados a 120 s. Reutilización de vehículos por terminal/tipo; patios operativos abstractos, sin circulación en vacío.
- Calzada real de OSM dibujada bajo los corredores: 929 vías conservadas de 1.203 descargadas, 341 con carriles publicados y las demás dibujadas con un carril. Ancho carriles×3,5 m, tonos distintos para calzada exclusiva y compartida, visible al acercarse y apagable con el botón ═. Los buses siguen la polilínea publicada del servicio, no esta calzada; pueden separarse unos metros. Detalle en docs/CALZADAS_20260911.md.
- Fondo: solo troncales de color. Tramos tipo_tra=2 (Séptima exterior y otras extensiones) y segmentos de calle de duales son grises discontinuos. Geometría exacta aparece al seleccionar servicio o bus; atenuada al seguirlo.
- OSM físico en 40 estaciones: nueve portales, Banderas, Ricaurte y Jiménez, más las 28 troncales con más servicios. Hay 111 elementos de parada/plataforma, 98 áreas y 478 líneas internas; los 111 incluyen nodos, no son 111 plataformas físicas. Calle 72 - Areandina y Virrey - Cendiatra no tienen geometría en OSM. Norte tiene puntos/área, sin contorno de plataforma inventado. Las otras estaciones mantienen vagones esquemáticos.
- `station-layouts.mjs` sitúa 477 de 648 visitas compatibles sobre las polilíneas existentes; 171 conservan referencia oficial. La selección de estaciones se calcula con `--stations N` desde el catálogo, no a mano. No redirige ni une rutas por proximidad. Inventario en TODOS_LOS_PORTALES_20260911.md.
- Semáforos: 723 con evidencia nodal directa, 450 en calzada exclusiva y 273 en tramos de calle de los duales (Séptima, Av. 68). 669 asociados a las 117 variantes por distancia ≤12 m y sentido/eje, con 4.807 pares. Reglas compartidas en `tools/busway_criteria.py`; el camino de calle solo aplica donde el servicio deja la troncal. Ciclos estimados de 90 s (52 verde / 3 amarillo / 35 rojo), frenado métrico y espera reproducible, activados por defecto/desactivables en Operación. No coordinación ni colas microscópicas en cruces. Estado `signal` separado de cola de atención; ambos suman el indicador en espera.
- Planificador: toda la red utilizable, fecha/hora independientes, hasta dos transbordos y seis horas de horizonte. Calendarios publicados, frecuencias y tiempos nominales, caminatas estimadas entre puntos de una misma estación lógica. No predice fases ni aforo. Itinerario y geometría parcial en la pestaña Planear viaje. `planner.mjs`, mensajes `plan` del worker e IDs de solicitud.
- Panel Red y rutas con tres pestañas que ya no se repiten: **La red ahora** muestra el estado en el instante del reloj —curva de demanda por hora del tipo de día con la hora actual marcada y salto al hacer clic, reparto de la flota, estaciones con más espera y buses/ocupación por troncal—; **Troncal** selecciona alcance por corredor; **Ruta** trae el buscador y la lista. La lista ya no se duplica en las tres. `pressure()` y `zoneLoad()` en el motor, mensaje `overview` del worker cada 4 s.
- Exploración Ruta separada del alcance operativo. Solo los botones de simular cambian servicios. Al volver a red se conserva hora y estado de reproducción. Cambiar de pestaña limpia ruta visual. Seleccionar otro bus actualiza su ruta; final de viaje vuelve a detalle de ruta.
- Seguimiento interpolado en distancia sobre la polilínea más cámara suavizada cada frame. Las etiquetas conservan nodos DOM y transformaciones de posición en cada actualización de cámara; las colisiones se recalculan por separado. Zoom de rueda/pinch más sensible. Clusters se reposicionan también al mover cámara en pausa.
- Slider protegido durante arrastre, respuestas del worker numeradas, botón Ahora (Bogotá), modo oscuro persistente, fuentes propias y notas de archivo al final de estación. No hay filtro Duales ni notas de una ruta particular en Operación.
- Pestaña En vivo, dos vistas. «Por servicio»: lectura con número de bus, ocupación y hora, una ruta por consulta. «Todo el sistema»: instantánea calculada de troncal y dual por recuadro geográfico, con reparto en cuadrantes cuando trunca. Las dos difieren hasta 1 km a lo largo del corredor, por eso la instantánea va atenuada y sin contorno. Las consulta `tools/live_buses.py` desde `serve_network_2d.py` en `/api/en-vivo`, con proyección AEQD propia. **Las direcciones y la credencial viven en `tools/en_vivo.local.json`, que no se versiona**: sin ese archivo la pestaña no consulta nada y así es como queda publicada. No alimenta el escenario y sus controles quedan en modo lectura.
- Punto de atención publicado por estación y sentido: `fetch_station_departures.py` + `build_station_wagons.py` → `station_wagons.json`, 1.303 de 1.557 paradas troncales (1.241 vagones, 62 plataformas de portal). `operation.mjs` lo usa en vez del `hash(family)` cuando existe y marca `wagonSource`. Los identificadores de estación del proyecto **son los del planificador**. Las 12 estaciones sin tablero son las 9 En obras más las tres que abrieron el 17 ago. docs/ACTUALIZAR_DATOS.md y docs/RUTAS_VERIFICACION_20260912.md.
- Guardado v3, restaurado pausado. Se lee v2 si falta v3: conserva fecha/hora/alcance y parámetros compatibles, migra antiguos cruceros por defecto 48/30 a 60/50 y elimina mezcla/capacidad configurables. F23 antiguo se redirige a 396.

## Reproducir y validar

Fuentes de servicios: data/raw/services/20260910T185326Z + supplement_20260910, curación data/curated/services.json. OSM de estaciones: data/raw/station_layouts/20260911T120000Z, combina seis layouts previos con seis portales nuevos. OSM semáforos: data/raw/busway_signals/20260911T120000Z, 293 celdas más 639 XML detallados con hashes. Las carpetas son identificadores; las horas de consulta están en los manifiestos.

`build_services.py`, `build_context.py`, `build_station_layouts.py` usan Python geo; `import_passenger_profiles.py` usa agregado existente. Scripts de descarga separados; no actualizar fuentes silenciosamente.

74 pruebas Node pasaron, 30 Python entre proxy en vivo, adaptador de red y análisis de capturas; test_network_2d.py no corre por falta de shapely en el equipo; las 10 de `tests/test_live_buses.py` corren también con el Python del sistema y no tocan la red. Benchmarks con semáforos de calzada y calle y demanda multidía: referencia 1.113 buses máximos muestreados, 71 esperando atención y 121 en semáforo; preparación 12,01 s, muestreo 1,30 ms, heap 560 MB. Estrés 2/3 min y demanda 3×: 3.303 buses, 1.441 esperando atención y 236 en semáforo; 21,00 s / 4,56 ms / 1.138 MB. Máximos exactos por eventos 1.118/3.337. CPU Node, no FPS; el estrés puede congestionarse, sin borrar vehículos.

QA de navegador: seis portales nuevos y anteriores conservados, transbordos/fecha independiente, etiquetas moviéndose continuamente, rojo de 19 s y arranque en verde con H20, controles, guardado y escenarios. La primera revisión registra las pruebas originales de reloj, selección y LAN. Sin certificación de móviles físicos o pinch. Ver informe final para evidencia concreta de esta revisión.

## Pendientes consentidos

20 registros de datos; asignaciones oficiales ruta/tipo/vagón, más planos, patios/inventarios/vacíos; calibración con OD y varios días; revisión exhaustiva de cruces/obras. Vigencia del catálogo: 12 de los 117 servicios utilizables terminan el 11 sep. 2026 y dejan el corredor de Portal Usme sin alternativas de planificación desde el 12; es límite de la instantánea, no del buscador. Fases y coordinación semafóricas reales por obtener; el ciclo de escenario ya está integrado. Mantener estas incertidumbres visibles y enlazadas desde la app. Nuevas observaciones del usuario deben incorporarse sobre esta versión.

Procedimiento de actualización de fuentes en docs/ACTUALIZAR_DATOS.md; es el documento a seguir cuando cambie el sistema real. Revisión de los pendientes en docs/PENDIENTES_20260911.md. E48/12444, H76/1213 y K86/629 se reimportaron con `tools/refresh_route_details.py`, que baja solo el detalle de los identificadores indicados a una carpeta propia y deja `refresh_latest.json`; la metadata de catálogo, vigencia incluida, sigue viniendo de la instantánea base. Cada ruta lleva `detail_snapshot` con su procedencia. El contexto urbano es la única fuente sin `fetch_*` y con la ruta fija dentro de build_context.py.

**Publicado en https://daniii3012.github.io/transmi-sim/.** Primer cargue el 11 sep. 2026 bajo el nombre anterior; republicado el 12 sep. tras renombrar el repositorio a `transmi-sim`, con la pestaña En vivo, el punto de atención publicado y el planificador con alternativas. La dirección anterior, `/transmi-game/`, ya no responde: Pages no redirige aunque GitHub sí redirija la URL del repositorio. `.github/workflows/pages.yml` publica solo app/dist, se dispara a mano y comprueba pruebas, JSON, paridad curado/web, versión `?v=` única y ausencia de rutas absolutas; tras desplegar verifica el Content-Type de `.mjs`, que sale `text/javascript`. Para el primer cargue se activó el disparador por push durante un commit y se retiró en el siguiente. Detalle y comprobaciones en docs/PUBLICACION_WEB_20260911.md.

Colas de buses en semáforos: analizado y **no implementado** por decisión de Daniel. Ver docs/COLAS_Y_ESPACIO_20260911.md.

Antes de terminar cada hito, verificar diff, commit/push y coincidencia HEAD local/remoto. Los informes del 10 sep. se conservan como evidencia histórica, no resultados actuales.

12/09/2026 — Interfaz adaptable refinada en `responsive.css` y `shell.mjs`: navegación inferior móvil, panel plegable, Más para controles secundarios, zoom con dos dedos y reloj contextual. Ver docs/INTERFAZ_MOVIL_20260912.md. Cambios de iOS y transporte nativo solo en el repositorio privado.

12/09/2026 (noche) — **El tiempo publicado de un tramo se reparte, ya no se aplana.** En calzada
segregada el bus rueda a su crucero y el sobrante se gasta en detenciones explícitas en la
aproximación a la estación, en trozos de 45 s; en calzada mixta sigue el crucero rebajado continuo.
Estado nuevo en la interfaz, «Detenido en tráfico», distinto de «Esperando atención». La llegada a
cada parada no se mueve. Salió de dos seguimientos de Daniel contra el sistema real y de 5 h de
captura del sábado: el horario publicado lleva un 11 % de holgura por viaje completo y la reparte
mal, con un desvío absoluto mediano de 0,24 tramo a tramo. Ver
docs/VELOCIDAD_Y_DETENCIONES_20260912.md. **El desfase contra la realidad sigue sin corregirse a
propósito**: calibrar el presupuesto necesita laborables y punta, no un sábado. Fuentes con versión
20260912.15.

12/09/2026 (noche) — **Horario publicado para 113 de los 117 servicios** (antes 104). Dos cambios en
`build_schedule.py`: la clave de emparejamiento ignora espacios y guiones —los dos catálogos escriben
«AV CL80 - KR114» y «AV CL80 KR114»— y las vueltas completas ya no se apartan, se **cortan** en sus
dos mitades, descartando el tramo del giro y desfasando la salida de la vuelta por la parte del viaje
que se llevan la ida y el giro, para que un bus no se vea como dos. Se corta solo si la aritmética es
exacta: 5 registros cortados, 15 apartados con el motivo escrito. La flota simulada pasa de 0,88-0,92
a **0,96-0,99** de la observada en todas las horas de la captura; ML82 de 11 a 30 buses contra 29
observados, MC84 de 7 a 14 contra 14, D81 de 8 a 19 contra 16, K16 de 4 a 6 contra 6. Cautela nueva:
un emparejamiento que solo alcanza una esquina del servicio se descarta —M86 casaba con 12 viajes de
22:10 a 23:00 mientras 633 viven en vueltas sin cortar—, porque el motor usa la lista de salidas como
si fuera completa. Ver docs/HORARIO_GTFS_20260912.md.

**Los 4 pendientes que quedan son el mismo nudo: K86.** El paquete publica la vuelta de la Séptima
siguiendo derecho al aeropuerto (`MK86`, 48 tramos, 04:30-21:03) más un bucle suelto al aeropuerto
(7 tramos, 125 viajes L-V), y a partir de las 21:05 los últimos viajes se quedan en el portal. El
catálogo local corta por otro sitio: «Aeropuerto» son 4 paradas —medio bucle— y «Portal ElDorado» de
26 paradas **no trae la parada intermedia en el portal**, que es el tramo que falta para que `MK86`
cuadre. Corregirlo toca una fuente curada contra su origen publicado: queda anotado, sin tocar.

12/09/2026 (noche) — Captura: `capture_rt.py` toma un cerrojo `captura.lock` en su carpeta y se
niega a arrancar si otra captura ya escribe ahí. Dos procesos solapados el 12 dejaron una cabecera en
medio del `.csv.gz` y un lote duplicado, y `analyse_capture.py` reventaba al leerlo; ahora depura
cabeceras intrusas y filas repetidas diciéndolo, y el informe lo anota en `descartado_al_leer`. Las
lecturas del 12 quedaron limpias en el sitio: 513.864 filas, 552 lotes, 5 h, un hueco de 18 min a las
16:59. La flota simulada coincide con la observada una vez se compara con lo comparable: 777 contra
764 vehículos en catálogo a las 19:00; los ~99 restantes son D81, ML82, MK86, K16, MC84, P85-M85 y
K86, que el catálogo local no tiene. Daniel precisa que las duales aparecen mapeadas como una sola
ruta (ML82 = M82/L82, MK86 = M86/K86).

12/09/2026 (noche) — **Revisión de interfaz sobre observaciones de Daniel.** Fuentes en
`20260912.17`. Cambia lo que se ve, no el modelo ni las fuentes.

- Indicadores: el separador vertical pasa a `border-left`, así el último visible ya no arrastra una
  raya suelta. `:last-child` miraba el DOM y los indicadores en vivo están ocultos detrás, no
  ausentes.
- «Buses reales» pasa a **«buses en tiempo real»** en toda la interfaz: rótulo de la pestaña,
  etiqueta del indicador y ficha de vehículo. Lo que los distingue es que se leen ahora.
- El aviso de carga deja de ocupar el centro del mapa: es una pastilla bajo el rótulo de la vista,
  y bajo los indicadores en el móvil.
- **En vivo y simulación dejan de mezclarse.** La ficha de un servicio abierta desde En vivo ya no
  ofrece «Simular solo este servicio» ni «Seguir un bus de esta ruta» —acciones del escenario—, sino
  «Ver los buses de X en tiempo real». El botón de trazado de un grupo ya no salta a Red y rutas:
  muestra las paradas sin salir de la pestaña, y desde ahí cada parada abre el tablero publicado.
  En Red y rutas todo sigue igual.
- La lista de «Todo el sistema» ya no tiene scroll propio: corre con el panel, y en el móvil el dedo
  deja de quedarse atrapado en ella. Los vehículos fuera del catálogo se cuentan como buses, que es
  lo que son.
- Con un servicio en foco, la instantánea de toda la red pasa de 60 s a **30 s**.
- **La ficha de detalle se pliega** con un tirador, sin soltar la selección: cerrarla era la única
  salida y eso quitaba el bus o la ruta en foco. Escape pliega primero y cierra después.
- **La cámara respeta los paneles.** `insets()` sale de `fit()` y la comparten `focusOn()` y
  `follow()`: centrar o seguir un bus lo deja en medio del hueco libre, no debajo de la hoja
  inferior, que en el móvil se lleva media pantalla. El desplazamiento se recuerda 200 ms para no
  medir la página en cada fotograma.
- Planear viaje: **una sola opción a la vista** —la que llega antes, y con menos transbordos si
  empatan— y el resto tras un único pliegue. Agrupar por transbordos abría tres tarjetas que se
  leían como tres viajes. La hoja pasa a `min(62%,580px)` y los campos de fecha y hora encogen con
  la rejilla, que era lo que desplazaba el panel de lado.
- El doble toque ya no hace zoom de página: `touch-action:manipulation` en `html,body`. El lienzo
  del mapa conserva `none`.

12/09/2026 (noche, segunda vuelta) — Tres retoques más sobre la misma revisión.

- **El encuadre salía disparado al saltar de una estación a su servicio en vivo.** `insets()`
  preguntaba por `body.dataset.inspect`, que la pone un observador y llega un fotograma tarde: la
  ficha ya estaba oculta y la marca seguía diciendo que no, así que se medía un rectángulo de altura
  cero y el borde inferior salía mayor que la pantalla. El trazado quedaba muy por encima de la vista.
  Ahora el panel de abajo se elige por `#inspector.hidden` y se exige que el rectángulo tenga altura.
- El tirador del detalle recibe **el mismo trato que la ✕**: recuadro, altura y posición iguales, a
  su lado. Suelto sobre el texto se leía como parte del contenido. Plegado queda el rótulo de lo que
  sigue en foco.
- **Volver a los buses sin pasar por la ✕.** Desde la ficha de un servicio abierta en En vivo, el
  botón repetía la misma consulta y `LiveFeed.select` sale temprano si el código no cambia, así que
  no pasaba nada y la única salida era cerrar. Ahora, con ese servicio ya en foco, el botón dice
  «Volver a los buses de X en tiempo real» y suelta la ficha; con otro servicio hace el salto de
  siempre. Y soltar una ficha dentro de En vivo vuelve a resaltar el trazado del servicio en el
  acto, en vez de dejar las troncales desnudas hasta la próxima lectura.
- El galón del tirador se dibuja con bordes, no con un carácter: «⌄» y «⌃» no miden lo mismo ni se
  apoyan a la misma altura en la fuente, así que el botón cambiaba de tamaño entre desplegado y
  plegado y el dibujo quedaba descentrado. Un cuadrado girado mide igual en los dos sentidos. La ✕
  y el tirador comparten ahora caja exacta: 32 px en escritorio, 44 en móvil.
- La cabecera de la hoja llevaba los mismos dos caracteres y con ellos el mismo defecto: cambiaba de
  tamaño al plegarse y la marca no quedaba a la altura del texto. Ahora usa el galón de bordes.
- **La pestaña En vivo publicada ya no manda a correr nada en local.** Decía que hacía falta el
  servidor de esta carpeta y nombraba `ABRIR_SIMULACION_2D.command`, instrucciones que no llevan a
  ninguna parte desde el sitio: lo que las haría funcionar no está en este repositorio. Ahora dice
  lo que es —un simulador que reconstruye la operación desde los horarios publicados y no observa
  dónde está cada bus— y que esta versión no trae vista en tiempo real. Solo cambia el aviso que se
  ve cuando la lectura no está disponible, que es exactamente el caso de Pages; corriendo en local
  la pestaña sigue igual.
- **La fecha y la hora del planificador se apilan en el móvil.** `min-width:0` no bastaba: el
  control nativo de iOS no baja de su tamaño intrínseco por mucho que se le pida el 100% del hueco,
  así que en la emulación del escritorio cabía y en el iPhone la pareja sobresalía ~15 px y
  desplazaba la hoja entera de lado. A lo ancho la pareja se conserva.
- Apilar los campos no bastó: en WebKit la fecha y la hora **se dimensionan solas** —el ancho que
  piden no lo fija `width`, sino la maqueta nativa que llevan dentro—, y seguían sobresaliendo del
  panel. Se les quita esa maqueta con `appearance:none`, que en iOS no cuesta nada porque allí ya se
  dibujan planos. Y la hoja lleva `overflow-x:hidden` en el móvil como tope: un control que insista
  en pedir más ancho del que hay se recorta, en vez de arrastrar el panel entero de lado.
- **Las filas de la lista de rutas recuperan su margen lateral en el móvil.** Conservaban el ancho
  desbordado y el margen negativo del escritorio, pero se les quitaba el relleno lateral —resto de
  cuando la lista iba a dos columnas—, así que la insignia del servicio y el conteo de buses
  quedaban pegados al borde del recuadro. Con el relleno vuelven a alinearse con el buscador y el
  resto del panel, y el resalte sigue sobresaliendo diez píxeles como en las demás listas.

12/09/2026 (noche, tercera vuelta) — Planificador, En vivo y el reloj.

- **El filtro de estaciones pasa a la web.** Estaba en `explorer.mjs`, que solo existe en el árbol
  privado, así que la versión publicada obligaba a recorrer mil paradas en un desplegable. El código
  vive ahora en `app.mjs` —compartido— y el explorador recibe `restoreOptions` para seguir fijando
  origen y destino desde la ficha de una estación. Intercambiar rehace las listas completas antes de
  cruzar los valores, que con un filtro puesto dejaría fuera la estación que entra.
- **Una alternativa, un pliegue.** Estaban todas dentro de un solo desplegable, que abría un muro;
  ahora cada una ocupa una línea hasta que se abra, y el resumen ya dice cuánto tarda, a qué hora
  llega y por qué servicios va. Dentro del pliegue la tarjeta no repite ese encabezado.
- **Se retiran las opciones que no son alternativas.** Un viaje es mejor si llega antes, tiene menos
  transbordos o sale más tarde —esto último cuenta, son minutos que uno no espera—. El buscador
  ofrecía «3 transbordos, llega 00:05» junto a «2 transbordos, llega 00:05»: la misma peor. Se queda
  la frontera de lo elegible, calculada al presentar, sin tocar el motor. Comprobado que conserva el
  caso que el diseño quería conservar: Banderas→Ricaurte sigue ofreciendo C19, J23 y M51, que salen
  a horas distintas por el mismo corredor.
- **Revisión de optimalidad.** El motor es una búsqueda por etiquetas sobre (transbordos, estación,
  servicio, parada) que minimiza la hora de llegada, y guarda cada meta alcanzada. El viaje que
  llega primero siempre entra en el conjunto ofrecido —su cubo está vacío cuando se le mira—, así
  que la tarjeta abierta es de verdad la mejor por hora de llegada, con menos transbordos al empatar.
- La fecha y la hora vuelven a compartir fila en el móvil: lo que las hacía desbordar era la maqueta
  nativa, no la rejilla, y eso ya está resuelto.
- **El indicador de En vivo se repinta al cambiar de alcance.** Conservaba el número del alcance
  anterior bajo la etiqueta nueva —los buses de todo el sistema rotulados «del servicio», o los de un
  servicio rotulados como el sistema entero— hasta la siguiente lectura. Ahora se borra y se repinta
  con lo último que ya se tiene, lo que además devuelve al mapa los buses que la otra vista escondía.
- **El reloj ya no se esconde al seleccionar algo.** En el móvil, una estación o un bus en foco
  ocultaba el control del tiempo, justo el que da sentido a lo que se está mirando, y obligaba a
  soltar la selección para mover la hora. La hoja sigue cediendo el sitio; el reloj no. La ficha se
  apoya donde acabe el reloj mediante `--sheet-bottom`, y donde la pestaña no lo muestra llega hasta
  abajo del todo.

13/09/2026 — Identificar el bus que se está mirando.

- **La instantánea de toda la red ya trae el número de flota.** El alimentador lo publica en
  `VehicleDescriptor.label` —«E0022», el mismo formato que rotula la lectura por servicio— y
  `live_network.py` no lo reenviaba, así que la ficha de un bus de esa vista caía al destino por
  falta de número. Ahora las dos vistas dicen lo mismo: insignia del servicio, número del bus y
  destino debajo.
- **Las dos fuentes no comparten el identificador, comparten el número.** El id del alimentador es
  interno («7022») y el de la lectura por servicio es otro («45502»); lo que coincide es la etiqueta
  de flota. `realBus` busca ahora también por ella, así que una selección sigue al mismo bus al
  cambiar de vista en vez de perderse —o, peor, de engancharse a otro que comparta el id por azar—.
  Y el descarte de duplicados, que se anotaba por id y por eso **no descartaba nada**, pasa a la
  etiqueta: con F23 en foco la red pasa de repetir sus 8 buses a mostrar solo el que no está dibujado.
- **La ficha plegada identifica la selección.** Junto al título aparece la insignia del servicio, en
  una línea. El título es el número del bus donde la fuente lo publica y el nombre del recorrido
  donde no —en la simulación no hay número que valga—, así que la pareja basta sin abrir nada.
- La nota de la vista general describía la instantánea del planificador, que se retiró el 12/09.
  Hoy esa vista es el alimentador abierto: posición reportada, sellada con la hora del lote y no con
  la del GPS de cada bus, y sin ocupación. El texto lo dice ya así.
- **El menú Más quedaba detrás de la ficha.** No era su z-index: la barra inferior y su menú cuelgan
  de `<header>`, que abre su propio contexto de apilamiento con `z-index:6`, y dentro de él da igual
  subir el menú a 20 —el bloque entero se compara con la ficha por ese 6—. Se sube el contexto.
- **El reloj del móvil se reparte por uso, en las mismas dos filas.** Arriba lo que mueve el tiempo
  —quince minutos, pausa, quince minutos—, la velocidad y el día; abajo la línea del día con la hora
  y el salto al ahora. La fecha y «Ahora» dejan de vivir tras el menú Más, que no era sitio para
  ellas: `shell.mjs` baja la hora y el botón a la segunda fila en un teléfono y los devuelve a la
  suya en una pantalla ancha, como ya hacía con el selector de En vivo. Con eso se va también
  `time-expanded` y el desplegable de fecha del menú. «Ahora» pasa a ser un reloj dibujado con
  bordes —círculo y dos agujas—, que mide igual en cualquier fuente; su texto queda de etiqueta.
  Los indicadores nativos de los campos de fecha y hora se ocultan en el móvil: se llevaban veinte
  píxeles cada uno y tocar el campo sigue abriendo el selector.
- Corrección sobre lo anterior: en dos filas quedaba apretado, así que el reloj del móvil va en
  **tres**. Arriba el día, la hora y el salto al ahora —lo que se lee—; en medio los quince minutos,
  la pausa y la velocidad —lo que se toca—; abajo la línea del día con sus extremos, como estaba.
  Un chevron pliega las dos filas de mandos y deja la de arriba, que es la que dice qué momento se
  está mirando: 128 px abiertos, 52 plegado. El alto sale de `--clock-height`, del que cuelgan el
  borde inferior de la hoja, el de la ficha y el del aviso, para no repartir el mismo número a mano.
- Retoques sobre lo anterior: «Ahora» vuelve a ser texto, no un dibujo, y la línea del día deja de
  rozar el borde de la tarjeta —el alto se midió mal: la fila de arriba ocupa 44, la altura táctil
  de un campo, no 36—. De paso se arregla un daño que había hecho yo: envolver «Ahora» en un span
  para poder rotularlo lo dejaba invisible entre 801 y 1250 px, porque `.date-controls span` se
  usaba para esconder el día de la semana. Esa regla nombra ahora `#day-type`, que era lo que quería
  esconder.
- **Se retira guardar el escenario.** No había dónde ver ni borrar lo guardado, y al reabrir la
  página se volvía a un escenario viejo sin haberlo pedido. Se van el botón, el guardado y la
  restauración; lo que quedara en el navegador se borra al abrir. El tema y las estaciones favoritas
  se quedan, que sí tienen dónde cambiarse.
