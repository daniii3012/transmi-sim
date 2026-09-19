# Geometría física de portales y estaciones — 2026-09-11

> La cobertura creció después a 40 estaciones. Las secciones siguientes describen la
> captura inicial de doce; el inventario vigente está en
> [Ampliación a 40 estaciones](#ampliación-a-40-estaciones--11-sep-2026).

Se completó el inventario físico de los doce portales/estaciones presentes en
`app/dist/services.json`: nueve portales y las tres estaciones intermedias
Ricaurte, Avenida Jiménez y Banderas. El resultado conserva el esquema
`station_id`, `platforms`, `areas` e `internal_lines`; cada vector conserva el
enlace OSM, tipo/ID, etiquetas, relación de origen, centroide y medidas en
metros.

## Método y procedencia

La consulta Overpass del snapshot anterior no estaba disponible durante esta
captura. Para evitar sustituir geometría por estimaciones se usó la API OSM
0.6 (`relation/{id}/full` para relaciones de estación y `map?bbox=...` para
vías internas y nodos de plataforma), con User-Agent del proyecto, el
2026-09-11. Los miembros de relaciones se resolvieron por sus nodos OSM; un
nodo `stop_position` quedó como punto y nunca se convirtió en polígono.

Los elementos se proyectaron mediante la proyección AEQD de `tools/geo.py`.
Las vías internas se limitaron a 220 m del centro de cada portal, con
`highway=service|busway`, excluyendo `service=parking_aisle`; llevan
`confidence=high` cuando OSM identifica TransMilenio/busway y `medium` para
servicio sin esa etiqueta. Las cubiertas y los edificios de ingreso siguen
siendo `areas` y no se mezclan con las plataformas.

Snapshot reproducible:

- `data/raw/station_layouts/20260911T120000Z/overpass.json`
- SHA-256: `16b2e6bf16d78e4eabf50b1f20cf182e853d14abf34270037d2f5f3003ccf02d`
- 1.173 elementos OSM combinados (snapshot previo de seis layouts más las
  relaciones y vectores nuevos).
- Relaciones nuevas: [Portal Norte 19124486](https://www.openstreetmap.org/relation/19124486),
  [Portal 80 20085224](https://www.openstreetmap.org/relation/20085224),
  [Portal Eldorado 13621068](https://www.openstreetmap.org/relation/13621068),
  [Portal Tunal 20085223](https://www.openstreetmap.org/relation/20085223),
  [Portal Usme 20085222](https://www.openstreetmap.org/relation/20085222) y
  [Portal 20 de Julio 8237821](https://www.openstreetmap.org/relation/8237821).

## Conteos y fuentes físicas

| station_id | estación | elementos de parada/plataforma | áreas | líneas internas | plataformas/edificios corroborados |
|---|---|---:|---:|---:|---|
| 2000 | Portal Norte - Unicervantes | 5 | 1 | 19 | nodos `13111167400`, `13111232401`, `13111232403`, `13111232404`, `13111232405`; área `1386008597` |
| 4000 | Portal 80 | 7 | 1 | 37 | plataformas `500300855`, `500300848`; ingreso `944879700` |
| 7000 | Portal Sur - JFK Coop. Financiera | 27 | 1 | 38 | layout existente preservado |
| 3000 | Portal Suba | 11 | 1 | 23 | layout existente preservado |
| 5000 | Portal Américas | 27 | 4 | 31 | layout existente preservado |
| 5100 | Banderas | 13 | 1 | 9 | layout existente preservado |
| 6000 | Portal El Dorado – C.C Nuestro Bogotá | 7 | 2 | 19 | `1423708575` (Plataforma Alimentadores 2); áreas `1423708569`, `1423708572` |
| 7111 | Ricaurte | 0 | 9 | 2 | layout existente preservado; OSM no ofrece polígonos de plataforma corroborados |
| 8000 | Portal Tunal | 2 | 2 | 20 | `1423396691` (Plataforma 1), `1423396692` (Plataforma 2); ingreso `563911785`; cicloparqueadero `660551565` |
| 90004 | Portal Usme | 2 | 1 | 17 | `404795978` (Plataforma 1), `404795977` (Plataforma 2); ingreso `404795976` |
| 9110 | Avenida Jiménez | 0 | 5 | 8 | layout existente preservado; OSM no ofrece polígonos de plataforma corroborados |
| 10000 | Portal 20 de Julio | 2 | 4 | 23 | `394185448` (Plataforma Troncales), `509700109` (Plataforma Alimentadores); ingreso `183580319`; cubiertas `1385164918`, `1385164919`, `1385164920` |

Los polígonos nuevos están enlazados en los propios objetos de
`data/curated/station_layouts.json`. Como comprobación puntual, las etiquetas
OSM de las plataformas 80, Tunal y Usme son `building=bus_station` o
`building=yes`; la plataforma alimentadora de El Dorado y las dos de 20 de
Julio también están vinculadas a sus relaciones de estación. El área de Portal
Norte es la relación multipolígono OSM; allí la fuente abierta expone cinco
`stop_position` de TransMilenio, pero no una huella de plataforma nombrada.

## Límites conocidos

Portal Norte queda utilizable con cinco puntos de parada reales y un área OSM,
pero no se inventó una plataforma rectangular a partir de esos puntos. Para
Ricaurte y Avenida Jiménez se conserva el resultado previo, que documenta
áreas y ejes cercanos sin asignar artificialmente una plataforma. Las líneas
internas son las vías OSM disponibles dentro del radio; no representan
necesariamente cada carril operativo ni el sentido de circulación de la
operación real.

Artefactos generados:

- `data/curated/station_layouts.json` — SHA-256 `30cc4ca1c7edc7d44540ab310be105e3f21d856c7adc20a34dd4bfb77b429cfd`
  tras la ampliación a 40 estaciones descrita al final. La captura de doce
  estaciones tenía `361c4acb0ae079952779163d41d2921f1262e7f160c10996dee4a2df393db3f5`.
- `app/dist/station_layouts.json` — mismo contenido y SHA-256.


Los 103 elementos de `platforms` incluyen nodos y líneas de parada: no equivalen a 103 plataformas físicas. En la aplicación había 191 de 201 visitas a estas doce estaciones con una posición compatible con la geometría disponible; las diez restantes conservaban la referencia de la ruta. Con 40 estaciones son 477 de 648. no se desvían buses ni se inventan conexiones para forzar el ajuste.


## Ampliación a 40 estaciones — 11 sep. 2026

La cobertura se amplió de doce a **40 estaciones**: las doce
anteriores más las 28 troncales con más servicios. Ninguna de las doce originales
perdió geometría; la comprobación compara los conteos antes y después estación por
estación.

Inventario total: **111 elementos de parada/plataforma, 98 áreas y 478 líneas internas**
(687 elementos, frente a 381 con doce estaciones). El archivo curado pasa de
527 KB a 943 KB. De 648 visitas de servicio a estas 40 estaciones, **477 se ubican sobre
la geometría disponible** y 171 conservan la referencia oficial del servicio.

La selección ya no está escrita a mano: `fetch_station_layouts.py --stations 40` toma las
doce de base y completa con las más concurridas según `app/dist/services.json`. Las
consultas van por lotes con pausa y reintento, porque Overpass devuelve 429 y 504 con
este volumen.

| station_id | estación | servicios | paradas/plataformas | áreas | líneas internas |
|---|---|---:|---:|---:|---:|
| 2101 | Toberín | 22 | 0 | 5 | 15 |
| 9122 | Calle 72 - Areandina | 18 | 0 | 0 | 0 |
| 2304 | Héroes - Colmena Seguros | 18 | 0 | 9 | 8 |
| 2200 | Alcalá - Colegio S. Tomás Dominicos | 17 | 0 | 0 | 3 |
| 9116 | Av. 39 | 17 | 0 | 0 | 3 |
| 10005 | Bicentenario | 17 | 0 | 4 | 11 |
| 7107 | Universidad Nacional | 17 | 0 | 0 | 13 |
| 6103 | CAN - British Council | 16 | 0 | 3 | 1 |
| 2105 | Calle 142 | 16 | 0 | 6 | 3 |
| 2303 | Calle 85 - Gato Dumas | 16 | 0 | 0 | 4 |
| 3001 | La Campiña | 16 | 4 | 0 | 7 |
| 4108 | Polo - FINCOMERCIO | 16 | 0 | 3 | 17 |
| 2201 | Prado | 16 | 0 | 3 | 10 |
| 3002 | Suba - Tv. 91 | 16 | 4 | 0 | 3 |
| 2302 | Virrey - Cendiatra | 16 | 0 | 0 | 0 |
| 10002 | Av. Primero de Mayo | 15 | 0 | 0 | 3 |
| 2300 | Calle 100 - Marketmedios | 15 | 0 | 3 | 5 |
| 2104 | Calle 146 | 15 | 0 | 3 | 2 |
| 9100 | Calle 40 Sur | 15 | 0 | 6 | 6 |
| 9119 | Calle 57 | 15 | 0 | 0 | 10 |
| 7006 | General Santander | 15 | 0 | 8 | 39 |
| 10009 | Museo Nacional | 15 | 0 | 3 | 24 |
| 2202 | Calle 127 | 14 | 0 | 2 | 5 |
| 9114 | Calle 26 - Atrio | 14 | 0 | 3 | 13 |
| 6107 | Ciudad Universitaria | 14 | 0 | 2 | 6 |
| 4004 | Granja - cra 77 | 14 | 0 | 0 | 8 |
| 3010 | Puentelargo | 14 | 0 | 0 | 10 |
| 6102 | Salitre El Greco - Vive Claro | 14 | 0 | 3 | 3 |

**Sin geometría en OSM:** Calle 72 - Areandina, Virrey - Cendiatra. Conservan sus vagones esquemáticos; no se inventó nada para rellenar la tabla.

La mayoría de las estaciones intermedias aportan áreas —cubiertas y edificios de
acceso— y vías internas, no polígonos de plataforma nombrados. Por eso su porcentaje de
visitas ubicadas es menor que el de los portales: hay geometría física corroborada, pero
no siempre una huella de plataforma que permita situar el punto de atención.
