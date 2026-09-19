# Geometrías físicas de estaciones — OSM, 11 de septiembre de 2026

Esta nota documenta el corte acotado de geometría física usado para el simulador 2D. Se consultó OpenStreetMap mediante [Overpass](https://overpass-api.de/) el 11 de septiembre de 2026, con un radio de 450 m alrededor de seis estaciones lógicas de `app/dist/services.json`. La instantánea reproducible está en `data/raw/station_layouts/20260911T025000Z/overpass.json`; su SHA-256 es `a6d95ad00ec36f5fd94799a8e37abb8f4fe51308524388e59dfceac83a3eb349`. El servidor reportó `timestamp_osm_base=2026-06-01T08:52:28Z`.

La salida curada está en `data/curated/station_layouts.json` y se copia a `app/dist/station_layouts.json`. Usa el mismo marco métrico AEQD que la red: origen `(-74.136, 4.63027)`, eje x hacia el este, eje y hacia el norte. Cada plataforma conserva su URL OSM, tipo/ID, etiquetas, puntos proyectados, `closed`, centroide, eje largo y longitud. La longitud y el ancho derivados de un polígono describen la geometría OSM; no son plazas, vagones ni dimensiones publicadas.

## Resultado por estación

| ID lógico | Estación | Plataformas OSM | Áreas OSM separadas | Líneas internas OSM |
|---|---|---:|---:|---:|
| `7000` | Portal Sur - JFK Coop. Financiera | 27 (3 polígonos, 21 posiciones troncales, 3 alimentadores) | 1 | 38 |
| `3000` | Portal Suba | 11 (2 polígonos, 8 posiciones troncales, 1 nodo plataforma) | 1 | 23 |
| `5000` | Portal Américas | 27 (3 polígonos, 20 posiciones troncales, 4 alimentadores) | 4 | 31 |
| `5100` | Banderas | 13 (4 líneas de plataforma, 1 polígono alimentador, 8 posiciones troncales) | 1 | 9 |
| `7111` | Ricaurte | 0 plataformas TransMilenio explícitas; 9 áreas | 9 | 2 |
| `9110` | Avenida Jiménez | 0 plataformas TransMilenio explícitas; 5 áreas | 5 | 8 |

Los polígonos explícitos son: Portal Sur `Plataforma 1–3` (ways OSM `1007742131`, `1007742130`, `1007742129`); Portal Suba `Plataforma 1–2` (ways `500232610`, `500232613`); Portal Américas `Platafoma 1–3` (ortografía conservada de OSM; ways `1422321666`, `1422321670`, `1422321671`); y Banderas `Plataforma Alimentadores 2` (way `1455197150`). En Banderas también se conservaron cuatro ways abiertos (`1298661404`, `1298661405`, `1298662505`, `1298662506`) etiquetados por OSM como `bus=yes + public_transport=platform`; al no tener huella cerrada, se marcan como `closed=false`, confianza media y no se les inventa ancho.

Ejemplos verificables: [Portal Sur Plataforma 1](https://www.openstreetmap.org/way/1007742131), [Portal Suba Plataforma 1](https://www.openstreetmap.org/way/500232610), [Portal Américas Plataforma 1](https://www.openstreetmap.org/way/1422321666) y [Banderas Plataforma Alimentadores 2](https://www.openstreetmap.org/way/1455197150). El JSON contiene el enlace OSM de cada vector, incluidos nodos y líneas internas.

Portal Sur y Portal Américas tienen múltiples posiciones de parada OSM (`public_transport=stop_position`) y llegadas de alimentadores. Se guardan como puntos individuales para no convertir la cantidad de vagones publicada en una fila única ni asignar un servicio a una plataforma. Portal Suba tiene dos polígonos de plataforma y posiciones puntuales; OSM no ofrece huella para cada posición.

Ricaurte y Avenida Jiménez se relacionan con el registro lógico por proximidad y nombre normalizado de la relación de estación TransMilenio. Ricaurte aparece como una relación de estación multiparte alrededor de Av. NQS/Calle 13, y Jiménez como una relación con componentes en el eje de Caracas y accesos; sus miembros se conservan en `areas` con roles `station_area`/`station_entry`, nunca como plataformas. La ausencia de una plataforma TransMilenio explícita en OSM se deja como ausencia de dato. No se afirma qué ruta usa qué emplazamiento o vagón.

## Método y filtros

`tools/fetch_station_layouts.py` descarga solo objetos vectoriales pequeños: nodos `platform`/`stop_position`, relaciones `station`/`stop_area`, ways `highway=busway|service` y miembros de relaciones de estación. `tools/build_station_layouts.py` proyecta coordenadas con `tools/geo.py`, relaciona cada objeto al centro oficial más cercano dentro de 450 m y usa nombre/operador/red OSM para separar TransMilenio de SITP y Metro. Los ways `service`/`busway` cercanos se publican en `internal_lines`, conservando `oneway`, `layer`, `access`, `bus` y demás etiquetas. Un `service=parking_aisle` se excluye.

Una relación o polígono de estación/edificio se conserva en `areas`; no se dibuja como andén. Un nodo u open way OSM permanece abierto. Los ejes, centroides, longitud y ancho son derivados geométricos para orientar el dibujo y no implican asignación operacional. Los cruces espaciales no crean conexiones de ruta.

## Fuentes secundarias y límites

La página [Portal Sur – JFK Coop. Financiera](https://sitp-bogota.com/portal-del-sur-transmilenio/) se revisó como referencia secundaria. Publica una imagen titulada “Mapa de la Estación Portal Sur Transmilenio” y una lista de rutas; indica una actualización de 17/05/2026. La imagen no trae un identificador OSM, coordenadas ni una licencia/escala verificable en la página, así que no se usó para generar puntos o polígonos. La geometría curada se apoya en los objetos OSM enlazados individualmente y conserva la atribución ODbL: © OpenStreetMap contributors.

Este corte no descarga tiles, fotos ni edificios genéricos. OSM puede estar incompleto, desactualizado o representar una plataforma solo como nodo/línea; por eso Ricaurte y Jiménez no reciben huellas inventadas y las formas de los portales no se interpretan como número de vagones. La ampliación a otras estaciones requiere otra consulta y revisión de nombres/operador.
