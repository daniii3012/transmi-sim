# Continuidad — Transmi

## 30 sep. 2026 — nuevo lugar de trabajo y plan por fases

- El trabajo sigue en `~/Documents/code/tm/transmi-sim` (copia completa del árbol anterior, con
  `data/raw` y `work`). El árbol anterior queda intacto pero ya no es el de trabajo: nada nuevo se
  escribe allí.
- **Plan vigente: `docs/PLAN_DE_TRABAJO_20260930.md`**, fases 0 a 8. Sustituye la lista de pendientes
  de abajo. Reparto entre sesiones: una sola sesión por fase; la que tome una fase la anota aquí con
  fecha y los archivos que toca.
- Hallazgos de la revisión que abren las fases 1 y 2: puntos de control de otra versión (`20260928.4`
  frente a `20260929.15`) que obligan a simular el día entero al abrir; crucero sin dimensión de
  franja; transbordos que no esperan en la estación de transbordo.

### Fase 1 (30 sep.) — hecha

- Puntos de control con la huella del motor (`app/dist/engine.json`, `tools/engine_fingerprint.mjs`):
  módulos del motor sin la cadena `?v=` más los JSON que simula. Un cambio de interfaz ya no los
  invalida. **Tras tocar el motor o sus datos: `node tools/engine_fingerprint.mjs`**; la prueba
  `engine.test.mjs` y el workflow fallan si no. El precálculo empieza ayer (la madrugada es su día de
  servicio) y el lanzador local lo rehace en segundo plano si no es del motor actual o no cubre ayer
  y hoy (~7 min).
- Cámara: los márgenes del hueco libre se miden de los paneles reales; plegar o desplegar la ficha
  desliza la vista al centro del hueco nuevo. Botón «Girar con el bus» al seguir uno: la vista pasa a
  3D y gira con el rumbo suavizado; girar a mano, el norte o dejar de seguir lo apagan.
- Logo de móvil igual al de escritorio, a escala. `?v=20260930.1`.

### Fase 2, velocidad (30 sep.) — hecha

- Crucero = velocidad libre medida en cada punto (`v_free_kmh`, percentil 85 de lo que se rueda),
  aceleración 0,6 m/s². La distribución simulada calca la observada (p90 50 frente a 50, p97 56
  frente a 57). Viajes 0,89 del tiempo medido (antes 0,98): faltan colas de andén y detenciones en
  tráfico (sim 3 % del tiempo, calle 10,7 %). Detalle en `docs/VELOCIDAD_LIBRE_20260930.md`.
- Regenerar el campo: `build_speed_field.py --capture <lecturas> --exclude 20260914 --stops
  <stops.txt del 12 sep.>` con el Python geográfico, luego `build_services.py --perfiles`.
- La hora casi no cambia la velocidad en marcha: no hizo falta dimensión de franja.

### Fase 2, pasajeros (30 sep.) — transbordos hechos; espera por ruta pendiente

- `od_profiles.json` (esquema 2) trae por estación y franja los transbordos del día (`transfer`,
  llevados a todas las entradas) y hacia dónde sale el segundo tramo (`transfer_sectors`); el
  descenso ya cuenta a quien baja a cambiar. `passengers.mjs` los pone a esperar en la estación de
  cambio (`transferRate`). Ricaurte 139 mil al día, Jiménez 73 mil; en la simulación, 220–250
  personas esperando en Ricaurte en horas activas. Viajes 0,90 del tiempo medido.
- **Pendiente, causa de Las Nieves:** la espera se agrupa por estación y sentido y cada bus sube la
  parte de 3 servicios (`ROUTE_OPTIONS`); en la calle cada quien espera su ruta. Separar la espera por
  ruta con el primer tramo de cada viaje asignado (ya se calcula en `build_od_profiles.py`) es el
  siguiente cambio del motor. Las Nieves tiene poco transbordo (4,8 mil al día).
- Documentación de pasajeros: solo «validaciones de datos abiertos»; el método queda en el código.

## 28 sep. 2026 — estado

Todo esto está en `main` **solo en local** (desde `da1c904`; no se ha empujado a `origin`).

- **Motor de espacio físico** (`app/dist/traffic.mjs`): cada bus ocupa su carril en una red de
  tramos compartidos, paso de 1 s, IDM, empalmes con turnos, carril de andén por vagón, onda verde
  estimada, flota con tope real (2.252) y llegadas en vacío. Detalle, decisiones y validación en
  `docs/ESPACIO_FISICO_20260927.md`; resumen en `docs/COMO_SE_SIMULA.md`.
- **Carriles medidos** de la calzada exclusiva (`tools/build_busway_geometry.py`, capa Calzada del
  Mapa de Referencia): 237 km con dos carriles y 72 con uno.
- **Vista 3D** en `map.mjs`: cámara en perspectiva, buses con cuerpos y fuelles, andenes con
  cubierta, edificios de Catastro por teselas (`tools/build_buildings.py`, 707.165 construcciones: todas a 350 m, el 70 % hasta 1 km y el 30 % en el resto de la ciudad).
- **Estaciones**: 109 de 151 con andén o contorno de OSM (`build_station_layouts.py --keep`).
- **Puntos de control guardados**: binario compacto e idéntico a simular (`exportCheckpoint`),
  llave de escenario, IndexedDB en el navegador y precalculados del escenario inicial al publicar
  (`tools/build_day_checkpoints.mjs`, no versionados).
- **Interfaz**: un solo sistema visual (`theme.css`), panel Parámetros con explicaciones, color por
  ocupación, procedencia de cifras en «Datos», móvil revisado.

Validación del día laborable: mediana 1,02 frente a lo observado (p10 0,91, p90 1,15), 0,88 frente
al horario publicado, pico de 1.666 buses y 2.118 vehículos. 89 pruebas Node y 47 Python.

### Hecho el 28 sep. (segunda parte)

- Reproducción fluida: un instante dentro del último paso ya no restaura un punto de control.
- Cada parada en su vagón del GTFS (`wagon_stops.json`); Mandalay, Pradera, Ricaurte y Banderas
  corregidos. `field_corrections.json` retira el semáforo de la NQS hacia el norte (Av. El Dorado).
- En estación, al vagón del fondo se llega por el carril de paso, con cortesía del de andén.
- Biarticulados con tres cuerpos; ficha y hoja de móvil restauradas (reglas CSS cortadas).
- Sentido de salida y descenso medidos por estación (`od_profiles.json`).

### Hecho el 28 sep. (tercera parte)

- Puentes y deprimidos de OSM (`busway_structures.json`): carril único en puentes, en el mismo punto
  para los dos sentidos; altura en 3D con rampas; transiciones de carril de 30 m; tramos sueltos fuera.
- Estación: el que espera su vagón ocupado entra al carril del andén detrás del que atiende (se
  acabaron las filas de CAN, Virrey y Calle 85 a las 18:00).
- Calzada que ningún recorrido usa (`busway_context.json`): la media glorieta de Banderas y otros 55 km.
- Patios troncales (`depots.json`, IDECA) llenos con los buses fuera de servicio.
- Estaciones sin geometría OSM: vagones donde el GTFS pone sus paradas.

### Hecho el 28 sep. (cuarta parte): base al día

- Catálogo de rutas del 28 sep., GTFS del 28 sep. y validaciones del 14 al 27 sep. (dos semanas
  completas, 22.233.675 registros). Patio Bonito ya viene operativa en las fuentes con sus 12
  recorridos y sus dos vagones; se retiró su corrección de campo.
- `build_services.py`: lo que la instantánea nueva no trae completo (registro sin trazado, variante
  de Ciclovía que deja de listarse, trazado nuevo que deja las paradas lejos) se toma de la anterior
  más reciente que sí lo tenga; cada ruta dice de qué carpeta salió. 119 servicios listos (antes 117).
- Los paraderos SITP se quedan en la instantánea del 10 sep.: la del 28 reasignó códigos de cenefa.
- `build_schedule.py` alinea por nombre de estación cuando el recorrido local empieza o termina una
  parada antes que el paquete (Z63). `aggregate_validation_period.py` promedia una estación que abre
  a mitad del periodo desde su primer día.
- En calle el ritmo del horario no baja de 15 km/h: un tramo con tiempo de sobra no pone al bus a
  gatear; llega antes.
- Calles junto a la troncal, cruces en cebra y puentes peatonales (`cross_streets.json`); esquinas
  de las calles redondeadas con arcos.

### Hecho el 28 sep. (quinta parte)

- NQS hacia el norte antes de la Calle 26: bifurcación con un carril por rama (`lane_splits` en
  `field_corrections.json`, `Guideway` y `splitLane` en `traffic.mjs`). En la punta de 6:30 a 8:30,
  los que siguen al norte pasan de 4.020 a 330 bus-segundos detenidos antes de separarse.
- La medición en la calle se busca por par de paradas cuando el paquete renumera la ruta: Z63 y otros
  siete servicios vuelven a tener tiempos medidos; solo B27 queda sin ellos.
- Círculos de pasajeros por encima de todo, de 6 a 30 px y de rosado a rojo según la gente (lleno con
  250); puentes peatonales semitransparentes como los viales; capa «Puentes»; edificios más claros y
  con menos contraste.

### Pendientes, en este orden

2. ~~Rediseño de la interfaz móvil~~ hecho el 28 sep. (`mobile.css`): reloj en píldora arriba,
   métricas en una línea, controles del mapa reducidos a 3D, capas, encuadrar y tema, y una sola hoja
   abajo con tirador de tres alturas y los paneles como selector; la ficha es esa misma hoja.
3. Paradas que quedan fuera del vagón o estaciones que pisan una calzada: revisión caso a caso contra
   imagen satelital; solo con datos, no a ojo.
4. Posición real de los buses en los patios (hoy en filas por área): no hay dato abierto de puestos.
5. Empujar a `origin` cuando Daniel lo confirme; publicar Pages solo si lo pide.

## Qué es y qué no

Simulador geográfico 1:1, en 2D y 3D, de los servicios troncales y duales de TransMilenio. Zonales y cable
quedan fuera; el proyecto de conducción 3D está pausado en `archive/transmi3d`. Diseño inspirado en
Subway Builder y Mini Metro, sin construcción de líneas: la red es la que existe.

**No hay posiciones GPS en vivo.** Cada bus en pantalla es una posición que calcula el modelo a
partir del horario publicado y de la velocidad medida en ese trecho de corredor. Las lecturas de
posición de la flota entraron una sola vez, antes de simular, para medir lo que el paquete publicado
no separa; de ellas quedan `data/curated/speed_field.json`, `data/curated/fleet_types.json` y
`data/curated/observed_times.json`, fechados y con su método escrito.

Las estimaciones son ajustables y siempre se rotulan como estimación. Los carriles salen del ancho
medido de la calzada; en estación hay siempre carril de andén y de paso.

## Ejecutar y desarrollar

- Fuentes estáticas editables en `app/dist`, Three.js r186 local y cámara en perspectiva. Sin npm ni
  bundler. `?depurar` expone `window.transmi.map` y sigue dibujando con la pestaña oculta.
- `ABRIR_SIMULACION_2D.command`: loopback `http://127.0.0.1:8766/`.
- `ABRIR_EN_RED_LOCAL.command`: escucha LAN en el puerto 8767 e imprime la IP de este computador.
  Ambos sirven solo `app/dist`, sin caché y sin listar directorios. Cada navegador corre su propia
  simulación.
- Python geográfico con shapely/pyproj para las herramientas de construcción; el Python del sistema
  basta para servir la web y correr las pruebas. Node en PATH.
- `work/` está ignorado. Las transacciones crudas de validaciones nunca entran a Git: el agregado
  versionado basta para reproducir.
- `web/transmi2d` es un enlace de compatibilidad histórica, no otra aplicación.

### Reglas del árbol

- **Preparar por nombre, nunca `git add -A`**, y comprobar que cada archivo traiga solo lo suyo.
- **Resolver conflictos por trozo, no por archivo.** Quedarse con un lado entero ya borró una vez la
  línea que carga `speed_profiles.json`, que habría dejado al motor sin campo de velocidad y sin
  avisar.
- **`services.json`, `speed_profiles.json` y `schedule.json` no se editan ni se fusionan a mano**: se
  regeneran con `build_services.py` y `build_schedule.py`, que es lo único que deja coherentes sus
  hashes de procedencia.
- **La cadena `?v=` la sube una sola sesión** y tiene que ser idéntica en todo `app/dist`. Sin el
  salto, el navegador sigue ejecutando el código anterior.
- `operation.mjs` y `signals.mjs` son un par inseparable: con uno de cada versión, `limitAt` recibe
  el argumento equivocado y revienta en `travelProfile`.

## Estado del modelo

137 registros de catálogo: 117 utilizables de 105 códigos y 20 pendientes. El mapa bruto trae 116
registros y 100 códigos, que no son 116 rutas únicas. C15 Chapinero Ciclovía es zonal y se excluye;
C15 y H15 troncales tienen 19 paradas por sentido. F23 conserva un único destino publicado, Portal
Américas, y la variante duplicada de Banderas queda excluida con su motivo escrito en
`data/curated/services.json`. **Los 20 pendientes siguen pendientes a propósito**: están vencidos,
sin geometría o con calendario ambiguo, y no se rellenan con líneas rectas.

- Reloj, calendario y festivos colombianos, medianoche, demanda pico/valle, geometría métrica,
  curvas, aceleración y frenado. Motor por eventos en un worker; recorridos y reservas reproducibles
  al retroceder.
- **Tipo de bus leído de la flota.** Cada vehículo lleva pintada una etiqueta que las lecturas de
  posición publican, y esa etiqueta separa articulados, biarticulados y duales. Los 108 servicios con
  lecturas salen de una sola familia, sin mezcla. Se retiró el criterio de 18 km, que erraba en 25 de
  76. `tools/classify_fleet.py` escribe `data/curated/fleet_types.json` y `build_services.py` lo
  adjunta como `vehicle_profile`. Capacidad fija 80/160/240 por decisión de modelo; los servicios sin
  lecturas usan articulado y lo declaran estimación; F63/Z63 conservan su perfil publicado de 160.
  Detalle en `docs/TIPOS_DE_BUS_20260912.md`.
- **La velocidad la pone el lugar.** Se retiró el crucero plano de 60 km/h en calzada segregada y la
  regla de gastar el sobrante parado en la aproximación, que dejaba media flota quieta contra el
  28 % real. `data/curated/speed_field.json` guarda corredor, sentido y cubeta de 100 m con la
  velocidad de travesía de quien pasa de largo; `build_services.py` lo resuelve a
  `app/dist/speed_profiles.json` (117 servicios, cobertura 98 %). Del denominador se descuentan la
  atención, lo quieto en cualquier andén y la espera junto a un semáforo corroborado, porque el motor
  ya modela las tres.
  **Un bus solo se detiene por rojo o por andén ocupado**: en calzada segregada no se fabrica ninguna
  espera. Lo que sobra se gasta rodando más despacio y, si aun así llega antes, el adelanto viaja con
  el viaje y se devuelve en el tramo siguiente, hasta 90 s. Detenidos en tráfico 33 % → 1 %; flota
  quieta 51 % → 20 %; tramos con espera 82 % → 6 %, y esos son todos de calzada mixta, con máximo
  45 s. Detalle en `docs/VELOCIDAD_POR_LUGAR_20260912.md`.
- **La operación medida.** El campo de velocidad y la tabla de flota se rehicieron con todas las
  lecturas —8 millones de pares, 98 % de cubetas con medición propia— en vez de la primera medición
  suelta. **El día de la manifestación de la Calle 80 queda excluido**: dejó el corredor a 8,4 km/h
  con el 60 % del tiempo detenido entre Minuto de Dios y Ferias, y `build_speed_field.py --exclude`
  lo aparta dejándolo escrito en la salida. Hora y tipo de día **no** hacen falta en el campo: la
  forma del corredor correlaciona 0,93–0,97 entre franjas y el nivel ya lo pone la columna por tipo
  de día del horario publicado. La densidad vale un 14 % en punta y sigue sin implementarse. El 73 %
  de la detención del corredor ocurre a menos de 300 m de una estación, o sea que es cola de andén.
  Detalle en `docs/OPERACION_MEDIDA_20260912.md`.
- **Tiempos entre paradas medidos.** Validado primero que el despacho está bien —flota simulada
  contra observada, mediana 1,02—, se midieron los tiempos por tramo con `build_observed_times.py` →
  `data/curated/observed_times.json`. El 97 % de los tramos del catálogo recibe tiempo propio. Lo
  publicado acierta en los tramos cortos (1,00) y acolcha los largos (0,77). `build_schedule.py` los
  adjunta como `observed` junto a `segments` y el motor los prefiere; `observedRunning:false` vuelve
  a lo publicado. Efecto: velocidad rodando 23,3 → **28,4 km/h** (lo observado es 28,2), viaje
  60,9 → 53,1 min, y los viajes que no alcanzan su tiempo caen de 3.554 a 206.
- **Salidas del horario publicado.** 115 de los 117 servicios utilizables despachan a las horas del
  GTFS; los 2 restantes conservan la regla de reserva y constan con su motivo en
  `app/dist/schedule.json`. Un registro publicado que regresa al andén desde el que salió trae un
  tramo de más, el que cierra el bucle, y la cuenta local salía por uno: el registro se descartaba
  entero. Afectaba a F63/Z63 —347 viajes de día laborable, que dejaban ese servicio sin un bus entre
  las 5 y las 21 h— y a M86/K86, 556 viajes más. `build_schedule.py` aparta ese tramo solo cuando la
  cuenta no cuadra sin hacerlo, para no tocar los registros que ya encajaban. Salidas 44.402 →
  47.190. Detalle en `docs/HORARIO_GTFS_20260912.md`.
- **Demanda medida sobre 17 días** (24 ago.–9 sep. 2026, 28.014.777 validaciones): perfil horario por
  tipo de día, con factores medidos sábado 0,654 y domingo 0,302 frente a los 0,70/0,55 estimados que
  reemplazan; el domingo estaba sobreestimado un 80 %. El contraste con 15 días de marzo confirma
  factores estables y un nivel 7,3 % más bajo, uniforme. OD, descensos, direcciones y abandono medio
  de 30 min siguen estimados. Detalle en `docs/DEMANDA_MULTIDIA_20260911.md` y
  `docs/DEMANDA_COMPARACION_MARZO_20260911.md`.
- **Calzada real de OSM** bajo los corredores: 929 vías conservadas de 1.203 descargadas, 341 con
  carriles publicados. Los buses siguen la polilínea publicada del servicio, no esta calzada.
  `docs/CALZADAS_20260911.md`.
- **Geometría física de 40 estaciones** en OSM: nueve portales, Banderas, Ricaurte y Jiménez, y las 28
  troncales con más servicios. Las demás mantienen vagones esquemáticos.
  `docs/TODOS_LOS_PORTALES_20260911.md`.
- **Semáforos: 723 con evidencia nodal directa**, 450 en calzada exclusiva y 273 en tramos de calle de
  los duales. Ciclos estimados de 90 s, frenado métrico y espera reproducible. No hay coordinación ni
  colas microscópicas en cruces. `docs/SEMAFOROS_20260911.md`.
- **Punto de atención publicado** por estación y sentido en 1.303 de 1.557 paradas troncales;
  `operation.mjs` lo usa en vez del reparto determinista cuando existe y lo marca en `wagonSource`.
- **Planificador** sobre toda la red utilizable, fecha y hora independientes, hasta tres transbordos y
  seis horas de horizonte. No predice fases de semáforo ni aforo. `docs/PLANIFICADOR.md`.
- **Interfaz adaptable** en `responsive.css` y `shell.mjs`: navegación inferior en móvil, panel
  plegable, menú Más para los controles secundarios, zoom con dos dedos y reloj contextual.
  `docs/INTERFAZ_MOVIL_20260912.md`.
- No se guardan escenarios: no había dónde ver ni borrar lo guardado, y al reabrir la página se
  volvía a un escenario viejo sin haberlo pedido. El tema y las estaciones favoritas sí se recuerdan.

## Reproducir y validar

Las instantáneas crudas **no se versionan**: `data/raw` está ignorada porque son cientos de MB, y
cada dato curado guarda dentro el hash de aquella con la que se construyó, así que la procedencia se
sigue pudiendo demostrar. Los scripts de descarga están separados de los de construcción y tampoco
viajan aquí: las fuentes no se actualizan en silencio. El procedimiento completo, con los nombres y
los parámetros de cada paso, está en `docs/ACTUALIZAR_DATOS.md`.

`classify_fleet.py`, `build_speed_field.py` y `build_observed_times.py` quedan en `tools` como
documentación del método; para volver a correr necesitan las lecturas de posición en crudo.

```bash
node --test app/tests/*.test.mjs                 # 86 pruebas
python3 -m unittest discover -s tests            # 47 pruebas
```

`test_build_speed_field.py` importa la proyección geográfica: necesita el intérprete con shapely y
pyproj. Las demás corren con el Python del sistema.

Referencia del motor de espacio físico: la red entera de 03:00 a 07:30 en ~4 s y el día completo en
~25 s en un computador de escritorio, unos 60 MB; con un punto de control guardado, cualquier hora en
menos de un segundo. Un punto de control pesa 0,43 MB (0,10 MB comprimido).

## Pendientes consentidos

- Los 20 registros de catálogo sin geometría o con calendario ambiguo. `docs/PENDIENTES_20260911.md`.
- **K86 es el nudo que queda.** El paquete publica la vuelta de la Séptima siguiendo derecho al
  aeropuerto —48 tramos, 04:30–21:03— más un bucle suelto, y desde las 21:05 los últimos viajes se
  quedan en el portal. El catálogo local corta por otro sitio: «Aeropuerto» son 4 paradas —medio
  bucle— y «Portal ElDorado», de 26, no trae la parada intermedia en el portal, que es justo el tramo
  que falta para que cuadre. Corregirlo toca una fuente curada contra su origen publicado: queda
  anotado, sin tocar.
- El 5,7 % de los tramos no alcanza su tiempo publicado ni rodando al crucero.
- La vigencia publicada del catálogo terminó el 19 de septiembre de 2026. El escenario se queda en esa
  foto hasta que se vuelva a medir.
- El término de densidad de tráfico: controlando por lugar vale solo un 5–8 %, así que no se
  implementa.
- Colas de buses en semáforos: **implementadas** con el motor de espacio físico
  (`docs/ESPACIO_FISICO_20260927.md`); el análisis previo sigue en `docs/COLAS_Y_ESPACIO_20260911.md`.
- Asignaciones oficiales de ruta, tipo y vagón; planos, patios e inventarios; calibración con una
  matriz origen-destino; fases y coordinación semafóricas reales.

Estas incertidumbres se mantienen visibles y enlazadas desde la propia aplicación.

## Publicación

Publicado en <https://daniii3012.github.io/transmi-sim/>. `.github/workflows/pages.yml` publica solo
`app/dist`, **se dispara a mano** y antes comprueba las pruebas del motor, que los JSON carguen, la
paridad byte a byte entre `data/curated` y `app/dist`, una única versión `?v=` y la ausencia de rutas
absolutas; tras desplegar verifica que los `.mjs` se sirvan como JavaScript. Detalle en
`docs/PUBLICACION_WEB_20260911.md`.

Cada visitante ejecuta su propia simulación en su navegador: no hay servidor ni estado compartido. No
es un sitio oficial de TransMilenio.
