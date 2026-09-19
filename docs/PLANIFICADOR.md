# Planificador de viajes

La pestaña **Planear viaje** consulta toda la red utilizable, independientemente de los servicios que se estén simulando. Se eligen origen, destino, fecha y hora de salida en Bogotá. La consulta no modifica el reloj, el alcance, la reproducción ni los pasajeros de la simulación.

Se muestran opciones directas o con uno o dos transbordos, con el servicio y sentido que se deben tomar, estación de subida/bajada, espera y caminata aproximadas. El mapa destaca solo las partes recorridas de cada servicio, conservando su polilínea geográfica. Los transbordos se permiten entre servicios que comparten una estación lógica; no se inventan conexiones por cruces de líneas ni enlaces peatonales entre estaciones distintas.

## Datos y tiempos

- Paradas, orden, sentido, ventanas horarias, días de operación y vigencia proceden del catálogo local.
- Los registros pendientes están excluidos; planificar no los valida ni los activa.
- La vigencia publicada de cada servicio se respeta literalmente. En la instantánea del 10 sep. 2026, 12 de los 117 servicios utilizables terminan su vigencia el 11 sep. 2026, entre ellos casi todo el corredor de Portal Usme (B72, B75, C17, D20, H17, H20, H54, H72, H75, H83 y M83). Para fechas posteriores esas estaciones quedan sin alternativas —solo K54 sigue vigente allí— y la búsqueda responde que no encontró viaje. Es una limitación del catálogo descargado, no una falta de conexión física; se resuelve con una instantánea más reciente de servicios.
- La búsqueda cubre seis horas desde la salida y admite hasta tres buses. Incluye despachos del día anterior para viajes que continúan después de medianoche y del siguiente día cuando corresponde.
- Las frecuencias usan los parámetros pico/valle del escenario. La tabla nominal no predice los despachos irregulares o refuerzos particulares de la simulación.
- Los tiempos estiman aceleración, frenado, curvas y distancia real; agregan 15 s en paradero de calle y 30 s en estación. No predicen aforo, colas ni la fase de cada semáforo.
- La caminata de transbordo tiene un mínimo de 90 s; para plataformas separadas se estima a 1,2 m/s con un factor de recorrido de 1,25 y 60 s de acceso. No es un levantamiento de corredores, escaleras o accesibilidad.
- Se muestra la mejor llegada encontrada para cada cantidad de transbordos y se descartan opciones más lentas que otra con menos transbordos. El tiempo nominal no constituye una promesa de viaje real.

## Implementación y comprobación

`app/dist/planner.mjs` prepara perfiles métricos nominales y un índice de servicios por estación. La búsqueda conserva el servicio y punto de llegada al comparar estados: en intercambiadores como Ricaurte las caminatas entre plataformas importan. `worker.mjs` ejecuta la búsqueda fuera del hilo de dibujo; solicitudes y reconstrucciones llevan identificadores para descartar respuestas antiguas.

Pruebas en `app/tests/planner.test.mjs`: sentido de viaje y orden de paradas, transbordos y caminatas, exclusión de pendientes, servicios expresos, calendarios/vigencia, medianoche, entradas inválidas, repetición y conservación de curvas. Las pruebas de interfaz y ejemplos reales se registran en el informe del hito.
