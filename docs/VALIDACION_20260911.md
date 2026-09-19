# Validación de la revisión · 11 septiembre 2026

Revisión a partir de 15 capturas y observaciones de la primera prueba. El estado anterior se respaldó primero en GitHub como `c0ed10116fbf708b13b96f7dcceada9a4e4ddd44`. El informe del 10 septiembre se mantiene como histórico. Esta versión conserva 23 registros pendientes y aplica las correcciones de interacción, flota y mapa.

## Pruebas automatizadas

- `node --test app/tests/*.test.mjs`: **35 aprobadas**. Calendario colombiano, medianoche, geometría métrica, curvas, aceleración/frenado, repetibilidad de reloj, conservación/capacidad, reservas y paso expreso, reutilización, flota fija y variación acotada, refuerzos reproducibles, C15/H15, F63/Z63 y F23 único.
- La prueba de emplazamientos OSM revisa todas las rutas utilizables: orden de paradas, límites de ±400 m, permanencia sobre la ruta y procedencia; verifica plataformas paralelas y varios puestos separados en Ricaurte.
- `../../work/venv/bin/python -m unittest discover -s tests`: **3 aprobadas**. El primer intento con Python del sistema no podía importar shapely; se repitió con el entorno geográfico documentado.
- Sintaxis de módulos editados y compilación de scripts Python correctas; `git diff --check` limpio. Curado OSM y copia de app coinciden; raw reproducible y URLs individuales conservadas.

## Pruebas de navegador

Navegador integrado a tamaño predeterminado 1280×720, aplicación real servida por Python. Acciones efectuadas con controles de página y lectura de estado WebMCP cuando el contexto seguro lo permite.

| Caso | Resultado observado |
|---|---|
| Sur, Suba y Américas | Tres, dos y tres plataformas físicas, respectivamente; vías interiores visibles, sin una fila artificial de todos los vagones |
| Banderas | Cubierta central, plataformas laterales y contexto del retorno en posiciones OSM |
| Ricaurte / Avenida Jiménez | Cubiertas y accesos separados sobre sus dos corredores; encuadre conjunto; no se inventa huella de plataforma publicada |
| Colores de fondo | Séptima exterior y 68 grises discontinuas tras cerrar M85; troncales con colores propios, sin rutas duales superpuestas permanentemente |
| F23 y C15/H15 | Un solo F23 a Portal Américas; C15/H15 enlazadas en búsqueda sin C15 zonal |
| Explorar Ruta | Antes/después de seleccionar F23: mismos 889 buses y misma hora pausada; alcance de 114 rutas intacto |
| Simular solo F23 | Pasa a una ruta con sus propios buses mediante acción explícita |
| Regresar a red | Vuelve a 114 rutas, limpia selección y conserva reloj en marcha a 8× |
| Troncal G | 28 servicios seleccionados; regreso a toda la red conserva reproducción |
| Bus de otra ruta | Con F23 seleccionado/seguido se pulsó un B28 sobre el mapa: inspector y ruta pasaron a B28; seguimiento mostró avance de 1,47 a 2,54 km y cambio de próxima parada |
| Fin de viaje | Adelantar 15 min desde un F23 próximo al final vuelve automáticamente a su detalle de ruta, con botones y paradas |
| Slider | Home + derecha queda exactamente en 00:00:01; arrastre pausado fija 14:37:09; arrastre durante 120× acepta 07:51:09 sin regresar a la hora anterior |
| Ahora | Cambia fecha a 2026-09-11 y hora de Bogotá del momento de pulsación, respetando pausa |
| Zoom | Un desplazamiento de rueda cambia escala de 2 km a 1 km; etiquetas/agrupaciones se recolocan en pausa |
| Temas | Modo claro y oscuro revisados sobre mapa, paneles, rutas, reloj y plataformas; contraste y controles conservados |
| Fuentes | Ocho entradas visibles, documentación de supuestos y planos; sin filtro Duales ni referencias específicas de servicios en Operación |
| Guardado | Tras guardar y recargar: misma fecha 2026-09-11, hora 07:25:36, velocidad 8×, toda la red y pausa restauradas |
| LAN | Página cargada por IP local y puerto 8767, motor activo con 886 buses; defaults 60/50 y demanda1; controles de operación aplicados desactivando variación y refuerzos, reconstrucción sin errores (880 buses) |

Consola de aplicación sin errores en las inspecciones. Algunos intentos del controlador de QA agotaron su espera corta durante una reconstrucción de ~4 s; la aplicación terminó normalmente. No se confunden con fallos de aplicación.

La sensibilidad del pinch se aumentó y el seguimiento interpola la distancia sobre la ruta y la cámara cada frame. No se midió un gesto físico de trackpad ni FPS/memoria de GPU. Tampoco se certificaron móviles físicos o todas las geometrías individuales. La prueba de URL LAN se hizo desde el mismo equipo por su interfaz LAN, no desde otro dispositivo.

## Carga del motor

Escenario 10 sep. 2026, dos días construidos para incluir medianoche. Muestreo cada minuto entre 04:00 y 24:00. Reportes en data/processed/operation_benchmark*.json.

| Medida | Referencia 4/8 min, demanda1 | Estrés 2/3 min, demanda3 |
|---|---:|---:|
| Preparación | 4,48 s | 9,03 s |
| Muestreo medio | 0,43 ms | 2,15 ms |
| Máximo de buses muestreado | 896 | 2.403 |
| Máximo exacto por eventos, incluyendo día anterior | 904 | 2.407 |
| Máxima espera simultánea de buses, suma de toda la red | 68 | 820 |
| Heap Node observado | 370 MB | 824 MB |

Sin posiciones/velocidades no finitas ni cargas negativas o superiores a capacidad. El ajuste extremo produce congestión y viajes más largos; el modelo no borra buses para esconderla. Las cifras miden CPU Node, no FPS ni una garantía para cualquier teléfono. El ensayo sintético de 3.000 buses pertenece al laboratorio anterior y no se usa como prueba de la operación real.

## Servidor y límites conservados

El lanzador local sigue en 127.0.0.1:8766. El nuevo lanzador LAN utiliza 0.0.0.0:8767 y muestra la IP de la interfaz. Peticiones `/`, `/services.json` y `/station_layouts.json`: 200. Peticiones `/../README.md`, `/data/`, `/.git/config` y listado `/vendor/`: 404. Sirve únicamente app/dist; cada navegador mantiene su estado, sin sincronización multijugador ni despliegue público.

Quedan explícitamente pendientes los 23 registros, semáforos opcionales, fuentes reales de flota/asignación a vagones, planos de otras estaciones, patios y calibración OD. La geometría OSM de cubiertas/áreas se distingue de plataformas verificadas. Las capturas aportadas se usaron como referencia y no se copiaron al repositorio.
