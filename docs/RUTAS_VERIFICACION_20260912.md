# Verificación del catálogo contra la operación publicada

12 de septiembre de 2026. Contrasta el catálogo de `services.json` —instantánea del 10 de
septiembre— con dos fuentes independientes: los **tableros de salida** de 139 estaciones,
descargados con `fetch_station_departures.py` del servicio que se configura en local, y los **boletines oficiales** de TransMilenio
que explican los cambios. Nada de lo que sigue modifica el catálogo; es la evidencia para
decidirlo después.

El contraste importa porque un registro puede estar pendiente por dos razones muy distintas:
porque la fuente no publica su trazado, o porque el servicio dejó de existir. Hasta ahora el
proyecto no podía separarlas. El tablero sí: si un servicio tiene salidas, opera.

## Extensión de la Av. Ciudad de Cali

[Boletín del 17 de agosto de 2026](https://www.transmilenio.gov.co/comunicaciones/noticias-de-transmilenio/boletines-informativos/entra-operacion-extension-av-ciudad-cali).
Textual: «El servicio **A61 - F61** extiende su recorrido desde el Portal Américas hasta la
estación Tibanica – Primavera y **cambia su identificador de retorno a la letra Z (Z61)**».

| Código | Catálogo | Vigencia | Salidas en tableros | Lectura |
|---|---|---|---|---|
| A61 | pendiente, sin trazado | 28 jun – 14 ago | **10** | **Opera.** Pendiente por falta de geometría, no por inexistencia |
| F61 | pendiente, sin trazado | 28 jun – 14 ago | 0 | Retirado: la Z lo reemplaza |
| Z61 | utilizable | **18 ago** – 19 sep | 11 | Nuevo identificador del sentido de retorno |
| C19 | utilizable | 28 jun – 19 sep | 19 | Extendida a Portal Américas |
| F19 | utilizable | **18 ago** – 19 sep | 19 | Extendida a Portal Américas |

Las fechas de vigencia del propio catálogo ya codificaban el cambio: Z61 arranca el 18 de
agosto, al día siguiente del boletín. El dato estaba bien; solo estaba repartido entre un
registro pendiente y uno utilizable, sin nada que dijera que son el mismo servicio.

El boletín también explica por qué **Tibanica - Primavera, Los Laureles e Islandia** son las
únicas estaciones operativas sin tablero: abrieron con esta extensión el 17 de agosto. La
fuente ya las tiene con el mismo identificador que usa el proyecto, pero todavía no publica sus
salidas.

Los horarios del boletín explican además por qué cada sentido aparece en franjas distintas:
A61 opera de 4:30 a 10:00 a. m. y Z61 de 3:00 a 9:00 p. m. entre semana. Un muestreo de
tableros que solo mirara la mañana concluiría que Z61 no existe.

## Renumeración de los servicios hacia Soacha

[Comunicado del 27 de agosto de 2026](https://www.transmilenio.gov.co/comunicaciones/noticias-de-transmilenio/comunicados-oficiales/viajes-mas-directos-faciles-identificar-usuarios-sur-bogota-soacha).
Textual: «G41 será S41, G42 será S42, G43 será S43, G45 será S45, **G46 será S46**, G48 será
S48», desde el 29 de agosto.

| Pareja | G: vigencia | G: salidas | S: vigencia | S: salidas |
|---|---|---|---|---|
| G41 → S41 | 28 jun – **28 ago** | 0 | **29 ago** – 19 sep | 7 |
| G42 → S42 | 28 jun – 28 ago | 0 | 29 ago – 19 sep | 9 |
| G43 → S43 | 28 jun – 28 ago | 0 | 29 ago – 19 sep | 14 |
| G45 → S45 | 28 jun – 28 ago | **5** | 29 ago – 19 sep | 5 |
| G46 → S46 | 28 jun – 28 ago | 0 | 29 ago – 19 sep | 8 |
| G48 → S48 | 28 jun – 28 ago | 0 | 29 ago – 19 sep | 10 |

Cinco de las seis parejas son inequívocas: la G termina el 28 de agosto y no tiene ni una
salida; la S empieza el 29 y sí las tiene.

**G45 parecía la excepción y no lo es: es el sentido de vuelta.** Contrastando los recorridos
publicados con los tableros:

| Registro | Recorrido | Vigencia | Salidas | lineId |
|---|---|---|---|---|
| G45 / 393 | → San Mateo | 28 jun – **28 ago** | 0 | — |
| S45 / 5587 | Portal Sur → San Mateo | **29 ago** – 19 sep | 5 | 13238 |
| G45 / 3929 | San Mateo → **Portal Sur** | 28 jun – 19 sep | 5 | 13239 |

La renumeración alcanza solo al sentido que entra a Soacha, que es lo que el comunicado dice:
toman la S «los servicios que **continúan su recorrido después del Portal Sur hacia** las
estaciones Bosa, La Despensa, León XIII, Terreros – Hospital Cardiovascular y San Mateo». El
sentido de vuelta conserva la letra de su zona de destino, y el de la 45 termina en Portal Sur,
que es zona G.

Los tableros lo confirman en las seis parejas: **todos los servicios con S van hacia San Mateo**,
y los de vuelta por ese mismo tramo salen con la letra de su destino —L41 a Bicentenario, K43 y
K53 a Portal El Dorado, D22 a Portal 80, M47 a Museo Nacional, B12 y B46 a Portal Norte, C30 a
Portal Suba, E48 al CAD, A52 a Flores, 4 a Héroes—. La letra nombra la zona de destino, no la
identidad del servicio; leer «G46 será S46» como que la G desaparece lleva a la conclusión
equivocada.

El catálogo, entonces, **no está desactualizado en este punto**: tiene el G45 viejo hacia San
Mateo terminado el 28 de agosto y el G45 de vuelta vigente, que son dos cosas distintas. Dos
lineId vivos y distintos en el mismo tablero descartan que sea un registro sin retirar.

Del mismo comunicado, K53 y G53 son servicios nuevos: ambos utilizables desde el 29 de agosto
y con 11 salidas cada uno.

## Códigos del catálogo sin salidas: no todos faltan

Seis códigos utilizables no aparecen nunca en los tableros: C84, F63, L82, M84, M85 y P85.
No es que no operen: **la fuente nombra las parejas duales con un solo código**. En los
tableros aparecen `FZ63` (4 salidas), `MC84` (6), `ML82` (9), `MK86` (17) y `P85-M85` (9).
Es una convención de nombres distinta, no una ausencia. Conviene tenerlo presente antes de
concluir que un servicio desapareció por no encontrarlo.

Los códigos numéricos que aparecen en los tableros y no en el catálogo (`6-1`, `8-3`, `13-6`,
`2-11`…) son alimentadores y zonales, fuera del alcance del simulador.

## Servicios cuyo terminal publicado ya no es el del catálogo

Al derivar el punto de atención, 121 paradas no se pudieron asignar porque el tablero de esa misma
estación anuncia el servicio **hacia otro destino** que el terminal que el catálogo le atribuye. No
es un fallo del emparejamiento: es el emparejamiento negándose a afirmar algo que la fuente no
respalda. Los casos claros:

- **C17**, 39 salidas sin equivalente. El catálogo dice que termina en **Portal Suba**, con 22
  paradas. Los tableros lo anuncian hacia **Suba - Tv. 91** y **La Campiña**, y en ninguna de sus
  22 paradas coincide. El servicio parece haberse acortado.
- **D81**, 18. Es la variante Ciclovía, que el catálogo ya marca con calendario ambiguo.
- **A61**, 10, y **F23**, 9, que ya están identificados como pendientes por otras razones.
- **J76**, 9, que no está en el catálogo.
- Las rutas numeradas 1 a 8 aportan entre 3 y 5 cada una, casi siempre en un solo sentido.

Esto **no se corrige aquí ni cambia el catálogo**: queda anotado en `unmatched` dentro de
`station_wagons.json`, con el motivo escrito para cada caso, y es material para la próxima
renovación de la instantánea de servicios.

Vale la pena separar esto de un problema de muestreo, porque la respuesta es distinta. De las 245
paradas sin punto publicado: 23 son parejas duales que el planificador nombra con un código
combinado —`FZ63`, `MC84`, `ML82`, `MK86`, `P85-M85`—, que se resuelven por regla y en su mayoría
atienden en plataformas de portal cuya numeración no corresponde a los vagones del catálogo; 121
son este desajuste de terminal; y solo 101 podrían deberse a que la salida no cayó en ninguna de
las cinco franjas horarias. **Descargar más franjas atacaría menos de la mitad del problema**, y
los servicios con huecos operan 17,5 h diarias de mediana, exactamente como el resto: no son
servicios de ventana estrecha que el muestreo se pierda.

## Qué queda decidido y qué no

- **Nada se cambió en el catálogo.** Los 20 registros pendientes siguen pendientes, como manda
  [CONTINUAR.md](../CONTINUAR.md).
- **A61 no se puede activar todavía.** `probe_pending_routes.py`, ejecutado el 12 de septiembre,
  encontró trazado y paradas publicados solo para L81/5280, M85/4596 y P85/4595. A61 sigue sin
  geometría: activarlo obligaría a inventar el recorrido, que es justo lo que la regla 4 de
  [ACTUALIZAR_DATOS.md](ACTUALIZAR_DATOS.md) prohíbe. Lo que cambia es el motivo anotado: no es
  un servicio dudoso, es un servicio que opera y cuyo trazado la fuente no publica.
- **F61, G41, G42, G43, G46 y G48 sí pueden darse por retirados**, con dos evidencias
  concordantes: vigencia terminada y cero salidas.
- **G45 no era una contradicción**, sino el sentido de vuelta: queda resuelto arriba, con dos
  identificadores de línea vivos y distintos en el mismo tablero.
- **C17 queda abierto**: el catálogo lo termina en Portal Suba y los tableros lo anuncian hacia
  Suba - Tv. 91 y La Campiña. Hace falta el recorrido publicado para decidir.

Este contraste es repetible: `fetch_station_departures.py` y comparar códigos contra
`services.json`. Vale la pena rehacerlo cada vez que se renueve el catálogo, porque detecta
servicios retirados que la instantánea todavía arrastra.
