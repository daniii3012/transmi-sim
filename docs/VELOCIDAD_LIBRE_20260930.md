# Velocidad libre: los buses ya llegan a 50–60 km/h entre estaciones

30 de septiembre de 2026. Fase 2 del plan de trabajo.

## El problema

En el simulador los buses rodaban casi siempre entre 20 y 40 km/h y nunca pasaban de ~46. En la
calle, con la vía libre, un troncal va a 50–60 km/h por la Calle 13 o las Américas.

La causa no era la hora. Medido en las lecturas de posición de la flota (15–18 sep., troncal, pares
de 20–40 s), la velocidad en marcha casi no cambia entre franjas:

| Franja | p50 | p75 | p90 | p97 |
|---|---|---|---|---|
| 05–06 | 27,0 | 39,5 | 49,7 | 56,9 |
| 07–08 | 25,8 | 39,6 | 50,0 | 56,8 |
| 12–13 | 27,2 | 41,3 | 51,7 | 57,8 |
| 18–19 | 23,5 | 37,4 | 47,7 | 55,8 |
| 21–22 | 26,4 | 40,3 | 51,8 | 59,3 |

La causa era qué velocidad se tomaba como crucero. El motor usaba el percentil 75, a lo largo de
cada tramo, de la velocidad **media** de rodar en cada cubeta de 100 m. Esa media mezcla arrancadas,
frenadas y pasadas lentas, así que el techo se quedaba en 35–45 km/h y el simulador aplanaba la
distribución: p90 de 40 frente a 50, p97 de 45 frente a 57.

## El cambio

- `build_speed_field.py` guarda por cubeta un histograma de 1 km/h de la velocidad de los pares en
  marcha de hasta 40 s y escribe `v_free_kmh`, su percentil 85: la velocidad a la que llega un bus
  ahí cuando nada lo detiene. Mediana 48,5 km/h, p90 59,5. Con vecinas si la cubeta tiene menos de
  30 pares y nunca por debajo de la media de rodar. Los demás valores del campo no cambian: mismos
  7.963.448 pares y el mismo día excluido. Solo dos cubetas de un trecho se mueven una décima, por
  los semáforos corregidos después.
- `build_services.py --perfiles` rehace `speed_profiles.json` (cuarto valor por punto, la libre) y
  el hash de procedencia de `services.json` sin necesitar las instantáneas del catálogo.
- En el motor, el crucero es la velocidad libre **de cada punto** (`cruiseFrom:'local'`): los trechos
  lentos de verdad (el paso por una estación, una curva, un cruce) quedan donde están, y entre
  ellos el bus llega a lo que la calle permite, con el tope de 60 km/h ±5 por bus.
- Aceleración por omisión de 0,8 a 0,6 m/s², la media de un articulado cargado: llega a 50 km/h en
  unos 23 s. Con 0,8, los buses ganaban velocidad como un automóvil.

## Resultado

Día hábil (16 sep.), toda la red, velocidad simulada medida igual que las lecturas:

| Franja | p50 | p75 | p90 | p97 |
|---|---|---|---|---|
| 07–08 antes | 24,1 | 33,9 | 40,0 | 44,8 |
| 07–08 ahora | 27,9 | 40,8 | 50,5 | 56,1 |
| 21–22 antes | 23,3 | 33,2 | 40,4 | 45,8 |
| 21–22 ahora | 28,1 | 40,0 | 50,6 | 56,9 |

Duración de los 20.839 viajes del día frente a la suma de sus tramos medidos: mediana **0,89**
(antes 0,98), p10 0,77 y p90 1,01. Frente al horario publicado, 0,77.

## Lo que queda

Los viajes salen un 11 % más cortos que los medidos. La diferencia no está en la velocidad, que ya
calca la observada. Está en el tiempo detenido fuera de la atención: en la calle, el 5,8 % del
tiempo es cola para entrar al andén y el 4,9 % es detención en tráfico. En el simulador son 1,9 % y
1,1 %. Hay menos colas de las reales. Es lo siguiente por calibrar, con cuidado. Las lecturas tienen
un sesgo conocido: una posición que no se refresca parece detenida y, al saltar, infla la velocidad
del par siguiente, así que infla a la vez lo quieto y la cola alta.

`cruiseFrom:'roll'` devuelve el crucero anterior para comparar. Sondas en `work/`
(`probe_velocidad_franja.mjs`, `probe_tiempos_viaje.mjs`, `probe_estados.mjs`, no versionadas).
