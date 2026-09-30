<div align="center">

# 🚍 TransMiSim

**Todo TransMilenio troncal y dual, simulado bus por bus sobre la Bogotá real, en 2D y 3D.**

[**Abrir el simulador**](https://daniii3012.github.io/transmi-sim/) ·
[Versión 1 (legado)](https://daniii3012.github.io/transmi-sim/legado/) ·
[Cómo se simula](docs/COMO_SE_SIMULA.md)

</div>

---

Un mapa a escala 1:1 de Bogotá donde cada bus troncal y dual sale a la hora del horario publicado,
ocupa su carril, frena en los semáforos, hace fila para entrar al vagón y sube y baja pasajeros. La
estética se inspira en Subway Builder y en la vista de transporte de Cities: Skylines.

**No son posiciones en vivo.** Cada bus es una posición que calcula el modelo a partir de datos
abiertos: horario publicado, velocidad medida en cada trecho de corredor y validaciones de los
pasajeros. Cada visitante corre su propia simulación en el navegador; no hay servidor.

## Qué se puede hacer

- **Mover el reloj**: cualquier fecha y hora, adelante o atrás, a 1×, 8×, 32× o 120×.
- **Seguir un bus**: su velocidad, ocupación y próxima parada, con la cámara detrás si se quiere.
- **Abrir una estación**: vagones, gente esperando y próximas llegadas.
- **Elegir qué se simula**: un servicio, una o varias troncales, o toda la red.
- **Planear un viaje** con hasta cuatro transbordos.
- **Cambiar el escenario** en Parámetros: más o menos buses (hasta ×5, para ver el sistema
  atascarse), más o menos pasajeros, semáforos, velocidades y **cierres de vía** colocados en el
  mapa.

## Usarlo en tu computador

Solo hace falta Python 3; nada que instalar.

```bash
python3 tools/serve_network_2d.py --open
```

Abre <http://127.0.0.1:8766/>. En macOS también sirve el doble clic en
`ABRIR_SIMULACION_2D.command`. Para verlo desde el teléfono en el mismo Wi-Fi, `--lan` (o
`ABRIR_EN_RED_LOCAL.command`): la consola imprime la dirección que hay que abrir.

## De dónde salen los datos

| Dato | Fuente |
|---|---|
| Recorridos, paradas, horarios y vagones | Catálogo de servicios y [GTFS de TRANSMILENIO S.A., datos abiertos](https://datosabiertos-transmilenio.hub.arcgis.com/search?tags=gtfs) |
| Velocidad por trecho y tipo de bus por servicio | Lecturas de posición de la flota, septiembre de 2026 |
| Pasajeros por estación y hora | [Validaciones diarias](https://datosabiertos.bogota.gov.co/dataset/validaciones-diarias-sitp), Datos Abiertos Bogotá |
| Calzada, carriles, edificios y patios | [Mapa de Referencia IDECA](https://datosabiertos.bogota.gov.co/dataset/mapa-de-referencia) y [OpenStreetMap](https://www.openstreetmap.org/copyright) |
| Festivos | Ley 51 de 1983 |

Lo medido y lo estimado van siempre separados, y la aplicación lo dice en cada ficha y en el panel
**Datos**. Estimaciones principales: capacidades 80/160/240 por tipo de bus, fases de semáforo, a qué
vagón va cada servicio donde no está publicado, y el reparto de destinos de los pasajeros. Límites y
pendientes: [Operación y datos](docs/OPERACION_Y_DATOS.md) y
[registros pendientes](docs/PENDIENTES_20260911.md).

## Para desarrollar

Fuentes estáticas en `app/dist`: JavaScript estándar, Three.js vendorizado, sin npm ni compilación.

```bash
node --test app/tests/*.test.mjs          # motor, planificador, datos
python3 -m unittest discover -s tests     # herramientas de datos
```

Tras tocar el motor o los datos que simula, `node tools/engine_fingerprint.mjs`. Más en
[Arquitectura](docs/ARQUITECTURA.md), [Actualizar los datos](docs/ACTUALIZAR_DATOS.md),
[Plan de trabajo](docs/PLAN_DE_TRABAJO_20260930.md) y [CONTINUAR.md](CONTINUAR.md).

---

<div align="center">

No es un sitio oficial de TransMilenio. Datos abiertos con sus licencias; Three.js bajo licencia MIT
(`app/dist/vendor`).

</div>
