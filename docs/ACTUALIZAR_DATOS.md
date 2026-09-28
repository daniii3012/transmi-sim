# Cómo se obtuvieron los datos y cómo actualizarlos

Este documento es el procedimiento para mantener el simulador al día cuando cambie
la realidad: un trazado nuevo, una estación movida, una calzada reconstruida, un
semáforo distinto o un horario republicado. Explica de dónde sale cada dato, con qué
herramienta, y qué hay que ejecutar y revisar para reemplazarlo.

Complementa a [OPERACION_Y_DATOS.md](OPERACION_Y_DATOS.md), que describe el modelo y
sus hipótesis, y a [Operación y datos](OPERACION_Y_DATOS.md), que registra procedencia y licencias.

## Reglas que no cambian

1. **La descarga y la curación están separadas.** Un script `fetch_*` solo guarda una
   instantánea cruda con su manifiesto y SHA-256. Un script `build_*` solo lee esa
   instantánea y produce el dato curado. Ningún script descarga por su cuenta al jugar.
   **Los `fetch_*` no viajan en este repositorio**, y tampoco la herramienta que grabó las
   lecturas de posición de la flota: lo que se publica es la instantánea con su hash y el
   dato curado que sale de ella. Este documento conserva sus nombres y sus parámetros como
   registro del método, para que se sepa exactamente de dónde salió cada cifra y qué habría
   que rehacer. Los `build_*` sí están: lo que necesitan es la instantánea cruda
   correspondiente, que tampoco se versiona —son cientos de MB— y hay que volver a descargar
   antes de reconstruir. Lo que viaja aquí es el resultado curado, con su procedencia y su
   SHA-256 escritos dentro.
2. **Las instantáneas no se sobrescriben.** Cada descarga crea una carpeta nueva
   `AAAAMMDDTHHMMSSZ` bajo `data/raw/`, que está ignorada por Git. Las anteriores se
   conservan en el disco: son la evidencia de lo que se afirmó en su momento, y el dato
   curado guarda el hash de aquella con la que se construyó.
3. **El nombre de la carpeta es un identificador, no la hora de consulta.** La hora
   real está en `queried_at` dentro del manifiesto.
4. **Nunca se inventa geometría.** Si la fuente no publica un trazado, el registro
   queda pendiente. No se unen paradas con líneas rectas ni se deducen recorridos por
   cercanía. Lo mismo aplica a plataformas: un punto de parada no se convierte en un
   polígono.
5. **Lo publicado y lo estimado se distinguen siempre**, en el dato y en la interfaz.
6. **Las fuentes tienen que ser contemporáneas entre sí.** La demanda se calibra con
   validaciones del mismo momento que el catálogo de servicios, no con las más abundantes
   ni con las más fáciles de conseguir. La red física cambia en cuestión de meses: entre
   marzo y septiembre de 2026 desaparecieron las estaciones Calle 76 y Calle 45 y apareció
   Calle 72 - Areandina. Mezclar periodos asigna demanda a estaciones que el catálogo ya no
   tiene. Ver [DEMANDA_COMPARACION_MARZO_20260911.md](DEMANDA_COMPARACION_MARZO_20260911.md).
7. **Ninguna cifra se escribe a mano.** Los conteos que muestra la aplicación se calculan
   desde la instantánea. Si un número aparece como literal en un script o en el HTML, es un
   error: dejará de ser cierto en la siguiente descarga sin que nada avise.
8. **Cada cambio de fuente se acompaña de pruebas.** Ver *Comprobación obligatoria*.

## Entorno

```sh
../../work/venv/bin/python --version   # Python con shapely y pyproj
node --version                         # Node en el PATH
```

El Python del sistema sirve la web pero no trae las bibliotecas geográficas. En este
equipo el intérprete con shapely/pyproj está en `../../work/venv/bin/python`, y así
aparece en los comandos de abajo. Las herramientas que no proyectan coordenadas
funcionan con `python3`. Todos los comandos se ejecutan desde la raíz del proyecto.

## La cadena de datos

```
fuente oficial  ──fetch_*──▶  data/raw/<instantánea>/  ──build_*──▶  data/curated/  ──▶  app/dist/
                              manifiesto + SHA-256                    + data/processed/ (auditorías)
```

`app/dist` es lo que sirve el navegador. Para los archivos que existen en los dos
lados, la copia de `app/dist` debe ser byte a byte idéntica a la de `data/curated`;
los `build_*` escriben ambas.

| Dato | Fuente | Descarga | Curación | Resultado |
|---|---|---|---|---|
| Rutas, paradas, horarios, trazados, colores | Catálogo público de rutas de TRANSMILENIO | `fetch_services.py`, `fetch_service_supplement.py` | `build_services.py` | `app/dist/services.json` |
| Paraderos de calle de los duales | Capa oficial de paraderos SITP | `fetch_dual_stops.py` | (lo consume `build_services.py`) | dentro de `services.json` |
| Contexto urbano: vías, parques, agua | OpenStreetMap / Overpass | (consulta registrada en `data/raw/context`) | `build_context.py` | `app/dist/context.json` |
| Sentido de salida y descenso por estación | Validaciones diarias SITP (datos abiertos) | archivos oficiales fuera del repositorio | `build_od_matrix.py` y `build_od_profiles.py` | `app/dist/od_profiles.json` |
| Edificios de la vista 3D | Mapa de Referencia (IDECA / UAECD), capa Construcción | descarga fuera del repositorio | `build_buildings.py` | `app/dist/buildings/` |
| Geometría física de estaciones y portales | OpenStreetMap API 0.6 y Overpass | `fetch_station_layouts.py` | `build_station_layouts.py` | `app/dist/station_layouts.json` |
| Salidas programadas de cada servicio | GTFS abierto de TRANSMILENIO S.A. | `fetch_gtfs.py` | `build_schedule.py` | `app/dist/schedule.json` |
| Tipo de vehículo por servicio | Lecturas de posición de la flota, desde el 12 sep 2026 | herramienta de captura, fuera del repositorio | `classify_fleet.py` | `data/curated/fleet_types.json` |
| Velocidad de cada trecho de corredor | Las mismas lecturas | ídem | `build_speed_field.py` | `data/curated/speed_field.json` |
| Tiempo real entre parada y parada | Las mismas lecturas | ídem | `build_observed_times.py` | `data/curated/observed_times.json` |
| Semáforos en calzada de buses | OpenStreetMap API 0.6 | `fetch_busway_signals.py` | `build_busway_signals.py` | `app/dist/busway_signals.json` |
| Calzada y carriles de TransMilenio | OpenStreetMap / Overpass | `fetch_busway_lanes.py` | `build_busway_lanes.py` | `app/dist/busway_lanes.json` |
| Carriles medidos y puentes sobre la calzada | Mapa de Referencia (IDECA / UAECD): Calzada, Puente y Malla Vial | `fetch_idu_calzada.py` (consulta a 15 m de cada tramo de la red) | `build_busway_geometry.py` | `app/dist/busway_geometry.json` |
| Punto de atención de cada servicio: vagón y puertas | Tablero de salidas publicado por estación | `fetch_station_departures.py` | `build_station_wagons.py` | `app/dist/station_wagons.json` |
| Demanda de pasajeros | Validaciones diarias SITP, Datos Abiertos Bogotá | descarga manual del ZIP | `aggregate_validations.py` y luego `import_passenger_profiles.py` | `app/dist/demand.json` |
| Three.js | npm oficial, versión fijada | `vendor_three.py` | — | `app/dist/vendor/` |

Herramientas de solo lectura que no escribían en el catálogo, y que tampoco viajan aquí:
`audit_routes.py` (contrastaba el catálogo publicado) y `probe_pending_routes.py` (revisaba
si los registros pendientes ya tenían trazado publicado).

## En qué orden hay que reconstruir

Las fuentes no son independientes. `services.json` está aguas arriba de casi todo, así que
un cambio de rutas obliga a rehacer lo que se apoya en él aunque su propia descarga no haya
cambiado:

```
services.json  ──▶ busway_signals.json   (las señales se filtran por distancia a los recorridos)
               ──▶ signal_associations    (depende de rutas y señales a la vez)
               ──▶ busway_lanes.json      (las calzadas se recortan por distancia a los servicios operados)
               ──▶ station_layouts.json   (la selección --stations N se ordena por número de servicios)
               ──▶ demand.json            (los perfiles se enlazan por estación del catálogo)
```

Orden seguro tras tocar el catálogo de servicios:

```sh
../../work/venv/bin/python tools/build_services.py
../../work/venv/bin/python tools/build_busway_signals.py --raw data/raw/busway_signals/<instantánea>
node tools/build_signal_associations.mjs
../../work/venv/bin/python tools/build_busway_lanes.py
python3 tools/import_passenger_profiles.py
```

`station_layouts` solo hace falta rehacerlo si quieres que la selección de las estaciones
más concurridas se recalcule con el catálogo nuevo; conservar la anterior es válido y no
rompe nada.

## Actualizar según lo que cambió

### Cambian rutas, horarios, paradas o trazados

Es el caso más frecuente: TransMilenio republica el catálogo con vigencias nuevas.

```sh
python3 tools/fetch_services.py
python3 tools/fetch_service_supplement.py
python3 tools/fetch_dual_stops.py
```

Cada uno crea su carpeta nueva bajo `data/raw/`. **La descarga no basta:** hay que
apuntar la curación a la instantánea nueva editando el puntero correspondiente.

```sh
cat data/raw/services/latest.json      # {"snapshot": "20260910T185326Z"}
cat data/raw/dual_stops/latest.json
```

Cambia el campo `snapshot` por el nombre de la carpeta nueva. `build_services.py` no pierde lo que
la instantánea nueva trae incompleto: un registro publicado sin trazado, una variante de Ciclovía
que dejó de listarse o un trazado nuevo que deja las paradas a kilómetros se toman de la instantánea
anterior más reciente que sí los tenga, y `detail_snapshot` dice de cuál. Los paraderos de calle no
se cambian a ciegas: la capa del 28 sep. 2026 reasignó códigos de cenefa y dejaba paradas a varios
kilómetros de su recorrido, así que sigue la del 10 sep. Comparar las dos antes de mover el puntero.

Después revisa la
curación en `data/curated/services.json`, que es donde viven las decisiones humanas:

- `excluded`: registros que no entran y por qué. Hoy están la C15 zonal (366) y la
  F23 de Banderas (10082). El motivo de cada uno se escribe ahí y es lo que la
  aplicación muestra en el panel Datos, así que se redacta para quien la usa, no como
  nota interna: nada de nombres propios ni de a quién se le ocurrió.
- `pairs`: qué identificadores son los dos sentidos de un mismo servicio. Nunca
  copian geometría ni activan registros pendientes.

Si el catálogo nuevo trae identificadores distintos, esas reglas hay que revisarlas
antes de reconstruir. Luego:

```sh
../../work/venv/bin/python tools/build_services.py
```

Escribe `app/dist/services.json` y la auditoría `data/processed/services_audit.json`.
Un registro queda `ready:false` cuando le falta trazado, cuando la secuencia de
paradas es insuficiente, cuando una referencia de parada queda a más de 1.200 m del
tramo publicado, o cuando una variante Ciclovía trae calendario ambiguo. Esos casos
**se dejan pendientes**: ver [PENDIENTES_20260911.md](PENDIENTES_20260911.md).

Como los semáforos se asocian a los recorridos, después de cambiar `services.json`
hay que recurar las señales y regenerar su auditoría (ver más abajo) aunque la descarga
de OSM no haya cambiado.

#### Reimportar unos pocos registros sin rehacer el catálogo

Cuando un registro concreto gana trazado, o llegó recortado, no hace falta —ni
conviene— volver a bajar el catálogo entero: eso cambiaría todos los demás al mismo
tiempo.

```sh
python3 tools/refresh_route_details.py 12444 1213 629 --reason "por qué"
../../work/venv/bin/python tools/build_services.py
```

Descarga el detalle publicado solo de esos identificadores a
`data/raw/services/refresh_<instantánea>/`, con manifiesto y SHA-256 por respuesta, y
deja el puntero `data/raw/services/refresh_latest.json`. `build_services.py` prefiere
ese detalle para esos identificadores y **toma el resto de la metadata, vigencia
incluida, de la instantánea base**. Cada ruta queda con `detail_snapshot`, que dice de
qué carpeta salió su detalle. Para volver atrás basta borrar el puntero.

### Vagón de cada parada

```sh
../../work/venv/bin/python tools/build_wagon_stops.py
```

Lee el ZIP del GTFS en `data/raw/gtfs/`: las paradas hijas de cada estación troncal (una por vagón y
juego de puertas, con coordenadas) y, en `stop_times`, en cuál para cada viaje. Guarda por servicio la
secuencia de paradas de vagón en `wagon_stops.json`. Se rehace con cada GTFS nuevo, después de
`build_schedule.py`, que es el que empareja las rutas.

### Puentes y deprimidos de la calzada

```sh
# descarga de OSM fuera del repositorio: vías de TransMilenio con bridge, tunnel o layer
../../work/venv/bin/python tools/build_busway_structures.py
```

Toma la instantánea más reciente de `data/raw/busway_structures/` y guarda cada puente o deprimido
con su nivel y sus carriles, proyectado, en `busway_structures.json`.

### Calzada que ningún recorrido usa

```sh
# descarga de OSM fuera del repositorio: todas las vías de TransMilenio
../../work/venv/bin/python tools/build_busway_context.py
```

Guarda los trozos de calzada de TransMilenio a más de 6 m de todo recorrido utilizable (la media
glorieta de Banderas, vías internas de portales, accesos a patios) en `busway_context.json`; el mapa
los dibuja como calzada sin buses.

### Patios troncales

```sh
# descarga fuera del repositorio: capa Patios SITP (20) del Mapa de Referencia
../../work/venv/bin/python tools/build_depots.py
```

Guarda los 15 patios troncales con su polígono en `depots.json`. El mapa los dibuja y los llena con
los buses que no están en servicio a esa hora, repartidos por área: el simulador no sabe de qué patio
sale cada bus.

### Correcciones observadas en la calle

`data/curated/field_corrections.json` (y su copia en `app/dist`) guarda lo que se observó en sitio y
los datos abiertos no recogen todavía: por ahora, semáforos que no existen para un sentido. Cada
entrada lleva dónde, qué, por qué y la fecha. Se edita a mano; cuando OSM lo corrija, la entrada
sobra y se borra. También lleva las paradas que un GTFS nuevo todavía no trae (`stops_added`; Patio
Bonito estuvo ahí del 19 al 28 de septiembre de 2026): se insertan en el recorrido y el tiempo del
tramo publicado se reparte según la distancia. Con un paquete GTFS nuevo que ya las incluya, se borran.
Y las bifurcaciones con un carril por rama (`lane_splits`): los últimos metros antes de separarse
tienen dos carriles, los que giran se pasan al de la izquierda y los demás siguen sin quedar detrás
de su fila; hoy, la NQS hacia el norte antes de la conexión a la Calle 26.

### Edificios de la vista 3D

```sh
# descargas fuera del repositorio: construcciones a 350 m de la calzada exclusiva y una muestra
# del 30 % de toda la ciudad
../../work/venv/bin/python tools/build_buildings.py
```

La descarga consulta la capa Construcción del Mapa de Referencia a lo largo de cada tramo
exclusivo, en piezas de 700 m, y guarda `data/raw/construcciones/<instantánea>/` con su
manifiesto y SHA-256. `build_buildings.py` toma la huella exterior de cada construcción,
la simplifica a 0,4 m, descarta las de menos de 12 m² y le da 3 m por piso
(`CONNPISOS`). Las agrupa en teselas de 1 km por centroide, en binario (formato en el
propio script), con `index.json` de procedencia. La vista 3D pide solo las teselas cerca
de la cámara.

Más allá de esa franja, `data/raw/construcciones_ciudad/<instantánea>/construccion.jsonl` trae el 30 %
de las construcciones de toda la ciudad, elegidas por `MOD(OBJECTID,10)<3` para que la muestra sea
siempre la misma. El script toma de ella las que la franja no trae (por OBJECTID), con un mínimo de
30 m²: cerca de la troncal la ciudad está entera y lejos, a menor densidad. Hoy son 544.022 edificios
en 600 teselas (14,5 MB); la vista pide teselas hasta 5 km y guarda 72 (2,5 km y 40 en un teléfono).

### Cambia la ubicación o la geometría física de una estación o un portal

```sh
# descarga: herramienta fuera del repositorio, como todos los fetch_*
python3 fetch_station_layouts.py --radius-m 450 --stations 151
../../work/venv/bin/python tools/build_station_layouts.py --keep data/curated/station_layouts.json
```

Desde el 28 sep. 2026 se consultan las 151 estaciones de la red (antes, 40). La
descarga toma las estaciones de `services.json` por número de servicios, con su
`station_id` y su coordenada. `--keep` conserva, estación por estación, la versión
curada anterior cuando tenía más plataformas troncales que la instantánea nueva: una
edición de OSM sacó de la relación de Portal Suba sus plataformas, y sin esto el
portal habría perdido su geometría. Cada estación conservada lleva `source_snapshot`
y la lista queda en `source.kept_from_previous`. La
consulta filtra `public_transport=platform|stop_position|station|stop_area`, vías
`highway=busway|service` y `railway=platform|service`, y acota las relaciones de
estación por nombre para no arrastrar las del Metro.

`build_station_layouts.py` toma la instantánea más reciente de
`data/raw/station_layouts/` salvo que se le pase `--raw`. Proyecta a metros con la
AEQD de `tools/geo.py`, limita las vías internas a 220 m del centro de cada estación,
descarta `service=parking_aisle`, y separa lo que es plataforma de lo que es cubierta
o edificio de ingreso. Marca `confidence=high` cuando OSM identifica TransMilenio o
busway, y `medium` para servicio sin esa etiqueta.

En la aplicación, `station-layouts.mjs` sitúa cada visita de una ruta sobre la
geometría disponible. Si una visita no admite una posición compatible, conserva la
referencia oficial del servicio: no se desvía la ruta para forzar el ajuste.

### Cambia el vagón o la puerta por la que atiende un servicio

```sh
python3 tools/fetch_station_departures.py
python3 tools/build_station_wagons.py
```

Ninguno de los dos necesita el Python geográfico. El primero recorre las estaciones
troncales de `services.json` —**su identificador es el mismo que usa la fuente**, no hay que
traducirlo— y guarda el tablero de salidas de cada una en
`data/raw/station_departures/<instantánea>/`. El segundo deriva el punto de atención y
escribe `station_wagons.json` en `data/curated/` y en `app/dist/`.

Tres cosas que hay que entender antes de tocar los parámetros:

1. **El tablero devuelve las próximas N salidas, no un muestreo de la ventana.** Con
   `MAX_JOURNEYS=60` una estación concurrida enseña doce minutos y pierde la mitad de sus
   servicios. Está en 300, que cubre cerca de una hora. Subirlo no cuesta peticiones, solo
   respuesta más grande. Las cinco franjas de `WINDOWS` existen para alcanzar los servicios
   que solo circulan a ciertas horas, no para muestrear más veces la misma.
2. **El punto va al final del nombre y el nombre de la estación que lo precede no coincide
   con el que el propio tablero da aparte**: `Portal Sur T2` contra
   `Portal Sur - JFK Coop. Financiera`. Por eso `parse()` lee la cola con una expresión
   anclada al final y no recorta prefijos. Las formas conocidas son `A - 2 ó 5`,
   `B 4 ó 6 II`, `C - 2 ó 5-T`, `T5` y `T6A`. Los terminales se prueban primero: `T5` si no
   se leería como vagón T, puerta 5. Lo que no encaje queda en `unparsed` y no se asigna;
   ahí caen las bahías de alimentadores y zonales (`6-1`, `n Molinos 4-1 Bochica`), que no
   son vagones troncales.
3. **Los destinos no se concilian por nombre.** El tablero dice `Portal Norte - Unicervantes`
   y el catálogo `Portal Norte`, `P. Norte` o `P Norte` según el registro. Ambos lados se
   resuelven a la misma estación y se compara el **terminal del recorrido**, que es un
   identificador. Si el destino del tablero no es una estación del catálogo, o si más de un
   servicio con ese código termina ahí, la salida queda en `unmatched` con el motivo escrito.

Un servicio visto en dos puntos distintos de la misma estación, en el mismo sentido, queda
en `ambiguous` y **conserva la estimación**: no se elige uno de los dos. Lo mismo si el
índice publicado excede los vagones que el catálogo cuenta para esa estación.

En la aplicación, `operation.mjs` usa el punto publicado cuando existe y el reparto
determinista de siempre cuando no, y cada parada lleva `wagonSource` para que la interfaz
pueda rotular cuál es cuál. El panel Datos calcula la cobertura desde el propio archivo.

Las estaciones que la fuente rechaza con HTTP 400 quedan anotadas en el manifiesto.
Compararlas con el catálogo es una comprobación útil por sí sola: en la instantánea del 12
de septiembre de 2026 coincidieron con las nueve que `services.json` marca **En obras**, más
Tibanica - Primavera, Los Laureles e Islandia. Esas tres existen en la fuente con el mismo identificador, pero todavía no publican tablero: son las que
abrieron el 17 de agosto de 2026 con la extensión de la Av. Ciudad de Cali. Ver
[verificación del catálogo](RUTAS_VERIFICACION_20260912.md).

### Cambian las calzadas de TransMilenio o sus semáforos

```sh
python3 tools/fetch_busway_signals.py --services app/dist/services.json
../../work/venv/bin/python tools/build_busway_signals.py --raw data/raw/busway_signals/<instantánea>
node tools/build_signal_associations.mjs
```

El último comando regenera `data/processed/signal_associations.json` reutilizando el
emparejador del motor, `matchSignals`, para no tener dos definiciones de qué cuenta como
coincidencia. **Hay que ejecutarlo también cuando cambien las rutas y no los semáforos**,
porque la asociación depende de las dos cosas. Ese archivo nació sin generador y quedó
desactualizado en silencio hasta el 11 sep. 2026.

`build_busway_signals.py` acepta `--docs` para emitir un resumen generado, pero por
defecto **no escribe documentación**: `SEMAFOROS_20260911.md` se mantiene a mano y el
generador solo produce un esbozo corto que lo reemplazaría entero. Si usas `--docs`,
apúntalo a un archivo aparte.

La descarga cubre la red en celdas de 0,005° derivadas de los puntos de
`services.json`, y amplía la evidencia pidiendo el `way/full` de cada vía candidata y
el nodo de cada semáforo, porque la tangente local se calcula con los nodos vecinos
reales de la vía, no uniendo semáforos lejanos.

Un semáforo se acepta por uno de dos caminos, que se registran por separado en el campo
`carriageway` de cada señal:

- **`busway`**: el nodo pertenece directamente a una vía `highway=busway`, o a una
  `highway=service` con identificación explícita de TransMilenio o acceso exclusivo de
  buses.
- **`street`**: el nodo pertenece a una vía ordinaria abierta a buses y cae dentro de la
  tolerancia de un tramo de calle de un servicio dual. Solo aplica donde el servicio deja
  la troncal; en un corredor troncal los carriles mixtos van paralelos a pocos metros y
  aceptarlos sumaría semáforos que no controlan la calzada del bus.

Las reglas están en `tools/busway_criteria.py`, compartido por el descargador y el
curador para que no se desincronicen. **La cercanía no basta** y los rechazados quedan en
la auditoría del JSON curado. Para activarlo en un recorrido se exige además
distancia ≤12 m (`--max-distance-m`), coseno de tangente ≥0,87 en valor absoluto, y
respeto de `oneway` y `traffic_signals:direction` cuando existen.

OSM no publica fases ni coordinación: el ciclo de 90 s (52 verde, 3 amarillo, 35 rojo)
es un parámetro de escenario declarado como estimado, con desfase reproducible por ID.
Si algún día hay fases oficiales, se cambian ahí y se documenta la fuente.

Detalle completo en [SEMAFOROS_20260911.md](SEMAFOROS_20260911.md).

### Cambia el contexto urbano del mapa

```sh
../../work/venv/bin/python tools/build_context.py
```

Conserva los polígonos reales y las etiquetas explícitas `bridge`, `tunnel`, `layer`
y `junction`. Un cruce de líneas nunca crea una conexión ni un giro.

**Limitación conocida:** este es el único dato sin descarga automatizada. No existe un
`fetch_context.py`; la consulta Overpass del 10 sep. 2026 se hizo a mano y quedó
archivada en `data/raw/context/20260910/osm_overpass_raw.json`. Peor aún, esa ruta está
escrita directamente dentro de `build_context.py`, así que para usar una instantánea
nueva hay que crear la carpeta, guardar la respuesta con su manifiesto y editar la ruta
en el script. Antes de la próxima actualización del contexto conviene escribir el
`fetch_context.py` que falta y cambiar la ruta fija por el mismo puntero `latest.json`
que usan servicios y paraderos.

### Llegan datos nuevos de pasajeros

Descarga los ZIP oficiales a un directorio de trabajo **fuera del repositorio**. La
demanda vigente se mide sobre 14 días (14–27 sep. 2026); para actualizarla conviene bajar semanas completas
de lunes a domingo, para que cada tipo de día tenga varios representantes:

```sh
python3 tools/aggregate_validation_period.py /ruta/validacionTroncal*.zip
python3 tools/import_passenger_profiles.py
```

El agregado de periodo produce un perfil horario por estación **y tipo de día**, con la
media de los días observados, su desviación, mínimo y máximo. El importador lo prefiere
automáticamente; si no existe, vuelve al agregado de un solo día que produce
`tools/aggregate_validations.py`, y en ese caso el motor retoma los factores estimados de
fin de semana. Detalle y límites en [DEMANDA_MULTIDIA_20260911.md](DEMANDA_MULTIDIA_20260911.md).

Al elegir qué días bajar:

- **Contemporáneos del catálogo de servicios.** Es la regla 6 y aquí es donde más duele
  saltársela. Si actualizas las rutas, actualiza también las validaciones al mismo periodo.
- **Semanas completas de lunes a domingo**, para que cada tipo de día tenga varios
  representantes. Con uno o dos sábados la media descansa sobre muy poca evidencia.
- **Un festivo entre semana no es un domingo.** Se midió uno, el 23 de marzo de 2026, y
  quedó 16,5 % por debajo de los domingos de ese mes. El calendario del simulador aún los
  trata igual; si bajas un periodo con varios festivos, es la ocasión de separarlos.
- **Entre días de semana la variación es pequeña**, 1,4 % a 2,0 % según el periodo medido,
  así que no hace falta un mes entero para un buen perfil de día de semana.
- **El nivel sí cambia con la época**: marzo quedó un 7,3 % por debajo de agosto–septiembre,
  de forma uniforme. Los factores por tipo de día, en cambio, apenas se movieron.

Después de importar, comprueba en el panel **Datos** que el periodo y los días observados
que muestra coinciden con lo que bajaste. Esa línea se deriva de `demand.json`, así que si
dice otra cosa es que el importador no tomó el agregado que creías.

Un archivo diario trae unas pocas transacciones con fecha del día anterior o del
siguiente, de servicio que cruza medianoche. Se cuentan bajo el día de servicio del
archivo y el reparto queda registrado en `transaction_dates`.

El agregador valida formato y fechas antes de escribir, y solo exporta estación,
hora, totales y procedencia. **Nunca se añaden el ZIP ni el CSV crudo a Git**; el
agregado versionado basta para reproducir.

### Revisar si un registro pendiente ya se puede activar

```sh
python3 tools/probe_pending_routes.py
```

Consulta el detalle oficial de cada registro pendiente y archiva la evidencia en
`data/research/pending_probe_<instantánea>/`. No toca el catálogo: dice cuáles tienen
ya trazado y paradas publicados. Activarlos sigue exigiendo una instantánea nueva de
servicios y una decisión explícita de curación.

**Las validaciones sirven de segunda fuente.** Si una estación deja de aparecer en los
archivos diarios a partir de cierta fecha, los servicios que van a ella suelen estar
retirados. Así se corroboró que `6/692` y `A60/1187`, ambos hacia Calle 76, dejaran de
publicarse el 21 de agosto de 2026: esa estación desaparece de las validaciones justo
entonces, y en marzo registraba 26.171 al día. Dos fuentes que no se hablan entre sí
diciendo lo mismo valen más que insistir con una.

## Comprobación obligatoria después de cualquier actualización

```sh
node --test app/tests/*.test.mjs
python3 -m unittest discover -s tests
node app/tests/operation-benchmark.mjs --save
node app/tests/operation-benchmark.mjs --stress --save
git diff --check
```

Además, a mano:

1. **Paridad**: `shasum -a256 data/curated/X.json app/dist/X.json` debe coincidir para
   `station_layouts.json` y `busway_signals.json`.
2. **Hashes de las fuentes crudas** contra su manifiesto, incluidos los XML de detalle.
3. **Conteos**: registros totales, utilizables y pendientes; señales aceptadas y
   asociadas; elementos de plataforma, áreas y líneas internas. Si un conteo cambia,
   se actualiza en la documentación que lo cite. No dejar cifras viejas.
   Los que muestra la aplicación salen de `counts` en `services.json` y de `demand.json`,
   y se calculan solos; lo que hay que revisar a mano son los que aparecen escritos en la
   documentación.
4. **Versión de caché**: subir el sufijo `?v=` en `app/dist/*.mjs` e `index.html` si
   cambió código, para que los navegadores no sirvan una mezcla de versiones.
5. **Navegador**: abrir con `ABRIR_SIMULACION_2D.command`, comprobar que no hay errores
   de consola y que las cifras coinciden con el benchmark de Node.
6. **Vigencias**: si la instantánea nueva trae vigencias que vencen pronto, recordar
   que el simulador sigue operando después de esa fecha y lo rotula como *horario
   vencido*. El control está en Operación y el detalle en
   [PLANIFICADOR.md](PLANIFICADOR.md).

## Qué sigue siendo decisión humana

Ningún script decide estas cosas; se revisan y se anotan en la documentación:

- Qué registros se excluyen y por qué.
- Qué identificadores son dos sentidos del mismo servicio.
- Si una variante con calendario ambiguo reemplaza o no las salidas de su familia.
- Qué tipo de vehículo se asume donde no hay asignación publicada.
- Qué se considera evidencia suficiente para activar un registro pendiente.

Mantener esas decisiones visibles es lo que permite que dentro de un año se sepa qué
se midió, qué se supuso y qué cambió.
