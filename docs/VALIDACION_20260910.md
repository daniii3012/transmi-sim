# Validación del checkpoint 10–11 septiembre de 2026

Este informe corresponde a la versión inicial integrada, antes de aplicar las observaciones detalladas recibidas el 11 de septiembre. Las limitaciones encontradas están registradas en OBSERVACIONES_20260911.md y tienen prioridad para la siguiente revisión.

## Pruebas automatizadas

- 30 pruebas Node aprobadas en `app/tests/*.test.mjs`.
- 3 pruebas Python activas aprobadas en `tests` con el entorno geográfico.
- Regeneración del catálogo: 138 registros, 115 utilizables, 23 pendientes, 1 zonal excluida.
- Regeneración del agregado desde ZIP oficial: 1.920.298 filas, 151 códigos de recaudo, 14 registros posteriores a medianoche. Importación: 142 estaciones lógicas, 1.920.297 validaciones, sin códigos pendientes tras excluir cable.
- Ningún archivo de transacciones se incorpora a la aplicación ni al repositorio.

Los tests cubren calendario, festivos, vigencia, medianoche, geometría métrica, curva/velocidad/aceleración/frenado, reloj reversible, capacidad y conservación, reservas de atención, paso expreso, reutilización de vehículos y tipos estables, F63/Z63 y exclusión de la C15 zonal. No certifican todas las geometrías o plataformas físicas del sistema.

## Carga del motor

Se muestrea de 04:00 a 24:00 cada minuto (1.200 muestras), comprobando posición y velocidad finitas y ocupación entre cero y capacidad.

| Escenario | Máximo de buses visibles en el día | Máximo esperando atención | Construcción | Muestreo medio | Heap Node observado |
|---|---:|---:|---:|---:|---:|
| Referencia 4/8 min, demanda1, articulados | 944 | 4 | 4,02 s | 0,41 ms | 389 MB |
| Estrés 2/3 min, demanda3, mezcla40% | 1.938 | 42 | 9,22 s | 1,33 ms | 808 MB |

Resultados completos en `data/processed/operation_benchmark*.json`. Son mediciones del núcleo Node de esta máquina, no FPS del navegador ni límite máximo garantizado. El ensayo sintético anterior de 3.000 buses es otra prueba, no esta operación.

## QA de navegador autorizada

Navegador integrado, localhost:8766, escritorio, vista principal de 1280×720 y una revisión previa en panel estrecho. Acciones comprobadas:

- Carga de la red y búsqueda C15: aparecen C15/H15, sin Chapinero Ciclovía zonal; cada sentido muestra 19 paradas. Navegación al sentido opuesto y simulación de H15.
- Bus H15 con capacidad160; F63 con tipo dual articulado eléctrico, capacidad160, recorrido y próxima parada.
- Selección de estación Portal Tunal: número publicado de vagones, pasajeros estimados y próximas llegadas; se comprueba que algunos portales tienen más de tres vagones.
- Frecuencias cambiadas a6/10min; reconstrucción y posterior restauración a4/8min.
- Pausa, hora manual18:00, retroceso/avance15min, velocidad120× y regreso a1×.
- Salto de23:55 a00:10: fecha pasa del10 al11sep. Retroceso y cambio al domingo13sep; C15/H15 conservan disponibilidad y se muestra valle.
- Selección conjunta de troncales C y H: reconstrucción finalizada, título correcto y flota33 en el escenario dominical probado.
- Consulta de terminales y próximas salidas; selección/seguimiento de bus, cierre del inspector, encuadre y zoom pausado.
- Guardado y recarga: misma fecha10sep, hora07:00, parámetros4/8, red completa, velocidad1× y reloj pausado. Estado908buses/34.065pasajeros en referencia.
- Sin errores de consola ni mensajes de error de aplicación en la comprobación final.

No se ha realizado una auditoría visual exhaustiva de115variantes ni QA completa en móviles. Después se detectaron errores de interacción del slider, seguimiento entrecortado y plataformas grandes inadecuadas: estas observaciones delimitan las pruebas anteriores y se corrigen en el siguiente hito. No describir este checkpoint como proyecto terminado.
