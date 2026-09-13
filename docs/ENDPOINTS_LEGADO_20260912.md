# Endpoints de legado: qué se probó, qué se descartó y por qué

12 de septiembre de 2026. Direcciones públicas que aparecen en artículos, en catálogos y en
documentación anterior de este proyecto, y que **no** hay que volver a intentar. Se comprobaron una a
una en la fecha de arriba; el estado que se anota es el de ese día.

Está aquí para que la próxima búsqueda no repita el camino. Un endpoint muerto que nadie anotó cuesta
media tarde cada vez que alguien lo encuentra citado.

## Muertos: el alimentador anterior

| Dirección | Estado el 12/09/2026 |
|---|---|
| `gis.transmilenio.gov.co/gtfs/` | HTTP 500 |
| `gis.transmilenio.gov.co/gtfs/GTFS.zip` | HTTP 500 |
| `gis.transmilenio.gov.co/gtfs/vehiclepos.pb` | HTTP 500 |
| `gis.transmilenio.gov.co/gtfs/tripupdate.pb` | HTTP 500 |
| `gis.transmilenio.gov.co/gtfs/serviceAlerts.pb` | HTTP 500 |

Son las que citan los artículos y los catálogos de terceros cuando hablan del tiempo real de
TransMilenio, y las que este proyecto tenía anotadas en `docs/FUENTES.md` como «probadas, devolvieron
500». Las cinco siguen devolviendo 500: no es una caída pasajera, es un host abandonado.

**Lo que las reemplaza** es el alimentador vigente de TRANSMILENIO S.A., con su propio índice en
`manifest.json`; su dirección se configura en `tools/gtfs.local.json` y queda anotada en el
repositorio privado. Ver
[Captura del alimentador en vivo](CAPTURA_RT_20260912.md) y
[Horario publicado](HORARIO_GTFS_20260912.md).

## Cerrado: la carpeta de servicios dinámicos

`gis.transmilenio.gov.co/arcgis/rest/services/GTFS_dinamicos` responde, pero a un anónimo le
devuelve `{"folders":[],"services":[]}`. En ArcGIS eso es lo que se ve cuando los servicios están
protegidos, no cuando la carpeta está vacía. No es una vía abierta y no se insistió: el alimentador
publicado da lo mismo sin credencial.

En ese mismo servidor sí están abiertas 21 carpetas de geometría estática, que el proyecto usa para
otras cosas.

## Vivos pero descartados, con el motivo

Estos responden. No se usan, y conviene que quede escrito por qué, para no «descubrirlos» otra vez.

**`alerts.pb` del alimentador vigente** — 310 alertas vigentes, todas con efecto `DESVÍO`.
**Ninguna toca troncal ni dual**: las rutas mencionadas son 1.629 de zonal urbano, 44 de alimentador
y 8 de zonal especial. Además no son incidentes vivos: la vigencia mediana es de 498 horas, el máximo
6.789, y la más antigua arranca el 22/12/2025. Son planes de manejo de tráfico de obra con cabeceras
escritas para despachadores (`PMT CLL 54SUR CRA80.`). En una vista troncal el panel saldría vacío
siempre.

**`tripupdates.pb` del alimentador vigente** — cada viaje trae **una sola** `StopTimeUpdate`, la de
la próxima parada, y sin campo `delay`. Peor: en dos lecturas separadas, todas las llegadas estaban
ya en el pasado, con una antigüedad mediana de unos 209 s. No es una hora estimada de llegada; parece
el registro de un evento anterior. No se presenta como ETA mientras no se valide su semántica
siguiendo un viaje completo.

**`storage.googleapis.com/gtfs-estaticos/`** — bucket público y listable con **310 paquetes estáticos
diarios** desde 2020-01-24. Vive, pero es **horario histórico, no operación**: entre el 15/08 y el
12/09/2026 los viajes programados apenas pasan de 180.356 a 181.642. Minar esa historia no aporta;
observar la operación exige capturar las posiciones uno mismo. Sirve solo si algún día hace falta
reconstruir cómo estaba programada la red en una fecha pasada.

## Trampas del alimentador vigente

No son legado, pero se documentan aquí porque también son cosas que cuesta descubrir dos veces:

- **`FeedHeader.timestamp` está congelado** desde hace días en el mismo valor. El sello que avanza es
  el de los vehículos.
- Ese sello es **uno solo para los 5.500 vehículos**: la hora de construcción del lote, no la del GPS
  de cada bus. Cada vehículo refresca a su ritmo y el feed repite mientras tanto su última posición,
  así que entre dos lotes un bus puede aparecer quieto y después saltar. No derivar velocidades de
  ahí.
- Las posiciones viajan en **coma flotante de 32 bits**: un metro de cuantización.
- El servidor responde **`Access-Control-Allow-Origin: null`**, así que el navegador no puede pedirlo
  directo; hace falta intermediario. También **ignora `If-Modified-Since`** y devuelve siempre 200.

## Retirado de este repositorio

La instantánea de toda la red venía antes de un servicio configurado en local, por recuadro
geográfico. Se retiró el 12/09/2026 al sustituirla el alimentador publicado, que no necesita
credencial, no trunca y coincide con el catálogo del simulador por construcción. Con ella se
retiraron sus dos pruebas.

Aquella lectura llegaba marcada `truncated` en todas sus respuestas: veía el 96 % de la flota
troncal, pero solo el 64 % del sistema.

La lectura **por servicio** sí se conserva, porque aporta lo que el alimentador abierto no trae:
ocupación, accesibilidad, destino depurado y metros recorridos sobre la ruta. Sus direcciones y su
credencial no están en este repositorio —se leen de `tools/en_vivo.local.json`, que nunca se
versiona— y su documentación detallada tampoco: vive en el repositorio privado.
