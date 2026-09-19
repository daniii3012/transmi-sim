# Velocidad de crucero y detenciones: por qué el bus iba a 23 km/h

> **Actualización posterior.** La regla que este documento introdujo —rodar al
> crucero en calzada segregada y gastar el sobrante en detenciones de la aproximación— queda
> sustituida por la velocidad medida de cada trecho de corredor: ver
> [la velocidad la pone el lugar](VELOCIDAD_POR_LUGAR_20260912.md). Dejaba media flota parada. Lo que
> sigue es el registro de por qué se llegó hasta aquí y no describe el motor vigente.

12 de septiembre de 2026. Sale de dos seguimientos hechos con el simulador al lado del
sistema real, y de las cinco horas de captura de las lecturas de posición de ese mismo día.

## Lo que se observó

Un C19 simulado y uno real, saliendo del mismo punto del corredor de la Américas con nueve minutos
por delante. El real dejó Distrito Grafiti mientras el simulado seguía entre Marsella y Pradera. El
velocímetro del simulado marcaba **23 km/h** en todo el trecho, puente incluido. Un servicio 4 en la
NQS, seguido durante 41 minutos desde NQS Calle 75: el real terminó en Portal Sur a las 19:37, el
simulado a las 19:42.

## Lo que estaba pasando

Desde que el motor corre contra el horario publicado, la velocidad de cada tramo se despejaba del
tiempo que el GTFS le asigna: una velocidad **uniforme** que hacía durar el tramo exactamente lo
publicado. Eso cuadra el reloj y falsea el movimiento, porque reparte de forma plana un tiempo que
en la realidad se gasta a trompicones.

La distribución de esa velocidad sobre los 1.386 tramos con horario lo dice: mediana 28,2 km/h, y
solo un 13 % llegaba al crucero del escenario. Un bus troncal no circula a 28 km/h por una calzada
segregada. Circula a 50-60 y pierde el tiempo parado.

## Lo que dice la captura

Cinco horas del sábado 12, 552 lotes, paso mediano 19 s, 59.607 observaciones emparejadas sobre
1.316 tramos. Comparando lo observado con lo publicado:

| | razón observado/publicado |
|---|---|
| Tramos de más de 240 s publicados | mediana **0,82** |
| Servicio completo (86 servicios con ≥8 tramos medidos) | p10 0,83 · mediana **0,89** · p90 0,94 |
| Desvío absoluto mediano, tramo a tramo | **0,24** |

Dos cosas distintas, y conviene no mezclarlas:

- **El horario lleva holgura.** Ningún servicio medido ese sábado fue más lento que su horario. La
  mediana por servicio completo es 0,89: el recorrido real dura un 11 % menos que el publicado.
- **La holgura está mal repartida.** Un 25 % de los tramos se hicieron más de un 30 % más rápido que
  su tiempo publicado y un 19 % más de un 20 % más lento. En el C19 esto es extremo: Mandalay →
  Marsella se publica en 233 s y se observó en 120; Marsella → Distrito Grafiti, 373 contra 230. Y
  sin embargo el recorrido completo del C19 cuadra, porque el tramo norte compensa: Suba Calle 100 →
  Puentelargo se publica en 158 s y se observó en 239.

Por eso una persecución de diez minutos sobre un trecho concreto se abre mucho más de lo que sugiere
ese 11 % de holgura del viaje entero.

## Lo que se cambió

El tiempo publicado del tramo se sigue cumpliendo. Lo que cambia es **en qué se gasta**:

1. **Calzada segregada.** El bus rueda a su crucero, sin rebajarlo. El sobrante se gasta en
   detenciones explícitas en la aproximación a la estación siguiente, después del último semáforo
   del tramo —para no alterar la fase que ya se resolvió— y en trozos de 45 s como mucho.
2. **Calzada mixta.** Se mantiene el crucero rebajado de forma continua. Ahí el bus va dentro del
   tráfico, no delante de él, y una detención en seco describiría peor lo que ocurre.

La hora de llegada a cada parada no se mueve. Aparece un estado nuevo en la interfaz, **Detenido en
tráfico**, separado de «Esperando atención», que sigue significando lo que significaba: cola por un
puesto de atención en estación.

El mismo tramo del C19, antes y después, muestreado cada 20 s (dígito = decenas de km/h, `·`
detenido, `P` parada):

```
antes    2222222222222222222222222P2222222222222222222222P
después  0666····4··P566666······5····P
```

Mandalay → Distrito Grafiti: 235 s rodando, 325 s detenido, 30 s de atención. El velocímetro marca
60 donde el bus real va a 50-60, y la espera se ve.

## Lo que esto no arregla

**El desfase contra la realidad sigue ahí, y es el medido en la calle: cinco minutos en 41 sobre el
servicio 4.** Coincide con la razón medida para ese servicio, 0,85-0,88. Reordenar el perfil no
acorta el viaje; para eso hay que tocar el presupuesto, y el presupuesto es el horario publicado.

Subir el crucero del escenario **no lo arregla tampoco**: el 87 % de los tramos no estaba limitado
por el crucero sino por el tiempo publicado, y ahora los de calzada segregada ya ruedan al crucero.
Subirlo solo alarga la parte detenida.

La palanca que sí lo arregla es calibrar el presupuesto con lo observado, y esa decisión necesita
más días que un sábado por la tarde: laborables, punta y lluvia, como dice
la captura de lecturas de posición. Hasta entonces el simulador corre contra lo
publicado y lo dice.

## Comprobación

Dos pruebas nuevas en `app/tests/operation.test.mjs`: que en calzada segregada el bus alcanza su
crucero y que el sobrante aparece como detención con velocidad cero —y que sin horario publicado no
se inventa ninguna detención, porque no hay sobrante—; y que las detenciones van ordenadas en el
tiempo, dentro del tramo y nunca por delante del semáforo que las causa, con ida y vuelta del reloj
devolviendo exactamente lo mismo. 77 pruebas Node pasan.

Medido sobre el día completo: realizado contra publicado por viaje, mediana 1,02 (antes 0,99). La
diferencia es el redondeo a diez segundos del presupuesto de cada tramo, y los tramos de mucho
semáforo donde rodar rápido significa encontrar más rojos de los que el horario descuenta. Eso
último ya no se disimula bajando la velocidad: se ve.

Rendimiento sin cambio apreciable: preparación 11,0 s, muestreo 1,32 ms por lectura (antes 1,17), y
la caché de perfiles baja de 124.330 a 76.507 entradas porque hay muchas menos velocidades distintas.
