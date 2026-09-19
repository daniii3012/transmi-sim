# ¿Pueden los buses ocupar espacio y hacer fila? — análisis, 11 sep. 2026

En los cruces semafóricos se observó que los buses se acumulan uno sobre otro y, al
cambiar la luz, arrancan todos a la vez: no quedan en fila ni ocupan su espacio. Este
documento evalúa qué haría falta para cambiarlo. **No se implementó nada.**

## Qué tan seguido ocurre

Muestreo cada 15 s entre las 06:00 y las 09:00 del escenario base, contando cuántos buses
comparten el mismo semáforo en el mismo instante (35.818 observaciones de semáforo ×
instante):

| buses en el mismo semáforo | observaciones | % |
|---:|---:|---:|
| 1 | 21.607 | 60,3 |
| 2 | 7.896 | 22,0 |
| 3 | 3.457 | 9,7 |
| 4 | 1.593 | 4,4 |
| 5 | 786 | 2,2 |
| 6 | 343 | 1,0 |
| 7 a 10 | 136 | 0,4 |

En seis de cada diez casos no hay apilamiento y el dibujo actual es correcto. El máximo
observado fueron **diez buses en el nodo `371565784` a las 06:59:30** (H15, F19, H75, H13,
L18, H20 ×2, H54, F60 y el 3). Diez articulados con su separación ocupan unos 200 m de
calzada, así que ahí la diferencia entre el dibujo y la realidad es grande.

## Por qué pasa: cómo funciona el motor hoy

La propiedad que sostiene todo el simulador es que **`seek(t)` da exactamente el mismo
resultado se llegue a `t` avanzando, retrocediendo o saltando**. Eso se logra porque la
posición de un bus en el instante `t` se calcula solo a partir de su propio viaje: no hay
un estado global que evolucione paso a paso.

Para los semáforos, `signalTravel` calcula las esperas de un viaje con `signalPhase(id,
llegada)`, que es una función pura del identificador del semáforo y la hora. Dos buses que
llegan durante el mismo rojo obtienen, cada uno por su lado, la misma hora de verde. Por
eso arrancan juntos: **ninguno sabe que el otro existe**.

## El patrón que hace falta ya existe en el proyecto

Las estaciones **sí** resuelven exactamente este problema. En `build()`:

```js
const slots = berths.get(key) || Array(s.kind==='street' ? 1 : 2).fill(0);
const open = Math.max(arrival, slots[slot]);   // esperar a que el vagón se desocupe
slots[slot] = close + 3;                        // liberarlo 3 s después de salir
```

Cada punto de atención es un recurso compartido con una hora de liberación. Un bus que
llega antes espera. Y esto se resuelve **durante la construcción, en un único recorrido
de eventos ordenado por tiempo**, así que `seek` sigue siendo una consulta sobre un
resultado ya calculado. La reproducibilidad no se pierde.

Un semáforo puede modelarse igual: un recurso con una hora de liberación, donde el primer
bus arranca en verde y cada siguiente sale un intervalo de descarga después —en la
literatura de tránsito, del orden de 2 a 3 s por vehículo pesado.

## Dos cosas separables

Conviene no mezclarlas, porque tienen costo y riesgo muy distintos.

### A. Que ocupen su espacio en el dibujo

Hoy un bus detenido se dibuja en el punto exacto del semáforo. Si varios están detenidos
en el mismo control, se superponen. La corrección es de dibujo: ordenar los buses
detenidos en un semáforo por su distancia recorrida y retroceder cada uno
`n × (largo del bus + separación)` metros sobre su propia polilínea.

- El largo ya está disponible por vehículo (`length_m`: 12, 18,5 o 27 m según el tipo).
- `map.mjs` ya hace desplazamientos equivalentes para el estado `queue` en estación
  (`xy[0] -= Math.cos(angle)*24`) y para los vagones, así que hay precedente directo.
- **No toca el motor**: mismas horas, mismas esperas, misma reproducibilidad. Cero riesgo
  para las 55 pruebas.
- Limitación honesta: la fila sería una representación del orden de llegada, no el
  resultado de una física de cola. Habría que rotularlo así.

Esfuerzo estimado: pequeño, contenido en `updateBuses`.

### B. Que la cola tenga efecto real en los tiempos

Aquí sí cambia la operación: si diez buses esperan, el décimo no debería arrancar en
verde sino unos 20 a 30 s después, y esa demora se propaga a sus paradas siguientes.

El obstáculo es el orden de proceso. Hoy el montículo de eventos está ordenado por la
**hora de parada**, y un evento de parada calcula de una vez todo el tramo hasta la
siguiente, con sus cruces incluidos. Un bus cuya parada ocurre antes puede cruzar un
semáforo después que otro cuya parada ocurrió más tarde pero estaba más cerca del cruce.
Es decir, **los cruces no se procesan en orden cronológico**, que es justo lo que una cola
necesita.

Para resolverlo habría que:

1. Emitir un evento propio por cada cruce de semáforo, para que el montículo los ordene
   por su hora real.
2. Partir el cálculo del tramo: hoy `signalTravel` itera hasta que el perfil de velocidad
   se estabiliza, porque frenar en un semáforo cambia la hora de llegada al siguiente. Con
   una cola compartida, esa iteración pasa a depender de otros vehículos, y hay que
   garantizar que converge y que no depende del orden de inserción.
3. Decidir qué pasa cuando la cola no alcanza a descargar en un verde: es lo que en la
   realidad produce la congestión de un cruce, y habría que elegir explícitamente si se
   modela o se acota.

El costo en cómputo es bajo —cada cruce es una operación constante sobre el recurso—
pero **el riesgo de arquitectura no lo es**: toca el núcleo del que dependen la
reproducibilidad al retroceder el reloj y las 55 pruebas actuales.

### Lo que no propongo

Una simulación microscópica de seguimiento vehicular, con distancia de seguridad continua
entre buses a lo largo de todo el recorrido. Eso obligaría a integrar el estado de la red
paso a paso y rompería `seek` de raíz. El proyecto ganaría realismo aparente y perdería la
propiedad que hace confiable todo lo demás.

## Recomendación

Hacer **A** primero: arregla exactamente lo que se ve mal, no toca el motor y deja el
apilamiento visual resuelto en el 40 % de los casos donde hoy se nota. Dejar **B** como
una decisión aparte, con su propio hito, porque es un cambio de arquitectura y conviene
hacerlo cuando no haya otro trabajo abierto sobre el motor.

Si se hace B, el orden natural sería: primero los eventos de cruce ordenados, luego el
recurso compartido con intervalo de descarga declarado como estimado —igual que el ciclo
de 90 s—, y solo después considerar el desbordamiento de cola.
