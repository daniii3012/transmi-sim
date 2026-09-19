# Tipo de bus por servicio, leído de la flota

12 de septiembre de 2026. Hasta hoy el simulador decidía la carrocería por la longitud del
recorrido: 18 km o más, biarticulado; menos, articulado. Ese umbral no salía de ningún dato. Este
documento reemplaza esa regla por una lectura de la flota que atiende cada servicio, y deja escrito
qué queda probado, qué queda estimado y cómo se vuelve a comprobar.

## Ninguna fuente publica la carrocería

Antes de deducir nada se revisó lo que hay descargado:

| Fuente | Qué dice del vehículo |
|---|---|
| GTFS publicado (`routes`, `trips`, `stops`, `frequencies`) | Nada. `route_type=3` para todo el sistema |
| API del buscador de rutas (`rutaDetalle`, 132 rutas) | Nada. Color, nombre, estaciones, horario y trazado |
| Tableros de salida de 139 estaciones | Nada. Línea, operador, destino y hora |
| API de posiciones configurada en local | `ocupacion_bus` es categórica, no un aforo |
| Lecturas de posición de la flota | Identificador, **etiqueta de flota** y placa |

La etiqueta es el único dato por vehículo que existe, y es la que el bus lleva pintada.

## La etiqueta y su cero de relleno

El `VehicleDescriptor` dlas lecturas traen tres campos. El proyecto leía el 1 (identificador) y el
3 (placa), y descartaba el 2, que es la etiqueta: `E0067`, `K10657`, `D0204`. El feed escribe un
cero que el vehículo no lleva —`K10657` en las lecturas de posición es **K1657** en la calle— y las dos formas
se convierten una en otra sin ambigüedad. El identificador también la reconstruye, con un
desplazamiento fijo por bloque, que es como se clasificaron las capturas anteriores a esta fecha.

Desde esta fecha la etiqueta se guarda tal como viene, además del identificador. Cuando una lectura
trae las dos formas, `classify_fleet.py` las compara y cuenta las discrepancias en su salida: sobre
todas las lecturas salieron cero.

## Las tres familias y sus rangos

Series vistas el 12 de septiembre, en notación de calle:

| Serie | Articulados | Biarticulados | Duales |
|---|---|---|---|
| E | E2–E40, E301–E310 (15) | E50–E173 (77) | E702–E756 (30) |
| D | D1–D48 (23) | D100–D237 (85) | D500–D596 (44) |
| N | N1–N36 (16) | N100–N191 (54) | N532–N634 (74) |
| A | A1002–A1179 (102) | A1401–A1460 (32) | — |
| T | T1001–T1200 (111) | T1402–T1640 (140) | — |
| U | U1001–U1096 (47) | U1401–U1562 (98) | — |
| M | — | M1401–M1514 (65) | — |
| S | — | S1403–S1530 (76) | — |
| K | — | K1411–K1661 (153) | — |
| BO, KE | — | — | BO903–BO924, KE900–KE924 (29) |

Entre un grupo y el siguiente no hay un solo vehículo: la serie T salta de 1200 a 1402, la A de 1179
a 1401, la E de 40 a 50 y de 173 a 301. Los rangos que usa la herramienta son algo más anchos que lo
observado, y un vehículo que caiga fuera de todos ellos sale listado como sin clasificar en vez de
repartirse al rango más cercano.

## Por qué la partición es del vehículo y no del patio

Cuatro comprobaciones, ninguna de las cuales depende de las otras:

1. **Servicios que nunca ven una familia.** En 723.363 lecturas de una jornada, 21 servicios
   troncales no recibieron ni un vehículo de la familia alta, y entre ellos están los siete
   servicios fáciles 1, 3, 4, 5, 6, 7 y 8. El servicio 2, en cambio, no recibió ni uno de la baja.
   Ningún servicio queda a medio camino: los 76 son de una familia o de la otra, sin excepción.
2. **La familia dual coincide con una clasificación oficial.** De los 177 vehículos de las familias
   E700, D500, N500–N600 y BO/KE900, **ninguno** atendió jamás un servicio troncal; de los 1.094 de
   las otras dos familias, **ninguno** atendió jamás uno dual. La agencia del GTFS separa esos
   servicios y la numeración cae exactamente sobre esa frontera, sin que este análisis interviniera.
3. **Un servicio se nutre de muchas series.** J23 recibió 41 vehículos de siete series distintas
   (E, D, U, T, M, S, K) y los 41 caen del mismo lado. Si el corte fuera del operador o del patio,
   un servicio con siete operadores saldría revuelto.
4. **Las placas separan lotes.** Los 32 vehículos A1401–A1460 llevan placa GUV sin excepción; los
   102 de A1002–A1179 llevan FVK y GUW. Son compras distintas, no una renumeración interna.

Con los cortes de cada serie aplicados, **los 87 servicios con lecturas quedan de un solo tipo**, sin
una sola mezcla. Esa coherencia entre nueve series independientes es la prueba de que los cortes
separan algo real del vehículo.

## Resultado

Jornada del sábado 12 de septiembre de 2026: 1.271 vehículos, 314 articulados, 780 biarticulados y
177 duales.

**Servicios de articulado (21):** 1 · 3 · 4 · 5 · 6 · 7 · 8 · B13 · B23 · B72 · B74 · C17 · H13 ·
H17 · H72 · H83 · J74 · K23 · M83 · S48 · Z61

**Servicios de biarticulado (55):** 2 · A60 · B10 · B11 · B12 · B16 · B18 · B28 · B46 · B75 · C15 ·
C19 · C25 · C30 · D10 · D20 · D21 · D22 · D24 · E32 · E42 · F19 · F23 · F26 · F28 · F32 · F51 · F60 ·
G11 · G12 · G22 · G30 · G47 · G53 · H15 · H20 · H21 · H54 · H75 · J23 · J24 · K10 · K16 · K43 · K54 ·
L10 · L18 · L25 · L41 · M47 · M51 · S41 · S42 · S43 · S46

Los 11 servicios duales restantes conservan su familia propia; F63/Z63 mantienen además su perfil
publicado de 160 plazas, que es más específico que la familia.

Contra la regla de 18 km que se retira: **51 aciertos y 25 errores** de 76 servicios troncales. Nueve
recorridos largos que la regla daba por biarticulados son de articulado (B13 26,6 km · B23 22,9 ·
B72 29,5 · C17 30,6 · H13 25,8 · H17 30,1 · H72 29,3 · K23 21,9 · Z61 24,9) y dieciséis cortos que
daba por articulados son de biarticulado, entre ellos F23 y J23 con 14,4 km.

## Lo que queda estimado

- **El nombre de cada familia.** La partición está demostrada; que la familia alta sea el
  biarticulado se apoya en lo que se ve en la calle —los servicios 1–8 y el 2, F23 y J23— y no en un
  padrón de flota, que nadie publica. Un padrón oficial puede confirmarlo o desmentirlo sin tocar la
  partición.
- **La proporción.** 780 de 1.094 vehículos troncales en la familia alta es el 71 % de lo que salió
  a operar ese sábado. Conviene contrastarlo contra un conteo publicado de flota.
- **La primera lectura fue de un solo día, y sábado.** Con lecturas de más tipos de día se
  confirmó que ningún servicio cambia de familia.
- **Rangos sin observar.** E200–E299, D238–D499 y N192–N499 no aparecieron. M, S y K no mostraron
  ningún vehículo por debajo de 1200: o no lo tienen, o no salió ese día.
- **Series que no son troncales.** BC202–BC295, BO118–BO204, CO620–CO666, SO106–SO133, TZ122–TZ134 y
  los D por encima de 1000 solo aparecieron en servicios alimentadores y zonales, así que este
  análisis no los clasifica.
- **34 servicios del catálogo sin lecturas** —22 utilizables y 12 pendientes— no reciben perfil: se
  dibujan con el articulado de referencia y su ficha lo declara estimación, no observación.
- **La capacidad** sigue siendo de modelo: 80, 160 y 240 plazas. Lo que se leyó es el tipo, no el
  aforo.

## Cómo se reproduce

```
python3 tools/classify_fleet.py               # data/curated/fleet_types.json
python3 tools/build_services.py               # adjunta vehicle_profile a cada ruta
node --test app/tests/*.test.mjs && python3 -m unittest discover -s tests
```

`classify_fleet.py` lee las lecturas de posición en crudo, que no se versionan: sin ellas el paso
queda documentado pero no se puede volver a correr, y lo que el simulador usa es el
`fleet_types.json` ya derivado.

`classify_fleet.py --dry-run` resume sin escribir. La salida lista siempre los servicios sin
resolver, las etiquetas fuera de rango y las discrepancias entre etiqueta publicada y reconstruida:
si aparece una serie nueva, se ve ahí antes de entrar al modelo.

Captura y límites de las lecturas de posición en la captura de lecturas de posición; efecto en la
operación en [modelo y fuentes](OPERACION_Y_DATOS.md).
