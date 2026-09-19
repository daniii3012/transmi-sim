> Documento histórico del laboratorio. La aplicación actual y sus controles están en [README](../README.md) y [Operación y datos](OPERACION_Y_DATOS.md).

# Transmi 2D — primer laboratorio local

10 de septiembre de 2026. Implementación inicial de la exploración. **La meta sigue siendo la mayoría de rutas troncales y la mayoría de la flota del escenario.** Esta entrega comprueba geografía y operación sintética; todavía no representa servicios comerciales vigentes.

## Abrir y usar

Abrir `ABRIR_SIMULACION_2D.command` desde Finder. Inicia un servidor exclusivamente en `127.0.0.1:8766` y abre el navegador. Mantener su ventana de Terminal abierta; **Ctrl+C** cierra el servidor. Si la misma prueba está abierta, reutiliza el servidor. No necesita descargar bibliotecas ni conectarse a servicios externos durante el uso. Requiere Python 3 disponible en el equipo y un navegador con WebGL 2. No abrir `index.html` mediante `file://`.

- **Américas · ensayo de paradas:** Mandalay–Av. Boyacá–Marsella, dos sentidos, 8/24/64 buses.
- **Red · prueba de carga:** 100/1.000/3.000 articulados sintéticos repartidos en componentes independientes del eje fuente.
- Pausa, **1× / 8× / 32×**, selección de recorrido, bus o estación y seguimiento de un bus.
- Arrastrar desplaza; rueda o botones **+ / −** cambian zoom. El mapa enfocado también acepta flechas y **+ / −**. «Ver Américas» y «Ver red» recuperan encuadres.
- Cambiar escenario o cantidad de buses **reinicia** el ensayo. Filtrar o alejarse no elimina buses de la simulación. El seguimiento de un bus mantiene visible su sentido al regresar.
- Reloj de tiempo transcurrido, desde cero. Ocultar la pestaña congela el avance de pared; al volver continúa. Recargar inicia otro ensayo; no hay guardados todavía.

Colores de buses: color del corredor en recorrido, ámbar en parada, marrón en cola. Son convenciones de esta vista, no pinturas verificadas de la flota. Los símbolos tienen tamaños mínimos en pantalla y separación lateral visual por sentido; su geometría gráfica no se usa para medir distancias ni colisiones.

## Qué datos conserva

`tools/build_network_2d.py` utiliza exclusivamente la instantánea fijada `20260909T035301Z`. Mantiene **22 registros de trazado, 48 partes geométricas y 153 puntos de estación** como referencia. No equivalen a conteos operativos del día. La descarga ocurrió el 9 de septiembre UTC / 8 de septiembre en Bogotá.

Coordenadas **X este / Y norte, en metros AEQD**, origen lon −74.136, lat 4.63027. No pasa por la compresión 3D. El eje piloto conserva **1.602,465665 m**; los vértices exportados se redondean al milímetro, sin atribuir esa precisión al levantamiento original. Guarda hashes, IDs, propiedades originales, proyección y atribución.

La carga incluye **17 componentes de 14 registros de trazado**, con **34 sentidos de ensayo** y 140 IDs de estación asociados. Su eje único suma aproximadamente 101,52 km; al simular ambos sentidos se duplica la longitud direccional. Son selecciones geométricas de ensayo, **no 34 rutas oficiales ni una medida de cobertura de servicios**. El piloto aporta otros dos patrones independientes, utilizados solo en su propio escenario.

La selección conserva el `id_trazado` de cada estación y exige distancia al componente ≤35 m, dos paradas como mínimo, separación entre paradas ≥40 m y componente ≥400 m. Los puntos fuera del umbral siguen visibles como referencia; no se trasladan desde otro corredor por cercanía. El punto de parada de ensayo es la proyección sobre el eje, no una puerta ni un vagón real.

La auditoría conserva las 48 partes, incluidas las descartadas para carga. No une componentes separados ni crea conexiones al cruzarse líneas. Los trazados de extensión y Ciudad de Cali permanecen en el contexto cartográfico, sin buses asignados por el ensayo actual. `esta_oper=1` no se usa como prueba de apertura o vigencia. `tipo_tra=2` tampoco se interpreta por sí solo como «proyectado»: su dominio requiere contraste.

## Simulación implementada

`simulation.mjs` es un núcleo JavaScript independiente de Three.js y del navegador. La primera versión usa módulos ESM y archivos estáticos, sin compilador ni servidor de aplicación. Se prefirió esta base pequeña a introducir un framework para una sola vista; TypeScript puede incorporarse cuando crezcan los contratos.

- Distancia acumulada sobre cada polilínea y posición por longitud de arco.
- Articulado de **18 m y 2,55 m**, procedente de la ficha compartida del prototipo, con hash. No se ha creado otra carrocería ni un biarticulado.
- Movimiento con aceleración/frenado simplificados, velocidad de ensayo hasta **50 km/h**, separación mínima de **5 m** entre carrocerías en un mismo sentido y componente.
- Paradas ordenadas, detención y atención de **18 s**. El estado de puertas abiertas es lógico y se muestra en el inspector.
- Regulación de **35 s** en extremos geométricos y cambio abstracto al sentido inverso en la misma coordenada. Los extremos no se presentan como terminales reales; no se anima ni valida una maniobra de giro.
- Flota inicial distribuida de forma determinista en viajes ya iniciados. No hay despachos horarios desde patios ni frecuencias oficiales. Las paradas anteriores al punto inicial no se cuentan como atendidas.
- Pasos fijos de **0,1 s**. Si se agota el trabajo permitido por cuadro, conserva tiempo pendiente y lo muestra; no salta estados para alcanzar el reloj. La simulación completa sigue existiendo al filtrar o mover la cámara.
- Renderizado mediante cámara ortográfica e instancias de símbolos; núcleo y dibujo separados. Al alejarse los iconos se superponen visualmente antes de que las carrocerías lógicas se solapen.

La separación solo está resuelta **dentro de cada componente dirigido**. No hay carriles compartidos entre servicios, adelantamientos, semáforos, reservas de intersección, conflictos entre componentes, geometría de giro, cruces a distintos niveles, demanda de pasajeros ni ocupación. A 3.000 buses se forman colas largas porque hay un único espacio lógico de atención por parada: ese resultado no representa la capacidad real de TransMilenio.

## Comprobación y resultados

**7 pruebas Node aprobadas**, con casos de distancia sobre curvas, independencia del ritmo de dibujo, pausa, acumulación de tiempo, atención y orden de paradas, regreso sin salto espacial, separación por componente y conservación de 3.000 IDs de bus. Incluyen un contrato simulado de la integración opcional WebMCP. **17 pruebas Python aprobadas** en el proyecto: las 3 nuevas verifican cartografía, selección, escala, procedencia y reproducción del archivo generado; las 14 anteriores siguen pasando.

La prueba de carga ejecutó 300 s simulados para 100, 1.000 y 3.000 buses, en Node v26.4.0 / arm64 en este Mac. Para 3.000 buses, el núcleo consumió aproximadamente **0,084 ms por paso** en esa ejecución; el percentil 95 de medias de lotes fue aproximadamente 0,104 ms. Resultado completo y parámetros: `data/processed/network2d_benchmark.json`. No equivale a medir FPS, GPU, consumo total ni rendimiento de una red operacional completa.

Se comprobaron sintaxis, imports locales, hashes de Three.js, HTTP 200 y tipos MIME de JavaScript. La primera vista se solicitó en el panel local de Codex. **No se ha hecho inspección visual ni medición gráfica automatizada en navegador en este hito.** La guía Sites aplicada reserva esa inspección a una solicitud explícita de pruebas de navegador. No presentar la interfaz como revisada visualmente ni prometer 60 FPS.

WebMCP es opcional y se detecta por capacidad del navegador: leer estado y controlar pausa/velocidad. Usa las mismas acciones visibles; no requiere una IA ni red para jugar. Su contrato se probó en un contexto simulado, **no en un navegador con WebMCP disponible**. No hay aprobación gráfica ni de esa integración nativa.

## Archivos y reproducción

- `web/transmi2d/dist/`: fuente estática de la aplicación, **se edita aquí directamente**; no es salida desechable de un compilador.
- `network.json`: único archivo generado de geografía, se reconstruye desde Python.
- `vendor/`: Three.js **0.186.0**, MIT, archivos oficiales locales. `tools/vendor_three.py` verifica SHA-512 del paquete npm fijado y escribe manifiesto SHA-256 de los tres archivos utilizados.
- `tools/serve_network_2d.py`: servidor local; sirve solo `dist`, no el repositorio.
- `.openai/hosting.json`: descripción de archivos estáticos, sin registro, credenciales ni despliegue. **No publicar.**

Desde la raíz:

```sh
../../work/venv/bin/python tools/build_network_2d.py
../../work/venv/bin/python -m unittest discover -s tests -v
node --test web/transmi2d/tests/simulation.test.mjs
node web/transmi2d/tests/benchmark.mjs
python3 tools/serve_network_2d.py --open
```

## Siguiente hito

1. Normalizar un primer servicio real de Américas por sentido: ID de proveedor, secuencia y variantes de paradas, trazado, calendario/vigencia y fuentes. Usar candidatos ya guardados; no renombrar un ensayo con un código comercial por semejanza.
2. Incorporar aristas y nodos explícitos compartidos, condiciones de giro y asignación de paradas. Resolver primero una conexión revisada, no todos los cruces por proximidad.
3. Despachos, regulación y colas de varios servicios compartiendo carriles, con pruebas de conservación de vehículos y paradas.
4. Inventario fechado de servicios y flota: numeradores y denominadores para medir la meta de mayoría. Incorporar tipos de bus y parámetros verificados progresivamente.
5. Medir rendimiento y legibilidad gráficos con escenarios reproducibles en el navegador. Añadir trabajador separado o agrupación visual si las mediciones lo justifican.

La exploración no altera la escena de conducción de Godot ni habilita Boyacá o las obras de la 68. Sus contratos y reglas comprobadas pueden alimentar posteriormente la IA del simulador 3D, con integración expresa y distancias jugables propias.
