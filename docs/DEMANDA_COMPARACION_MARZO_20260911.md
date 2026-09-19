# ¿Es agosto–septiembre representativo? Contraste con marzo — 11 sep. 2026

La demanda del simulador se calibra con 17 días del 24 de agosto al 9 de septiembre de
2026. Quedaba por saber si otro momento del año daría algo distinto. Se midieron **15 días
más, del 9 al 23 de marzo de 2026: 21.156.110 validaciones**, con el mismo agregador y
sin tocar el modelo.

Marzo se eligió a propósito: el **lunes 23 es festivo** (San José, trasladado al lunes) y
el periodo de agosto–septiembre no contenía ningún festivo entre semana.

## Resultado corto

**La forma se mantiene; el nivel baja.** Marzo tiene ~7 % menos validaciones, pero los
factores por tipo de día y el reparto por hora son casi los mismos. La calibración actual
se sostiene.

Y aparecieron dos cosas que no se sabían: **un festivo entre semana no se comporta como un
domingo**, y **la red cambió físicamente entre marzo y septiembre**.

## Nivel y factores

| | ago–sep | marzo | diferencia |
|---|---:|---:|---:|
| Día de semana | 1.878.704 (13 d) | 1.741.031 (10 d) | −7,3 % |
| Sábado | 1.228.340 (2 d) | 1.118.373 (2 d) | −9,0 % |
| Domingo/festivo | 567.472 (2 d) | 503.018 (3 d) | −11,4 % |

Lo importante no es la caída sino que **los factores relativos apenas se mueven**:

| factor sobre el día de semana | ago–sep | marzo |
|---|---:|---:|
| Sábado | 0,654 | 0,642 |
| Domingo/festivo | 0,302 | 0,289 |

Un punto y pico de diferencia. Como el modelo usa el perfil por tipo de día y no un factor
global, esa estabilidad es la que importa: **la manera de calibrar es válida en las dos
épocas**.

La caída además es **uniforme**: la mediana de cambio por estación es −7,3 %, igual que el
total. No es que un corredor se vacíe; es toda la ciudad un poco por debajo. La variación
entre días de semana es pequeña en ambos periodos, 2,0 % en agosto–septiembre y 1,4 % en
marzo.

## El reparto por hora es prácticamente el mismo

En día de semana el pico está a las **06:00 en los dos periodos**, y ninguna hora cambia su
porción del día en más de **0,76 puntos**. El sábado tampoco: la mayor diferencia es 0,49
puntos, aunque el máximo se mueva de las 06:00 a las 07:00 en una curva que ahí es casi
plana.

En domingo/festivo la diferencia es algo mayor en la tarde —marzo queda por debajo entre
las 16:00 y las 19:00—, pero parte de eso lo explica que el promedio de marzo incluye el
festivo del lunes, que como se ve abajo es un día distinto.

## Hallazgo: un festivo entre semana no es un domingo

El calendario del simulador mete domingos y festivos en el mismo tipo de día. Con el lunes
23 de marzo se puede comprobar por primera vez:

| | validaciones | sobre el día de semana |
|---|---:|---:|
| Domingos de marzo | 532.316 | 0,306 |
| **Festivo lunes 23 (San José)** | **444.421** | **0,255** |

El festivo está **16,5 % por debajo de un domingo**. Al tratarlos igual, el escenario
genera de más en cada festivo entre semana: unos veinte festivos al año en Colombia.

Corregirlo significaría separar el tipo de día en tres y no en dos —día de semana, sábado,
domingo, festivo entre semana—, tocando `calendar.mjs`, el agregador y `demand.json`. Con
una sola observación de festivo **no lo haría todavía**: haría falta medir varios festivos,
y conviene comprobar si un festivo de lunes se parece a uno de mitad de semana. Queda
anotado como mejora con evidencia, no como hecho consolidado.

## Hallazgo: la red cambió entre marzo y septiembre

Los dos periodos **no comparten el mismo conjunto de estaciones**, así que no se pueden
mezclar validación a validación:

| Estación | marzo | ago–sep |
|---|---|---|
| Calle 76 | sí (26.171) | **no** |
| Calle 45 | sí (13.898) | **no** |
| Calle 72 - Areandina | **no** | sí (32.056) |
| Flores | «Flores» | «Temporal Flores» |
| Calle 26 | 15.453 | 3.956 (−74 %) |
| Temporal Avenida 39 | 17.050 | 4.823 (−72 %) |

Esto **corrobora de forma independiente dos de los registros pendientes**: los servicios
`6/692` y `A60/1187`, ambos con destino **Calle 76**, tienen vigencia publicada hasta el
**21 de agosto de 2026**, justo cuando esa estación deja de aparecer en las validaciones.
Dos fuentes que no se hablan entre sí dicen lo mismo: la estación cerró y sus servicios se
retiraron. Ver [PENDIENTES_20260911.md](PENDIENTES_20260911.md).

También explica por qué **Calle 72 - Areandina no tenía geometría en OpenStreetMap** al
ampliar a 40 estaciones: es de apertura reciente y OSM aún no la recoge. Ver
[TODOS_LOS_PORTALES_20260911.md](TODOS_LOS_PORTALES_20260911.md).

## Qué se conserva y qué se recomienda

**La calibración sigue siendo la de agosto–septiembre.** Es el periodo contemporáneo de la
instantánea de servicios del 10 de septiembre, y usar marzo obligaría a mezclar demanda de
estaciones que ya no existen con un catálogo de rutas que no las tiene. Marzo queda
archivado como contraste, no como fuente del escenario.

Lo que este contraste aporta:

1. **Confianza en el método.** Los factores por tipo de día se mueven poco más de un punto
   entre estaciones del año distintas.
2. **Una cota de la variación estacional.** Unos siete puntos porcentuales de nivel entre
   marzo y septiembre, repartidos de forma pareja.
3. **Una mejora pendiente con evidencia.** El festivo entre semana merece su propio tipo de
   día; falta medir más festivos antes de implementarlo.
4. **Un recordatorio.** La red física cambia en meses. Cualquier calibración debe usar
   validaciones contemporáneas del catálogo de servicios, no las más abundantes.

Agregado archivado: `data/processed/validations_20260309_20260323.json`, con SHA-256 por
archivo diario. Reproducible con `tools/aggregate_validation_period.py`.
