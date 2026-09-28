# Cómo se simula

28 de septiembre de 2026. Qué hace el simulador desde que se abre la página hasta que un bus se
detiene en su vagón, de dónde sale cada número y qué sigue siendo un supuesto. Para el detalle por
archivo ver [Arquitectura](ARQUITECTURA.md); para el motor de espacio físico con sus mediciones,
[Espacio físico](ESPACIO_FISICO_20260927.md).

## En una frase

Es una **microsimulación determinista con paso fijo de un segundo**: cada bus ocupa su largo en un
carril de una red de tramos compartidos, sigue al de adelante con un modelo de conducción y se
detiene donde algo lo obliga —su vagón, un rojo, el bus de adelante, un empalme—. Los mismos datos y
parámetros dan siempre el mismo día, así que se puede adelantar a 120×, retroceder o volver a una
hora y encontrar exactamente el mismo estado.

## Los datos de los que parte

Todos son datos abiertos. Cada uno entra por una descarga que guarda la instantánea fechada con su
SHA-256 y una herramienta `build_*` que la convierte en lo que lee la aplicación; el procedimiento
está en [Actualizar datos](ACTUALIZAR_DATOS.md).

| Qué aporta | Fuente abierta |
|---|---|
| Servicios troncales y duales: código, destino, trazado, paradas, color, vigencia | Catálogo público de rutas de TRANSMILENIO |
| Salidas programadas y duración de cada tramo | GTFS abierto de TRANSMILENIO S.A. |
| Ancho de la calzada exclusiva: uno o dos carriles | Mapa de Referencia, IDECA / UAECD (datos del IDU) |
| Geometría física de estaciones y portales | OpenStreetMap |
| Semáforos sobre calzada de buses | OpenStreetMap |
| Edificios de la vista 3D | Mapa de Referencia, IDECA / UAECD (Catastro) |
| Demanda de pasajeros | Validaciones diarias del SITP, Datos Abiertos Bogotá |
| Tipo de bus por servicio y velocidad de cada trecho | Lecturas de posición de la flota, desde el 12 sep 2026 |

Ningún bus que se ve en pantalla es una posición GPS: todos salen del modelo. Las lecturas de
posición de la flota entraron antes de simular, para medir cuánto tarda un bus rodando por cada
trecho, cuánto se queda parado y qué tipo de vehículo atiende cada servicio. Lo que quedó de ellas
son archivos curados y fechados —`speed_field.json`, `fleet_types.json`, `observed_times.json`— y
sirven también para validar el resultado.

## El plan del día

**1. Se recorta el catálogo.** De los 137 servicios se toman los utilizables que pida la selección
—toda la red, unas troncales o un servicio—, con su polilínea oficial en metros sobre una proyección
acimutal equidistante centrada en Bogotá.

**2. Se arma la red de tramos.** Los recorridos comparten vértices donde van por la misma calzada;
de ahí sale una red dirigida de tramos con sus empalmes, y cada recorrido es una sucesión de tramos.
Cada 5 m el tramo sabe cuántos carriles tiene: los que da el ancho medido de la calzada, dos en cada
estación —el del andén y el de paso— y lo que diga OpenStreetMap donde no hay medida.

**3. Se ubica cada parada en su vagón.** El vagón es el que publica el tablero de la estación donde
existe, y un reparto determinista donde no. Su posición sale del andén de OpenStreetMap, del
contorno de la estación repartido en módulos, o de un módulo de 64 m cuando no hay geometría.

**4. Se generan las salidas.** Donde el GTFS publica horario se despacha a las horas publicadas,
resolviendo sobre la fecha real qué calendarios están activos, festivos incluidos. Cada salida sale
con un desfase de ±1 min. Los servicios sin horario publicado conservan un intervalo por franja,
declarado como tal.

## El día, segundo a segundo

El día de servicio va de las 03:00 a las 03:00 siguientes, cuando la red está vacía, y se simula
desde ahí con paso de 1 s. Cada 15 minutos simulados se guarda un punto de control.

**Salida.** Cada salida pide un bus: el que espera en esa terminal, uno que puede llegar en vacío
desde otra cercana (hasta 18 km, a 7 m/s con un recargo de 1,35 y 3 min de preparación) o uno nuevo
mientras la flota no se agote. El tope por omisión es la flota real: 2.202 troncales más 50 duales
eléctricos de 2026. Si se agota, la salida espera un bus libre.

**Circulación.** Cada bus lleva la velocidad deseada del trecho —la de rodar que se midió ahí, en su
percentil 75, con topes por curva— y sigue al de adelante con el modelo de conducción inteligente
(IDM): 1,2 s de distancia de seguridad, 2,5 m parado, aceleración de 0,8 m/s² y frenada cómoda de
1,1. Un tope duro impide que dos buses se monten.

**Empalmes y carriles.** Donde dos tramos se juntan o un carril se acaba, los buses se turnan con
reglas fijas —quién llega primero reclama el paso, cremallera al final de un segundo carril—
evaluadas por número de viaje para que el resultado dependa solo del estado. Los cambios de carril
ocurren en puntos fijos, no en cualquier parte: las maniobras libres producían interbloqueos.

**Estaciones.** Un bus que para va por el carril de paso y se acomoda en el del andén justo antes
de su vagón; al salir sigue por el andén o vuelve al de paso si alguien atiende más adelante. Un
vagón atiende a un bus a la vez: el siguiente espera detrás, en el carril del andén. Quien no para
sigue de largo por el carril de paso.

**Semáforos.** Solo los que tienen evidencia directa en OpenStreetMap sobre la calzada de buses. Los
nodos a menos de 60 m forman una intersección con una sola fase —unas 300 en la red—, y los
desfases entre intersecciones siguen una onda verde estimada a 8 m/s. El ciclo por omisión es de
90 s con 52 de verde para la troncal. No hay planes semafóricos publicados: todo esto se rotula
como supuesto.

**Atención.** 13 s de abrir y cerrar (9 en calle) más lo que tarden en subir y bajar a 0,9 personas
por segundo y puerta —5 puertas el biarticulado, 4 el articulado, 2 el padrón dual—, más 4 s en
hora pico.

## Cómo se mueven los pasajeros

Es un modelo **agregado y determinista**, no una encuesta origen-destino ni personas individuales.

Las llegadas a cada estación y sentido salen de las validaciones diarias del SITP: 28.014.777
registros de 17 días observados, en perfiles por estación, hora y tipo de día. Hacia dónde
sale la gente de cada estación y cuánta se baja en cada una también se miden de esas validaciones
(`od_profiles.json`); en las paradas de calle, donde no hay dato, quedan los supuestos anteriores,
marcados como tales.

Cada bus que atiende sube su parte de la espera: la gente de un andén reparte su elección entre tres
servicios útiles, no se sube toda al primero. Quien no alcanza a subir se queda esperando, y esa
cola se erosiona con una impaciencia exponencial de media hora.

## Cómo se comprueba

Contra los tiempos entre paradas medidos en las lecturas de la flota, un día laborable completo da
mediana 1,02, percentil 10 de 0,91 y 90 de 1,15, sin ninguna hora fuera de 0,96–1,06. Contra el
horario publicado, 0,88: los buses reales van más rápido de lo que publica el horario, que acolcha
los tramos largos. Pico de 1.666 buses en servicio y 2.118 vehículos en el día, dentro de la flota
real.

86 pruebas Node y 47 Python cubren la red de tramos, que ningún bus se monte sobre otro, que se
atienda desde el carril del andén, el tope de flota, la reproducibilidad (avanzar, retroceder,
empezar de cero o restaurar un punto de control guardado dan el mismo estado), los carriles medidos,
los semáforos, el calendario y el planificador.

## Qué no es

- **No es una predicción.** Reproduce un día tipo con datos publicados, no lo que pasará mañana.
- **No simula el tráfico mixto** de la ciudad: en los tramos de calle el bus lleva la velocidad
  medida ahí, que ya incluye ese tráfico.
- **No tiene inventario real de flota.** Los números de bus no son matrículas y el tipo por servicio
  sale de lo observado.
- **No dibuja recorridos en vacío** ni patios físicos: la llegada en vacío se cuenta en tiempo, sin
  trazado inventado.
- **El horario es programación, no operación.** Dice a qué hora debía salir un bus, no si salió.
