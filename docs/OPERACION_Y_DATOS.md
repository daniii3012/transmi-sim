# Operación, datos y reproducción

Entrega local revisada el 11 de septiembre de 2026. Los archivos de la aplicación incluyen origen, fecha, identificadores y hashes. Las fuentes oficiales no incluyen todos los parámetros necesarios para una simulación; las siguientes distinciones son parte del modelo.

## Fuentes incorporadas

| Fuente | Uso y evidencia |
|---|---|
| Catálogo de servicios de TRANSMILENIO | 116 registros/100 códigos en el catálogo, detalles por ID, horarios, vigencia, trazados, colores y estaciones. Instantánea del 10 sep. 2026; catálogo ampliado original de 132. |
| Suplemento del catálogo | 7 registros adicionales D81/L81, H83 y F63/Z63; no se sobrescribe la instantánea base. |
| Contraste de C15 y H15 | Verificado aparte: 19 paradas por sentido. La C15 Chapinero Ciclovía es zonal y queda excluida mediante `data/curated/services.json`. |
| Paraderos SITP usados por duales | Solo sus coordenadas, sin añadir rutas zonales. |
| [Validaciones diarias SITP, Datos Abiertos Bogotá](https://datosabiertos.bogota.gov.co/dataset/validaciones-diarias-sitp) | La ficha declara CC BY 4.0. [Archivo oficial utilizado](https://storage.googleapis.com/validaciones_tmsa/ValidacionTroncal/validacionTroncal20260909.zip): 1.920.298 filas de validación y 151 códigos de recaudo. 1.920.284 tienen fecha 9 sep. y 14 son posteriores a medianoche, del 10 sep.; se conserva este desglose. |
| [Capacidades generales del sistema](https://www.transmilenio.gov.co/transmichiquis/la-entidad/servicios-del-sistema) | Referencia articulado 160 y biarticulado 250. [Modelo histórico de 240](https://www.transmilenio.gov.co/comunicaciones/publicaciones/2015/nuevo-modelo-de-bus-para-el-sistema-transmilenio); esta publicación es de 2015, aunque el sitio tenga fechas de actualización posteriores. |
| Lecturas de posición de la flota | Dos cosas, sin credencial. **Velocidad por trecho de corredor**: 113,8 km en cubetas de 100 m, 95 % con medición propia, descontando lo que el motor ya modela aparte —atención, andén y semáforos—, en `data/curated/speed_field.json` ([método](VELOCIDAD_POR_LUGAR_20260912.md)). Y la etiqueta de flota por vehículo. De ella sale el tipo de bus de cada servicio: 1.271 vehículos y 87 servicios resueltos en la jornada del 12 sep. 2026. Método y límites en [tipo de bus por servicio](TIPOS_DE_BUS_20260912.md); tabla en `data/curated/fleet_types.json`. |
| [Duales eléctricos articulados en 2026](https://bogota.gov.co/mi-ciudad/movilidad/bogota-pone-rodar-50-buses-duales-articulados-electricos-en-2026) y [operación de Ciudad de Cali](https://www.transmilenio.gov.co/comunicaciones/noticias-de-transmilenio/boletines-informativos/entra-operacion-extension-av-ciudad-cali) | Perfil publicado de F63/Z63 con capacidad 160. No se infiere que todos los duales sean padrones ni que todas las rutas tengan biarticulados. |
| [OpenStreetMap](https://www.openstreetmap.org/copyright), Overpass | Contexto fechado, ODbL 1.0, 15.573 elementos proyectados: vías principales, parques y agua. Etiquetas explícitas bridge/tunnel/layer/junction se conservan. la instantánea versionada contiene consulta y respuesta. |
| [Geometría de estaciones OSM](ESTACIONES_OSM_20260911.md) | Seis estaciones detalladas, consulta Overpass 11 sep. 2026, timestamp base del servidor 1 jun. 2026. Fuente y hashes conservados. [Plano secundario de Portal Sur](https://sitp-bogota.com/portal-del-sur-transmilenio/) consultado, sin extraer geometría de su imagen. |
| [Ley 51 de 1983](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=4954) | Festivos y traslados de descanso al lunes. Calendario implementado con Pascua y fechas civiles. |

La licencia del catálogo de servicios y de la cartografía no está establecida; no se les asigna automáticamente la licencia de las capas GIS antiguas. Se conservan atribución y procedencia. La aplicación funciona localmente sin consultar esas APIs durante el juego.

## Normalización y cobertura

`tools/build_services.py` lee fuentes inmutables y curación explícita. Proyecta, ordena paradas, contrasta sus referencias con puntos cercanos y recorta la polilínea entre origen y destino. Busca la proyección local en ±650 m de la referencia para no saltar al otro sentido de un bucle. Solo ajusta al punto publicado si está a ≤250 m del tramo; diferencias mayores se documentan o bloquean según el umbral. Redondeo milimétrico de salida no implica precisión milimétrica del dato.

Los paraderos sin coordenada contrastada se interpolan sobre la ruta y se rotulan aproximados. Los trazados ausentes, referencias fuera de rango y calendarios Ciclovía ambiguos no se activan. M85 recorre su tramo real de unos 11,37 km, empezando a unos 9,65 km de su geometría bruta bidireccional. K86/629 tiene referencias hasta unos 44,7 km, incompatibles con un trazado de unos 5,94 km; se mantiene pendiente. El ramal de aeropuerto tiene identidad propia.

Tras excluir la zonal y F23/10082 Banderas (corrección de catálogo, 11 sep.) y añadir el suplemento: 137 registros, 117 utilizables, 105 códigos utilizables distintos, 20 pendientes. Los 117 son elegibles por fecha el 10 de septiembre; 115 tienen ventanas para ese jueves. Doce pendientes estaban vencidos. Las ventanas de una variante Ciclovía explícita reemplazan las coincidentes de su familia regular; las variantes ambiguas no suprimen silenciosamente un servicio regular.

## Hipótesis operativas

| Parámetro | Referencia inicial |
|---|---|
| Intervalo entre salidas | 4 min pico, 8 min valle; ajustable, con variación determinista de ±12% opcional |
| Pico entre semana | 06–09 y 16–20, o modo forzado |
| Crucero troncal / calle | Techo de 60 / 50 km/h ajustable; cada tramo con horario publicado rueda por debajo, a lo que ese horario le da; cada bus conserva una variación de −5, −2, 0, +2 o +5; calle en pico factor 0,82 |
| Aceleración / frenado | 0,8 / 1,1 m/s²; desaceleración por curvas estimada |
| Atención | Base 13 s troncal, 9 s calle; +4 s pico; abordajes a 2,5 personas/s y descensos a 3 personas/s |
| Regulación en terminal | 240 s; patio abstracto en el extremo, sin acceso físico inventado |
| Vagones | Cantidad publicada si existe, 2 como respaldo; asignación determinista estimada |
| Carriles y posiciones | Atención y paso independientes por sentido; 2 posiciones por vagón y 1 en calle |
| Flota | Sin un contador fijo de buses activos: resultado de salidas y duración; reutilización compatible por terminal/tipo |

Desde el 12 de septiembre de 2026 las salidas salen del **horario publicado**: 115 de los 117 servicios
utilizables despachan a las horas del GTFS de TRANSMILENIO, no a un intervalo fijo. Los 13 restantes
conservan la regla de 4/8 min y constan uno a uno, con su motivo, en `app/dist/schedule.json`; casi todos
son duales cuyo registro publicado es una vuelta completa que cubre dos códigos locales, y atarlos a ambos
inventaría un segundo bus. El interruptor «Salidas del horario publicado» devuelve la regla a todos.
Ver [Horario publicado](HORARIO_GTFS_20260912.md).

La velocidad de crucero de cada tramo también sale del horario: se despeja del tiempo publicado para
ese tramo tras descontar la atención y el coste esperado de sus semáforos, con el crucero de la tabla
de arriba como techo. Interruptor «Duración del recorrido publicada». Con eso la velocidad comercial
simulada queda en 21,3 km/h frente a 21,1 programada, y 99 de 104 servicios de un viernes caen dentro
de su banda p10–p90.

La vigencia local sigue decidiendo si un servicio opera esa fecha; lo que ya no se inventa es a qué hora
sale cada bus. Los horarios publicados se interpretan como ventanas de despacho, no como instante de
desaparición del último bus. Un viaje puede terminar después del cierre.

## Pasajeros y clases de bus

La importación agrupa accesos equivalentes y temporales en 142 estaciones lógicas, mediante alias revisables en `data/curated/validation_stations.json`. No afirma que una estación temporal comparta coordenadas exactas con la permanente. Se enlazan 1.920.297 validaciones; una corresponde a Tunal Cable y se excluye. Los artefactos versionados no contienen tarjetas, dispositivos ni transacciones individuales.

El nuevo nivel de demanda 1× multiplica por 2,25 las entradas calculadas con el modelo anterior, tanto históricas como de respaldo. Se aplica después el control 0,25×–3×. El total histórico mostrado permanece sin multiplicar: las validaciones son entradas registradas por recaudo, no personas esperando ahora.

El perfil por hora se divide inicialmente entre dos sentidos y se modifica según orientación respecto a Centro Internacional como centro de empleo aproximado. Se aplica más demanda hacia el centro de 06–10 y hacia afuera de 16–20. Es una hipótesis de escenario, no una encuesta de empleo. Los sábados usan 0,7 y domingos/festivos 0,55 del perfil de referencia; otros días laborales reutilizan el único día observado. Paraderos sin observaciones usan pesos estimados.

Los pasajeros comparten una cola agregada por estación/sentido. La selección de una parte de la red recibe una proporción de la demanda según servicios atendidos, sin asignación OD individual ni transbordos explícitos. El destino de descenso es estimado; hay control de capacidad y abandono de espera con media de 30 min. La interpretación de estación/sentido único, patios y cierre de jornada requiere calibración posterior.

La capacidad es fija: padrón 80, articulado 160 y biarticulado 240, por decisión de modelo. El **tipo** de cada servicio, en cambio, se lee de la flota que lo atiende: las lecturas de posición publica la etiqueta que cada bus lleva pintada, esa etiqueta separa articulados, biarticulados y duales, y en una jornada completa de lecturas cada servicio usa una sola familia. 87 servicios quedaron resueltos así —21 de articulado, 55 de biarticulado y 11 duales—, todos sin una sola mezcla; `tools/classify_fleet.py` deriva la tabla a `data/curated/fleet_types.json` y `build_services.py` la adjunta a cada ruta. Método, evidencia y límites en [tipo de bus por servicio](TIPOS_DE_BUS_20260912.md). Con esto se retira el criterio anterior de 18 km, que erraba en 25 de los 76 servicios observados. Los 34 servicios del catálogo sin lecturas usan el articulado de referencia y la ficha del bus lo declara estimación. F63/Z63 conservan su tipo publicado de 160, más específico que la familia; los demás duales usan padrón estimado. No se deduce compatibilidad de puertas. No existe mezcla aleatoria ni selector de 250. El tipo no cambia al reutilizar un bus. Las longitudes de representación son 12, 18,5 y 27,2 m; requieren ficha por modelo antes de usarlas como ingeniería de andenes.

## Ajustes de la revisión del 11 de septiembre

Los refuerzos son una hipótesis opcional: en horas pico, para intervalos base de al menos 210 s, una minoría determinista de salidas (semilla módulo 7) puede recibir un bus adicional a los 120 s si la presión horaria por servicio supera 90% de su capacidad. No se añaden fuera de la ventana publicada ni cuando el intervalo ya es 2 min. El despacho normal continúa; pueden formarse grupos de dos o tres buses. La presión usa entradas históricas repartidas entre servicios, no una orden real del centro de control. No se fuerza que todos los pasajeros esperen cierto número de buses.

[Estaciones OSM y procedencia](ESTACIONES_OSM_20260911.md) documenta plataformas de Portal Sur, Suba, Américas y Banderas, y cubiertas/accesos de Ricaurte/Jiménez. Cada objeto conserva URL y etiquetas. Las áreas de estación no se presentan como plataformas verificadas. Una selección geométrica estima el punto de atención sobre la ruta existente: ventana de ±400 m, distancia lateral máxima 28 m y compatibilidad de eje cuando existe. Se limita además por las paradas vecinas. No se redirige el bus por una vía interna de OSM ni se cambia la polilínea oficial. Los puestos físicos encontrados tienen reservas separadas; la numeración de vagón y la ruta asignada a cada puesto siguen estimadas. En una visita a Jiménez no hay candidato compatible y se mantiene la referencia oficial. Otros portales y estaciones usan el respaldo esquemático de andenes, sin afirmar un plano real.

El mapa permanente usa colores de troncales. Los tramos tipo_tra=2 del mapa (incluida la Séptima exterior) se consideran corredores de calle de contexto, conservando esa clasificación de origen. Para los demás segmentos de calle se resta una franja de 18 m alrededor de los corredores ya dibujados a los trazados duales; el resultado se dibuja gris discontinuo. Las rutas seleccionadas conservan todos sus giros y su geometría exacta. Esta capa de contexto no cambia longitudes ni autoriza conexiones nuevas.

Los 20 registros de datos pendientes se mantienen por petición expresa. Los semáforos con evidencia directa se incorporan con ciclos expresamente estimados; las fases y coordinación reales permanecen sin corroborar. También siguen pendientes OD, asignaciones reales de flota/vagones, planos de otras estaciones, patios e inventarios oficiales y recorridos en vacío.

El procedimiento completo para **reemplazar** una fuente cuando el sistema real cambie
está en [ACTUALIZAR_DATOS.md](ACTUALIZAR_DATOS.md). Lo que sigue solo regenera los
artefactos a partir de las instantáneas ya archivadas.

## Reproducir sin volver a descargar

Desde la raíz del proyecto, con Python y shapely/pyproj instalados. En el equipo actual existe `../../work/venv/bin/python`:

```sh
../../work/venv/bin/python tools/build_services.py
../../work/venv/bin/python tools/build_context.py
../../work/venv/bin/python tools/build_station_layouts.py
python3 tools/import_passenger_profiles.py
node --test app/tests/*.test.mjs
../../work/venv/bin/python -m unittest discover -s tests
node app/tests/operation-benchmark.mjs --save
node app/tests/operation-benchmark.mjs --stress --save
```

Para regenerar el agregado de pasajeros, descarga el ZIP enlazado a un directorio de trabajo fuera de Git y ejecuta `python3 tools/aggregate_validations.py /ruta/validacionTroncal20260909.zip`. Después ejecuta el importador de perfiles. El agregador solo exporta estación, hora, totales y procedencia; valida formato y fechas antes de escribir. No añadir el ZIP ni el CSV crudo a Git.

Las nuevas descargas se hacen con `fetch_services.py`, `fetch_service_supplement.py` y `fetch_dual_stops.py`. Revisar sus manifests y actualizar el selector de instantánea y las reglas curadas antes de sustituir los datos de una versión. Los scripts de suplemento y perfiles reflejan expresamente esta fecha de entrega; no son un proceso automático de actualización diaria.


## Hito de portales, semáforos y planificación — 11 sep. 2026

Esta actualización amplía la revisión anterior: los nueve portales tienen geometría OSM disponible y se conservan Banderas, Ricaurte y Avenida Jiménez. [Inventario, objetos y límites](TODOS_LOS_PORTALES_20260911.md). Hay 191 visitas compatibles de 201 en esas doce estaciones; las otras conservan la referencia del servicio. Los nodos de parada no se inflan en plataformas inventadas.

Se incorporan 450 señales con pertenencia directa a vías de buses OSM; 449 tienen asociación operativa por distancia, eje y sentido. La existencia está documentada; el ciclo de 90 s, con 52 verde / 3 amarillo / 35 rojo, es un parámetro de escenario estimado. No hay coordinación real ni cola longitudinal microscópica en cada cruce. [Evidencia e implementación](SEMAFOROS_20260911.md).

El [planificador](PLANIFICADOR.md) consulta toda la red utilizable para fecha/hora, con hasta dos transbordos y seis horas de horizonte, sin cambiar la simulación. Frecuencias, caminatas y duración son aproximadas; no predice aforo ni fases. Los registros pendientes continúan excluidos de la búsqueda.
