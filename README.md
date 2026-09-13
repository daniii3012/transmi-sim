<div align="center">

# 🚍 Transmi · Bogotá en movimiento

**Simulador 2D de TransMilenio sobre la ciudad real, a escala geográfica 1:1.**

Recorridos, horarios, flota y pasajeros salen de datos abiertos oficiales.
Cada cifra del modelo dice de dónde viene y si está medida o estimada.

[![escala](https://img.shields.io/badge/escala-1%3A1%20geogr%C3%A1fica-0a7d3f)](docs/OPERACION_Y_DATOS.md)
[![servicios](https://img.shields.io/badge/servicios-117%20utilizables%20%C2%B7%2020%20pendientes-1f6feb)](docs/PENDIENTES_20260911.md)
[![datos](https://img.shields.io/badge/datos-12%20sep%202026-8957e5)](docs/ACTUALIZAR_DATOS.md)
[![sin npm](https://img.shields.io/badge/sin%20npm-JS%20est%C3%A1ndar%20%2B%20Python-6e7681)](docs/ARQUITECTURA.md)
[![pruebas](https://img.shields.io/badge/pruebas-82%20Node%20%C2%B7%2072%20Python-2da44e)](#desarrollo)

[**Abrir el simulador publicado**](https://daniii3012.github.io/transmi-sim/) ·
[Cómo se simula](docs/COMO_SE_SIMULA.md) ·
[Operación y datos](docs/OPERACION_Y_DATOS.md) ·
[Arquitectura](docs/ARQUITECTURA.md)

</div>

---

Explora los servicios troncales y duales, sigue un bus, abre una estación, mueve el reloj y ajusta
oferta y demanda. La interfaz busca la claridad de Mini Metro y los paneles flotantes de Subway
Builder. No se construyen líneas: la red es la que existe. La simulación **no** usa posiciones GPS;
los buses reales se consultan aparte, en la pestaña **En vivo**, que no alimenta el escenario.

## Empezar

```bash
python3 tools/serve_network_2d.py --open      # o doble clic en ABRIR_SIMULACION_2D.command
```

Abre <http://127.0.0.1:8766/>. No instala nada: ni paquetes JavaScript ni descargas de mapa al
jugar. Para verlo desde otro dispositivo del mismo Wi-Fi, `--lan --open` o
**ABRIR_EN_RED_LOCAL.command**, que imprime la dirección de este computador en el puerto 8767. Cada
navegador corre y guarda su propio escenario.

<details>
<summary><b>Las ocho cosas que se pueden hacer dentro</b></summary>

1. **Red y rutas → Ruta.** Busca C15, H15, F63, una estación o un destino. Elegir una fila destaca
   el recorrido; «Simular solo este servicio» cambia la operación. Explorar no reconstruye el
   escenario.
2. **La red ahora.** Resume el instante del reloj: demanda por hora del tipo de día, reparto de la
   flota, estaciones con más espera y buses por troncal. La curva salta a esa hora al hacer clic.
3. **Troncal.** Combina letras de zona y aplica la selección; incluye los servicios que atienden o
   terminan en ellas. **Toda la red** restaura el conjunto.
4. **Reloj.** Pausa, avanza o retrocede 15 minutos, elige fecha y hora, desliza el día y acelera a
   1×, 8×, 32× o 120×. La velocidad del reloj no cambia los km/h de los buses.
5. **Paradas y buses.** Una parada muestra vagones, pasajeros esperando y próximas llegadas. Un bus,
   su velocidad, tipo, capacidad y próxima parada. **Terminales** muestra regulación y flota
   disponible; **Operación** ajusta frecuencias, velocidades y pasajeros.
6. **Planear viaje.** Servicios directos o con hasta tres transbordos para un origen, destino, fecha
   y hora, sin tocar la simulación. Por cada número de transbordos, la mejor opción y hasta dos
   alternativas plegadas, incluidas las que no llegan antes.
7. **En vivo.** **Todo el sistema** ubica los buses troncales y duales con su conteo por servicio;
   **Por servicio** sigue una ruta. Las dos lecturas tienen precisión distinta y la pestaña lo
   rotula. Requiere el servidor local y `tools/en_vivo.local.json`, que no se versiona.
El botón **Ahora** usa la hora de Bogotá y el de luna/sol recuerda el tema. No se guardan
escenarios: cada visita empieza en el momento actual.

</details>

## De dónde sale cada dato

| Dato | Fuente oficial | Qué aporta |
|---|---|---|
| Recorridos, paradas, horarios, colores | [Mapa digital](https://mapadigital.transmilenio.gov.co/) y API del buscador de rutas | 137 registros del catálogo ampliado, con vigencia, trazado y estaciones |
| Salidas y tiempos entre paradas | [GTFS de TRANSMILENIO](https://gtfs.transmilenio.gov.co/GTFS.zip) | 115 de los 117 servicios utilizables despachan a las horas publicadas, 47.190 salidas |
| **Tipo de bus y velocidad por trecho** | [GTFS-Realtime oficial](https://gtfs.transmilenio.gov.co/positions.pb) | La etiqueta de flota de cada vehículo: 87 servicios resueltos. Y 113,8 km de corredor en cubetas de 100 m con su velocidad y su tiempo detenido |
| Demanda de pasajeros | [Validaciones diarias SITP](https://datosabiertos.bogota.gov.co/dataset/validaciones-diarias-sitp) | 28.014.777 validaciones en 17 días; perfil por hora, estación y tipo de día |
| Calzada, semáforos, estaciones | [OpenStreetMap](https://www.openstreetmap.org/copyright) · Overpass | Carriles publicados, 723 semáforos con evidencia y 40 estaciones con geometría |
| Andenes, separadores, construcciones | [Datos Abiertos Bogotá](https://datosabiertos.bogota.gov.co/) · IDECA | Contexto urbano fechado y con licencia por ficha |
| Festivos | [Ley 51 de 1983](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=4954) | Calendario colombiano con traslados al lunes y Pascua |

Cada descarga guarda endpoint, fecha y SHA-256 en `data/raw`. La aplicación no consulta ninguna API
mientras se juega. Detalle y modo de actualizar en [actualizar los datos](docs/ACTUALIZAR_DATOS.md);
direcciones muertas que siguen circulando por ahí, en [endpoints de legado](docs/ENDPOINTS_LEGADO_20260912.md).

## Análisis que sostienen el modelo

Cada pieza del simulador tuvo que demostrarse antes de entrar. Lo que se midió y lo que se descartó:

| Análisis | Hallazgo |
|---|---|
| [Tipo de bus por servicio](docs/TIPOS_DE_BUS_20260912.md) | La etiqueta de flota del alimentador separa articulados, biarticulados y duales; los 87 servicios con lecturas usan una sola familia. Retira el criterio de longitud, que erraba en 25 de 76 |
| [Horario publicado](docs/HORARIO_GTFS_20260912.md) | Sustituye la regla inventada de 4 y 8 minutos por las salidas del GTFS, y el crucero único por la velocidad que se despeja de cada tramo |
| [La velocidad la pone el lugar](docs/VELOCIDAD_POR_LUGAR_20260913.md) | Cada trecho de corredor tiene su velocidad medida, de 10 a 44 km/h según dónde. Un bus solo se detiene por cola de andén o por rojo; lo demás se gasta rodando despacio. El apiñamiento, aislado del lugar, vale un 5–8 % |
| [Velocidad y detenciones](docs/VELOCIDAD_Y_DETENCIONES_20260912.md) | Por qué un bus simulado iba a 23 km/h frente al real, contrastado con cinco horas de captura |
| [Demanda sobre 17 días](docs/DEMANDA_MULTIDIA_20260911.md) | Sábado 0,654 y domingo 0,302 del día de semana: el domingo estimado estaba sobreestimado un 80 % |
| [¿Es agosto–septiembre representativo?](docs/DEMANDA_COMPARACION_MARZO_20260911.md) | Contraste con 15 días de marzo: factores por tipo de día estables y nivel 7,3 % más bajo, uniforme |
| [Semáforos con evidencia](docs/SEMAFOROS_20260911.md) | De 2.588 nodos evaluados se aceptan 723, por pertenencia directa a la vía del bus; el resto no entra |
| [Calzadas reales](docs/CALZADAS_20260911.md) | Se dibuja la calzada de OSM con los carriles publicados, en vez de suponerlos |
| [Geometría de estaciones](docs/ESTACIONES_OSM_20260911.md) · [portales](docs/TODOS_LOS_PORTALES_20260911.md) | 40 estaciones con plataformas, cubiertas y vías internas documentadas objeto por objeto |
| [Verificación del catálogo](docs/RUTAS_VERIFICACION_20260912.md) | Los tableros de salida separan un servicio sin geometría de uno que dejó de existir |
| [Registros pendientes](docs/PENDIENTES_20260911.md) | Por qué 20 registros siguen fuera y no se rellenan con líneas rectas |
| [Colas y espacio](docs/COLAS_Y_ESPACIO_20260911.md) · [captura en vivo](docs/CAPTURA_RT_20260912.md) | Qué se puede medir del alimentador oficial y qué no: su reloj está congelado y sus velocidades son ruido |

## Medido y estimado

El simulador nunca presenta una estimación como un dato. En la interfaz, cada ficha dice su origen.

**Medido, con fuente y fecha**

- Recorridos, paradas, colores, calendarios y vigencias publicados.
- Salidas y tiempos entre paradas del GTFS, por tipo de día.
- Tipo de bus de 87 servicios, leído de la flota que los atiende.
- Velocidad de cada trecho de corredor, en el 95 % de sus cubetas de 100 m.
- Demanda por hora, estación y tipo de día sobre 28.014.777 validaciones.
- Punto de atención publicado —vagón y puertas— en 1.305 de 1.557 paradas troncales.
- Carriles, semáforos y geometría de estación donde OSM los publica.

**Estimado, y marcado como tal**

- Capacidades 80 / 160 / 240 y longitudes 12 / 18,5 / 27,2 m: decisión de modelo, no ficha por marca.
- Los 34 servicios sin lecturas de flota usan el articulado de referencia.
- Frecuencias fuera del horario publicado, refuerzos en pico y reparto por sentido.
- La velocidad medida es de un sábado por la tarde y se aplica a todas las horas y tipos de día.
- El viaje completo dura 2,1 min más que el horario publicado, en tramos cuyo tiempo no se alcanza
  ni rodando al crucero.
- Descenso de pasajeros, abandono de espera (media 30 min) y orientación al centro de empleo: no hay
  matriz origen-destino real.
- Ciclo semafórico de 90 s y asignación de servicios a puestos físicos de estación.
- Dos carriles por sentido —atención y paso— como abstracción declarada.
- Patios y regulación en terminal, en forma abstracta.

**Conclusiones aún sin corroborar**

- Que la familia alta de la numeración de flota sea el biarticulado se apoya en la operación
  observada, no en un padrón publicado, que no existe. La separación entre familias sí está probada.
- El 71 % de vehículos troncales en esa familia un sábado conviene contrastarlo con un conteo
  oficial de flota.
- El tipo de bus y la velocidad por trecho se leyeron de una sola jornada, y sábado; la captura
  sigue corriendo para confirmarlos y para medir la punta de un día laborable.
- Un festivo entre semana queda 16,5 % por debajo de un domingo: falta medir más festivos.

## Cobertura y límites

La descarga del mapa trae **116 registros y 100 códigos distintos**, que no son 116 rutas únicas. El
catálogo depurado tiene **137 servicios y variantes: 117 utilizables y 20 pendientes**, y en la fecha
inicial 115 variantes tienen ventanas de salida. Los pendientes están vencidos, sin geometría o con
calendario ambiguo, y el panel **Datos** explica cada uno; no se rellenan con líneas rectas ni se
sustituye el K86 completo por su ramal de aeropuerto. F23 conserva un único destino publicado,
Portal Américas, y la variante duplicada de Banderas queda excluida con su motivo en
`data/curated/services.json`. C15 Chapinero Ciclovía es zonal y también se excluye; C15 y H15
troncales tienen 19 paradas por sentido.

No hay matriz origen-destino real ni tráfico mixto microscópico. Three.js dibuja el mapa 2D con
cámara ortográfica para mover muchos buses en pocos envíos a la GPU; la simulación es de módulos
propios y no depende de un motor 3D. El proyecto de conducción anterior queda pausado en
`archive/transmi3d`.

## Desarrollo

```bash
node --test app/tests/*.test.mjs                 # 82 pruebas
python3 -m unittest discover -s tests            # 72, con el Python geográfico de CONTINUAR.md
python3 tools/classify_fleet.py                  # vuelve a deducir el tipo de bus de las capturas
python3 tools/build_speed_field.py               # vuelve a medir la velocidad de cada trecho
```

| Carpeta | Qué hay |
|---|---|
| `app/dist` | Fuentes estáticas editables y dependencias vendorizadas, con sus licencias |
| `tools` | Descarga, normalización y análisis de datos abiertos |
| `data` | `raw` instantáneas con hash · `curated` decisiones revisables · `processed` auditorías |
| `docs` | Documentación activa y los análisis enlazados arriba |
| `tests`, `app/tests` | Pruebas Python y Node |

`tests/test_live_buses.py` corre con el Python del sistema y no toca la red. `web/transmi2d` es solo
un enlace de compatibilidad con la primera prueba.

[Arquitectura](docs/ARQUITECTURA.md) · [Actualizar los datos](docs/ACTUALIZAR_DATOS.md) ·
[Plan y alcance](docs/PLAN_DEL_PROYECTO.md) · [Planificador](docs/PLANIFICADOR.md) ·
[Validación](docs/VALIDACION_FASE2_20260911.md) · [Continuar](CONTINUAR.md)

---

<div align="center">

Publicado en **[daniii3012.github.io/transmi-sim](https://daniii3012.github.io/transmi-sim/)** ·
código en [daniii3012/transmi-sim](https://github.com/daniii3012/transmi-sim)

Cada visitante ejecuta su propia simulación en su navegador: no hay servidor ni estado compartido.
**No es un sitio oficial de TransMilenio y no muestra posiciones en vivo.**

</div>
