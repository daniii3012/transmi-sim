# Cómo se simula

12 de septiembre de 2026. Qué hace el simulador cuando se pulsa reconstruir, de dónde sale cada
número y qué sigue siendo un supuesto. Para el detalle por archivo ver [Arquitectura](ARQUITECTURA.md);
para los parámetros vigentes, [Operación y datos](OPERACION_Y_DATOS.md).

## En una frase

Es una simulación **de eventos discretos y determinista**: no se integra el tiempo paso a paso, se
calcula por adelantado cuándo ocurre cada salida, cada atención en estación y cada liberación de
vehículo, y el reloj solo consulta ese calendario. Por eso se puede adelantar a 120×, retroceder, y
volver al mismo instante encontrando exactamente el mismo estado.

## Los datos de los que parte

Todos son datos abiertos. Cada uno entra por una herramienta `fetch_*` que guarda la instantánea
fechada con su SHA-256, y una `build_*` que la convierte en lo que lee la aplicación; el
procedimiento está en [Actualizar datos](ACTUALIZAR_DATOS.md).

| Qué aporta | Fuente abierta |
|---|---|
| Servicios troncales y duales: código, destino, trazado, paradas, color, vigencia | Catálogo público de rutas de TRANSMILENIO |
| Salidas programadas y duración de cada tramo | GTFS abierto de TRANSMILENIO S.A. |
| Geometría física de estaciones y portales | OpenStreetMap |
| Semáforos sobre calzada de buses | OpenStreetMap |
| Calzada, carriles y contexto urbano | OpenStreetMap |
| Demanda de pasajeros | Validaciones diarias del SITP, Datos Abiertos Bogotá |
| Buses reales de toda la red, en la pestaña En vivo | Alimentador GTFS-Realtime abierto de TRANSMILENIO |

La pestaña **En vivo** es la única parte que no sale del escenario, y tiene dos vistas. «Todo el
sistema» dibuja los buses troncales y duales que publica el alimentador GTFS-Realtime abierto: una
lectura trae la red entera y no necesita ninguna configuración. «Por servicio» lee un servicio
configurado en local y añade lo que el alimentador no trae —ocupación, accesibilidad y avance sobre
la ruta—; sin ese archivo esa vista queda en blanco en vez de fingir datos, y la otra sigue
funcionando. Ninguna de las dos alimenta el modelo ni el planificador: solo se dibujan encima.

Aparte, y sin entrar todavía en el modelo, se graba el alimentador GTFS-Realtime abierto para ir
acumulando cómo opera el sistema de verdad: es lo único que puede separar la atención en estación del
tiempo de recorrido, porque el paquete publicado los da juntos. Ver
[Captura del alimentador en vivo](CAPTURA_RT_20260912.md).

## Qué ocurre al construir un escenario

**1. Se recorta el catálogo.** De los 137 servicios se toman los utilizables y los que la selección
pida —toda la red, un corredor o un servicio—. Cada uno conserva su polilínea oficial recortada
entre primera y última parada, medida en metros sobre una proyección acimutal equidistante centrada
en Bogotá.

**2. Se decide el sentido y el punto de atención de cada visita.** El sentido sale del eje dominante
de la estación, calculado sobre todas las rutas que la tocan. El vagón es el publicado donde el
tablero de la estación lo dice, y un reparto determinista donde no; la ficha siempre rotula cuál de
los dos es.

**3. Se generan las salidas.** Donde el GTFS publica horario —115 de los 117 servicios utilizables—
se despacha a las horas publicadas, resolviendo sobre la fecha real qué calendarios del paquete están
activos, festivos incluidos. Los demás conservan una regla de intervalo fijo, declarada como tal.
Se construyen el día elegido **y el anterior**, para que los viajes que cruzan medianoche existan.

**4. Se asigna un vehículo.** Cada terminal mantiene una reserva por tipo de bus. Una salida toma un
vehículo compatible si lo hay y si no crea uno nuevo, así que la flota no es un parámetro: es el
resultado de cuántas salidas hay y cuánto dura cada viaje. Al terminar, el bus queda disponible en la
terminal de destino tras 240 s de regulación.

**5. Se recorre el servicio parada a parada.** En cada una se resuelve cuánta gente sube y baja, se
ocupa un puesto de atención, y se calcula el movimiento hasta la siguiente. Todo ello se encola por
tiempo en un montículo binario; el bucle vacía la cola y deja construidos los viajes completos.

## Cómo se mueve un bus

El movimiento se calcula **en el dominio de la distancia**, no del tiempo: cada tramo se muestrea
cada 18 m y en cada punto se fija un techo de velocidad que es el menor entre el crucero del
escenario y lo que permite el radio de la curva. Después se pasa dos veces sobre esa envolvente
—hacia adelante limitando por la aceleración, hacia atrás por el frenado— y se integra. El resultado
es una curva posición/velocidad que se consulta analíticamente, así que ir a 120× no hace que los
buses vayan a 120 veces los km/h.

El tiempo que el horario publicado le da a un tramo se cumple, pero **se reparte según por dónde va
el bus**. En calzada segregada el bus rueda a su crucero —los 60 km/h del escenario, ±5 por vehículo—
y lo que el horario da de más se gasta **detenido**, en la aproximación a la estación siguiente y en
trozos de 45 s como mucho. En calzada mixta —Séptima, Av. 68, los tramos de calle— sí se rebaja el
crucero de forma continua, porque ahí el bus va dentro del tráfico y no delante de él; esa velocidad
se despeja del tiempo publicado descontando antes la atención en estación y el coste esperado de los
semáforos, para no contarlos dos veces. La ecuación está en
[Horario publicado](HORARIO_GTFS_20260912.md), y por qué el reparto cambió, en
[Velocidad y detenciones](VELOCIDAD_Y_DETENCIONES_20260912.md).

La hora de llegada a cada parada no se mueve por esto: sigue siendo la publicada. Lo que cambia es
que la demora queda donde se puede ver y medir —un bus parado— en vez de disuelta en un velocímetro
que marcaba 23 km/h en un viaducto.

**Semáforos.** Solo los que tienen evidencia directa en OpenStreetMap sobre calzada de buses, con la
vía y el sentido correctos. Su ciclo es un supuesto explícito de 90 s —52 verde, 3 amarillo, 35
rojo— con un desfase determinista derivado del identificador. No hay coordinación entre semáforos ni
colas que se propaguen hacia atrás.

**Atención en estación.** Base de 13 s en troncal y 9 s en calle, más 4 s en hora pico, más lo que
tarden en subir y bajar a 2,5 y 3 personas por segundo. Cada vagón tiene dos puestos de atención, la
calle uno; si están ocupados el bus espera, y esa espera se ve en el mapa. Un bus expreso que no
para no queda bloqueado por los que sí.

## Cómo se mueven los pasajeros

Es un modelo **agregado y determinista**, no una encuesta origen-destino ni personas individuales.

Las llegadas a cada estación y sentido salen de las validaciones diarias del SITP: 28.014.777
registros de 17 días observados —13 de semana, 2 sábados y 2 domingos—, agregados en perfiles por
estación y hora. Sábado y domingo se miden, no se estiman reduciendo un día de semana.

Sobre ese perfil actúan tres supuestos que sí son estimaciones y se marcan como tales: un factor
direccional que en la mañana carga hacia el centro de empleo y en la tarde al revés; una fracción de
descenso que depende de la hora y de lo céntrica que sea la estación; y una línea base de demanda de
2,25, que es una decisión de escenario y no una medición.

Quien no alcanza a subir se queda esperando, y esa cola se erosiona con una impaciencia exponencial
de media hora. Nadie desaparece sin contarse: los rechazos de embarque se informan aparte.

## Qué no es

- **No es una predicción.** Reproduce un día tipo con datos publicados, no lo que pasará mañana.
- **No modela el tráfico mixto** ni colas que se propagan; el tiempo que hoy cuesta la congestión
  entra por el tiempo que el horario le da a cada tramo, no por vehículos que estorban.
- **No tiene inventario real de flota.** Los tipos de bus por servicio son una asignación estimada
  salvo donde hay publicación expresa; los números de bus no son matrículas.
- **No hay patios físicos ni circulación en vacío**: la regulación en terminal es abstracta.
- **El horario es programación, no operación.** Dice a qué hora debía salir un bus, no si salió.
- **Las pruebas comprueban funcionamiento, no fidelidad.** Lo que compara el modelo con la realidad
  es la validación por ruta descrita en el documento del horario.

## Cómo se comprueba

74 pruebas Node y 30 Python cubren geometría, calendario, despacho, atención, conservación de
pasajeros, reutilización de vehículos y reversibilidad del reloj. Dos bancos de carga miden
preparación, muestreo y memoria; el de estrés apaga el horario publicado a propósito para seguir
midiendo el mismo techo que las referencias anteriores.

La comprobación que importa no es que el simulador corra, sino que el recorrido de cada servicio
dure lo que dura en el horario publicado. Ese criterio, ruta por ruta y con sus resultados, está en
[Horario publicado](HORARIO_GTFS_20260912.md).
