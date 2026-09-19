# La operación medida: qué cambia y qué se confirma

Las lecturas de posición de la flota, desde el 12 de septiembre de 2026, sustituyen a la primera
medición suelta con la que se calibró el simulador. Ocho millones de pares de lecturas frente a
435.000. Esto recoge lo que cambió, lo que quedó confirmado y lo que sigue sin resolverse.

La fuente dejó de responder y no se ha vuelto a abrir, así que esta es la base sobre la que queda
calibrado el simulador. Lo que se observe después no entra hasta que se pueda volver a medir.

## Lo que se midió

7.963.448 pares de lecturas consecutivas sobre 113,8 km de eje troncal, cubriendo laborables, sábado
y domingo. Las cubetas de 100 m con medición propia pasan del 95 % al **98 %**.

## Un día fuera: la manifestación de la Calle 80

El corredor de la Calle 80 estuvo bloqueado y seguía bloqueado de noche. Entre las 19:00 y las 23:00:

| | El día bloqueado | Un laborable normal |
|---|---|---|
| Velocidad en el corredor | **8,4 km/h** | 22,5–23,1 km/h |
| Parte del tiempo detenido | **60 %** | ~17 % |
| Horas de bus acumuladas ahí | 175 | ~130 |

Trecho a trecho, el bloqueo se sitúa entre los kilómetros 2,5 y 3,7: **Minuto de Dios a 2,5 km/h con
el 77 % del tiempo detenido, Boyacá a 2,6 y Ferias a 2,6 con el 84 %**, contra 25–40 km/h en el resto
de las lecturas.

Un día así describe ese día, no ese corredor, así que queda fuera del campo. `--exclude` lo aparta y
escribe el motivo en la propia salida, para que no haya que adivinarlo después.

**Procedencia, para que conste:** el detalle diurno de ese día se perdió al instalar el paquete —el
archivo parcial sobrescribió al que esta máquina tenía—. Sobrevive el resumen por lote de la jornada
completa y el detalle de 19:00 a 23:29, que es donde se midió lo anterior. Aunque se quisiera
reincorporar, su mañana ya no existe.

## Hora y tipo de día: no hacen falta en el campo

Era el pendiente principal. Medido sobre 2.180 cubetas con las cuatro franjas:

| Franja | Velocidad mediana | Razón frente a su propia media |
|---|---|---|
| Laborable punta | 25,4 km/h | 0,91 |
| Laborable valle | 28,1 km/h | 0,99 |
| Sábado | 29,4 km/h | 1,03 |
| Domingo | 30,6 km/h | 1,07 |

El **nivel** sí cambia: la punta es un 9 % más lenta que la media y el domingo un 7 %
más rápido. La **forma** no: la correlación entre la velocidad por trecho de cada franja y la del
valle laborable va de **0,93 a 0,97**. Los trechos lentos son los mismos a todas horas.

Y el nivel ya está modelado donde corresponde, porque el tiempo publicado de cada tramo trae columna
por tipo de día:

| | Horario publicado | Observado |
|---|---|---|
| punta / valle | 1,067 | **1,09** |
| sábado / valle | 0,956 | **0,96** |
| festivo / valle | 0,946 | **0,93** |

Coinciden. Meter una dimensión de franja en el campo duplicaría lo que el presupuesto ya hace, así
que el campo se queda con un número por trecho.

## Densidad: más fuerte en punta, y aun así de segundo orden

La hipótesis de que un bus va más lento cuando tiene otros cerca, medida ahora en punta de día
laborable y comparando cada trecho consigo mismo:

| Buses cerca | ninguno | 1 | 3 | 4 | 5 | 6 o más |
|---|---|---|---|---|---|---|
| Velocidad relativa | 1,00 | 0,99 | 0,96 | 0,94 | 0,93 | **0,86** |

Un 14 % con seis vecinos o más, casi el doble del 8 % que daba la primera medición. En bruto el efecto parece
enorme —de 27,9 a 14,5 km/h— pero eso vuelve a ser composición: los sitios con muchos buses son los
sitios lentos.

Sigue sin implementarse, y ahora por una razón mejor que antes: el campo promedia todas las horas, de
modo que la parte de ese 14 % que ocurre en punta ya está dentro de su velocidad, y el reparto entre
punta y valle lo pone el horario. Un término en vivo añadiría varianza dentro de la punta a costa de
contar dos veces lo mismo. Queda como decisión abierta, no como carencia.

## Detenerse es cosa de estaciones

De las horas que el campo atribuye a detención del corredor —ya descontadas la atención, el andén y
los semáforos corroborados—, **el 73 % ocurre a menos de 300 m de una estación**:

| Distancia a la estación | Cubetas | Detenido mediano | Velocidad |
|---|---|---|---|
| 0–150 m | 909 | 0 % | 23,4 km/h |
| 150–300 m | 876 | 4 % | 28,1 |
| 300–500 m | 407 | 4 % | 33,7 |
| 500–800 m | 64 | 3 % | 33,8 |

Lejos de cualquier estación quedan 832 horas de las 56.500 medidas: **el 1,5 % del tiempo en
servicio**. Es la confirmación del criterio con el que se retiraron las esperas fabricadas: un bus
troncal se detiene en la cola del andén y en el rojo, y lo demás es rodar despacio.

El reparto real del tiempo en servicio, por si sirve de referencia: 79,5 % rodando, 5,8 % en andén
ajeno, 5,2 % en atención propia, 4,6 % en semáforo y 4,9 % en el corredor.

## La flota, confirmada

108 servicios resueltos, ninguno mezclado, **ninguna etiqueta fuera de los rangos conocidos** y
**ninguna discrepancia** entre la etiqueta publicada y la reconstruida desde el identificador en
ninguna lectura. Ningún servicio cambia de tipo respecto a lo deducido en la primera medición.

1.902 vehículos troncales vistos —612 articulados y 1.290 biarticulados, el 68 %— más 320 duales. Los
duales de la serie E salen en **E700–E759**, exactamente el rango que se esperaba. Veinte servicios
más reciben ahora tipo observado: 123 de 137 registros, frente a 103.

## Efecto en el simulador

Ninguno apreciable, que es la señal de que el modelo era robusto: el factor por tramo absorbe el
cambio de nivel del campo.

| | Con la primera medición | Con todas |
|---|---|---|
| Detenidos en tráfico, laborable a las 6:40 | 9 | 8 |
| Flota quieta | 20 % | 19 % |
| Espera individual mediana · máxima | 21 · 45 s | 23 · 45 s |
| Velocidad rodando p10 · p50 · p90 | 16,7 · 23,4 · 31,5 | 16,7 · 23,3 · 31,5 km/h |
| Viaje frente al horario publicado | +1,5 min | +1,5 min |

La flota simulada está quieta el 14–19 % del tiempo; la real, el 20,5 %. El reloj sigue siendo
reversible y las suites pasan.

## La flota despachada está bien

Antes de tocar los tiempos había que saber si el problema era de cantidad o de velocidad. La captura
dice cuántos buses tuvo cada servicio a cada hora; el simulador los despacha según el horario
publicado. Nadie los había comparado.

Sobre días laborables, por grupo de servicios —agrupando los que comparten registro publicado, y
por agencia del GTFS para que el C15 zonal no se mezcle con el C15 troncal—:

| Razón simulado/observado | |
|---|---|
| Mediana | **1,02** |
| p10 · p90 | 0,91 · 1,11 |
| Servicios dentro de ±10 % | 80 de 105 |
| Flota total en las horas comparadas | 10.738 contra 10.391 |

Y los viajes también cuadran: en un laborable circularon 20.256 y el horario publica 20.806, razón 1,03.

O sea que el despacho no es el problema. Las desviaciones mayores son modestas —S46 1,36, J70 0,74—
y caen en servicios pequeños o de media jornada.

## Los tiempos entre paradas, medidos

Con el despacho descartado, el problema tenía que estar en los tiempos. `build_observed_times.py`
los mide: cuando el vehículo cambia de parada destino acaba de dejar la anterior, así que el tiempo
entre dos cambios es lo que tardó de una a la siguiente, atención incluida —igual que el publicado—.

**3.451 tramos medidos, y el 97 % de los tramos del catálogo (1.500 de 1.545) recibe tiempo propio**,
en 113 de 115 servicios. La comparación con lo publicado desnuda el reparto:

| | medido / publicado |
|---|---|
| Todos los tramos | 0,85 |
| Tramos cortos, menos de 120 s | **1,00** |
| Tramos largos, más de 240 s | **0,77** |

El horario acierta en los tramos cortos y acolcha los largos casi un cuarto. Por eso el viaje entero
cuadraba mientras cada tramo por separado no.

`build_schedule.py` adjunta esos tiempos junto a los publicados, con la misma forma de cinco
columnas, y el motor prefiere los medidos donde existen. El interruptor `observedRunning` los
devuelve al horario publicado.

| | Publicados | Medidos | Observado en la calle |
|---|---|---|---|
| Velocidad rodando, mediana | 23,3 km/h | **28,4** | 28,2 |
| Duración del viaje, mediana | 60,9 min | **53,1** | 0,85–0,89 de lo publicado |
| Viajes que no alcanzan su tiempo publicado | 3.554 | **206** | — |
| Flota simulada a las 7:00 | 1.825 | 1.625 | — |

El simulador pasa a rodar a la velocidad que se mide en la calle, y los tramos imposibles caen de
3.554 a 206 viajes.

**Dos cosas que hay que saber al leer esto.** La primera: con los tiempos medidos la flota simulada
en servicio queda en 0,90 de la observada, cuando con los publicados daba 1,02. No es que falten
buses: los viajes coinciden y la duración también. Lo que la cuenta observada incluye y el simulador
no es el bus que ya terminó su viaje y sigue reportando en el patio. Sobre un viaje de 53 minutos,
ese 10 % son unos seis minutos de regulación en terminal, que es lo que cabe esperar.

La segunda: al usar tiempos medidos el factor por tramo sube de 1,15 a 1,37 de mediana. No es un
fallo. El campo de velocidad es del **lugar** y los tiempos son del **servicio**: un expreso que cruza
quince estaciones sin parar es más rápido que el promedio de ese trecho, porque ese promedio lo
marcan los buses que sí frenan en cada una. El factor recoge esa diferencia, que es real.

## Lo que queda abierto

1. **El campo de velocidad es del lugar y no distingue quién pasa.** Un expreso es más rápido que el
   promedio del trecho que cruza, y hoy eso lo compensa el factor. Medir la velocidad condicionada a
   si el bus para o no en cada cubeta lo resolvería en el origen; hace falta cruzar cada lectura con
   la lista de paradas de su servicio.
2. **La vigencia del catálogo se acabó.** Los 117 servicios utilizables declaran vigencia hasta el
   19 de septiembre de 2026, que es lo que publica el propio catálogo, y el último paquete GTFS
   observado retira 90 identificadores de ruta y añade 25, entre ellos H76 y J76, que sí circularon.
   Refrescarlo pide volver a la fuente, que ya no responde.
3. **La densidad**, descrita arriba.
