# Espacio físico: cada bus ocupa su carril — 27 sep. 2026

Hasta ahora cada bus se calculaba por su cuenta a partir del horario publicado y de la velocidad
medida del lugar. Era exacto en el reloj y ciego en el espacio: dos buses en el mismo rojo quedaban
uno encima del otro y arrancaban a la vez, y en una estación el que llegaba detrás no se enteraba de
que el andén estaba ocupado. [COLAS_Y_ESPACIO_20260911.md](COLAS_Y_ESPACIO_20260911.md) dejó escrito
qué hacía falta. Este documento describe el motor que lo resuelve: `app/dist/traffic.mjs`.

## Qué se ve ahora

- Filas de buses en semáforos, en la entrada de las estaciones y en los empalmes, cada uno con su
  largo real (12, 18,5 o 27,2 m) y 2,5 m de separación parado.
- En cada estación, el carril que sigue de largo y el carril del andén. Cada bus avanza por el
  primero y se acomoda en su vagón justo antes de llegar, si el puesto está libre; si no, espera ahí.
  Al salir sigue por el carril del andén si está despejado, o vuelve al que sigue de largo para
  rebasar al que atiende en el vagón siguiente. Al final de la estación los dos carriles se turnan,
  uno y uno.
- Donde OpenStreetMap publica dos carriles fuera de las estaciones, el segundo sirve para adelantar
  a un bus lento, con vuelta obligada antes de la estación siguiente.
- Atrasos que nacen de la operación: una cola en un cruce se propaga a las paradas siguientes.

## Cómo está hecho

### La red de tramos compartidos

Los recorridos publicados reutilizan los mismos vértices donde van por la misma calzada: de 10.265
vértices distintos, 8.618 los comparten dos o más servicios, y ningún tramo dirigido tiene su inverso
en otro recorrido (cada sentido va por su calzada, a unos 12 m del otro). Se unen en **525 tramos
dirigidos** entre bifurcaciones, 299 km, con 141 empalmes. Un tramo empieza y acaba donde algún
recorrido se separa, se une, empieza o termina. Cruzarse en el plano no une nada: dos recorridos solo
se ven si publican el mismo vértice, así que un puente o un deprimido exclusivo no crea un cruce falso.

### Carriles

Celdas de 5 m por tramo. Un carril donde la calzada de OSM no publica `lanes` —no se deduce—, lo que
publique donde sí (113 km con dos carriles), y dos en cada estación: el que sigue de largo y el del
andén, desde 70 m antes del primer punto de atención hasta 30 m después del último, uniendo los de
todos los servicios que paran ahí. En total 169 km con dos carriles. El carril del andén queda a la
izquierda en la troncal —el andén está en el separador— y a la derecha en calle mixta.

La regla de uso en estación sale de la operación observada en la calle: el bus no hace fila detrás
de los que atienden en vagones anteriores al suyo; va por el carril que sigue de largo y se mete en
el del andén justo antes de su vagón. Las lecturas de posición de la flota no sirven para
corroborarlo —refrescan cada 15–30 s con unos 10 m de error, y un carril mide 3,4—, así que queda como
regla declarada, coherente con la geometría de las estaciones.

### Conducción

Modelo IDM (Treiber) con paso fijo de 1 s: aceleración 0,8 m/s², frenada cómoda 1,1 m/s², brecha de
tiempo 1,2 s y separación parado 2,5 m, ajustables en el escenario. Además del bus de delante, cada
conductor ve su punto de atención, el semáforo si está en rojo —o en amarillo y alcanza a frenar—,
el cierre del carril por el que va y el empalme si lo tiene otro. Topes duros impiden solaparse
aunque el modelo pidiera más de lo posible.

La **velocidad deseada** de cada tramo entre estaciones es la de rodar en su trecho más rápido,
medida en las lecturas de la flota (`speed_profiles.json`): velocidad de travesía dividida por la
parte del tiempo que no se pasa detenido. El campo ya dice que lo detenido es cola de andén o de
semáforo, y esas colas ahora ocurren en la simulación; tomar la velocidad media del trecho las
contaba dos veces y dejaba a los buses rodando a 21 km/h donde la calle mide 28. Las curvas limitan
como antes. En calle mixta, donde no se simula el tráfico general, la velocidad sale del tiempo
publicado del tramo, que sí trae dentro esa congestión.

### Empalmes y cierres de carril

Un empalme se reserva para el primero que llegaría; los que vienen por la misma aproximación que el
dueño lo siguen, y los de la otra esperan en la línea hasta que el frente del dueño lo cruza —desde
ahí ya lo ven delante y guardan la distancia solos—. El cierre del carril del andén al final de una
estación, y el inicio de la estación siguiente para quien adelantaba, funcionan igual: turnos
alternos entre los dos carriles, con el de atención esperando a un bus y una separación del cierre
para que el otro quepa delante.

### Semáforos

Los 723 nodos corroborados de OSM se agrupan en 300 intersecciones: los nodos a menos de 60 m son el
mismo cruce o cruces que en la calle maneja un mismo controlador. Antes cada nodo tenía su propio
desfase, y un bus tenía que encontrar en verde dos, tres o cuatro luces independientes a pocos metros.
Las fases reales no se publican; lo que sí se sabe es que los cruces consecutivos de una avenida se
coordinan. Se recorre cada troncal y cada cruce se desfasa respecto del anterior lo que tarda un bus
en llegar a 29 km/h (**onda verde estimada**). Ciclo 90 s, verde 52, amarillo 3, ajustables.

### Terminales, flota y patios

En un portal embarcan y desembarcan varios buses a la vez en andenes distintos. El embarque inicial
y el desembarque final ocurren en esas plataformas, fuera del carril; el bus entra a la vía cuando
hay hueco y, si inicia servicio en una estación de la troncal, entra por el carril del andén de su
vagón.

La flota tiene tope: **2.252 buses** por omisión —2.202 troncales que publica TRANSMILENIO en febrero
de 2026 más los 50 duales articulados eléctricos de 2026—, ajustable. Un bus que termina queda
disponible en su terminal tras la regulación; si la salida siguiente es en otra terminal, puede ir
en vacío si le da el tiempo (7 m/s con un rodeo de 1,35 sobre la línea recta y 3 min para salir,
hasta 18 km); si no, sale uno del patio mientras la flota alcance, y si no alcanza, la salida espera.
Los recorridos en vacío no se dibujan: no hay trazado publicado para ellos y no se inventa.

### Pasajeros y atención

El modelo agregado de siempre, con dos correcciones. Cada bus sube la parte de la espera que le
corresponde y no a todos los que esperan en ese sentido: sin matriz origen-destino se estima que a
cada pasajero le sirven en promedio tres de los servicios que paran ahí. Antes cada bus salía lleno
y la atención duraba minuto y medio; sin espacio físico eso no se notaba porque el horario lo
absorbía, con él producía colas de 50 buses. Y el embarque se reparte entre las puertas del bus: 5 en
el biarticulado, 4 en el articulado y el dual articulado, 2 en el padrón dual, a 0,9 pasajeros por
segundo y puerta.

### Reproducibilidad

El mismo día y la misma hora dan siempre el mismo estado. El día de servicio va de las 03:00 a las
03:00, cuando la red está vacía, y se simula desde ahí con paso fijo; cada 15 minutos simulados se
guarda un punto de control. Retroceder el reloj restaura el anterior y vuelve a simular, lo que da
exactamente lo mismo que la primera vez. Pasar la medianoche no reinicia nada. Una prueba compara el
estado al que se llega avanzando, retrocediendo y desde cero.

Todos los días laborables usan el mismo horario publicado y el mismo perfil de demanda, así que sin
más son idénticos, igual que los sábados entre sí y los domingos y festivos. La opción **Variación
entre días** da a cada fecha su propia semilla: desfase de despacho de ±1 min, atención ±15 % y un
nivel de demanda ±5 %. La misma fecha se repite igual; dos martes ya no.

## Validación

Día laborable completo (24 sep. 2026), todos los servicios utilizables, flota real:

| Hora | 05 | 06 | 07 | 08 | 09 | 10–14 | 15–16 | 17 | 18 | 19 | 20 | 22 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| duración simulada / publicada | 1,06 | 1,20 | 1,34 | 1,27 | 1,12 | 0,97–1,01 | 1,02 | 1,15 | 1,18 | 1,15 | 1,13 | 0,93 |

- Mediana 1,05; percentil 90, 1,66. Fuera de punta el viaje dura lo publicado; en punta se alarga
  entre 20 y 35 %, que es lo que se vive en la calle cuando un cruce acumula diez buses.
- Sábado (26 sep.): mediana 0,98 y percentil 90 de 1,09, sin hora en que pase de 1,01. Pico de 954
  buses en servicio y 1.291 vehículos en el día.
- Los 21.066 viajes del día laborable terminan; ninguno queda atascado. Desatascos forzados: 1 en todo el día.
- Sin tope, la operación del día necesita 2.286 vehículos: 1,5 % más que la flota publicada, sin
  haberla calibrado. Con el tope real, algunas salidas de la punta esperan vehículo.
- En la punta ruedan a 25–26 km/h (la calle mide 28) y pasan el resto detenidos en semáforos,
  andenes y colas.
- Rendimiento en el navegador de escritorio: de 03:00 a 07:30 en unos 4 s, un día completo en unos
  25 s; retroceder dentro de lo ya simulado, 0,3 s. Memoria de la simulación: unos 60 MB, frente a
  los 720 MB del motor anterior.

## Lo que queda estimado

- La regla de uso de carriles en estación, las separaciones y la aceleración del IDM.
- La onda verde, el ciclo semafórico y la agrupación de nodos en intersecciones.
- Tres servicios útiles por pasajero, la velocidad de embarque por puerta y la parte de espera que
  toma cada bus.
- Los recorridos en vacío entre terminales y la ubicación de los patios, que no se modelan.
- El tráfico general en calle mixta, que solo entra a través del tiempo publicado.
- El carril único donde OSM no publica carriles: donde la calzada real tenga dos, la simulación es
  más lenta de lo real.

## Pruebas

`app/tests/traffic.test.mjs`: la red cubre cada recorrido sin huecos; cada punto de atención tiene
carril de andén; el mismo instante da el mismo estado por cualquier camino; ningún bus se monta sobre
otro en su carril; se atiende desde el carril del andén; el tope de flota se respeta y, sin
vehículos, la salida espera; la variación diaria cambia de fecha a fecha y se repite en la misma; los
nodos de un cruce comparten fase; y la red entera atraviesa la punta de la mañana sin atascos.
