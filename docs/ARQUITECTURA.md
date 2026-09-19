# Arquitectura de Transmi 2D

Actualizada: 11 de septiembre de 2026. La aplicación es estática y local. Los archivos de `app/dist` son sus fuentes editables; no existe un paso obligatorio de npm/bundler. Three.js 0.186.0 está vendorizado con licencia.

## Separación de responsabilidades

| Archivo | Responsabilidad |
|---|---|
| `app.mjs` | Controles, selección, reloj, guardado y ciclo de vida del trabajador |
| `worker.mjs` | Construcción y muestreo de escenarios fuera del hilo de interfaz |
| `calendar.mjs` | Fechas civiles de Bogotá, festivos, vigencia y ventanas publicadas |
| `operation.mjs` | Despachos, viajes, atención, pasajeros, vehículos y terminales |
| `travel.mjs` | Perfil distancia/velocidad con curvas, aceleración y frenado |
| `passengers.mjs` | Entradas históricas o sintéticas y orientación estimada |
| `vehicles.mjs` | Capacidad y tipo fijos por ruta y vehículo |
| `station-layouts.mjs` | Proyección local de puestos OSM sobre recorridos, conservando orden y geometría |
| `map.mjs` | Mapa ortográfico, contexto, vagones, buses, selección y agrupación |
| `webmcp.mjs` | Lectura opcional del estado y control del reloj; funciona sin esa API |
| `simulation.mjs` | MetricPath compartido y laboratorio sintético anterior, conservado para regresión |

## Geometría y movimiento

Proyección AEQD WGS84 con origen `(-74.136, 4.63027)`, X este, Y norte, unidades en metros. Cada servicio conserva la polilínea oficial recortada entre primera y última parada. La referencia lineal desambigua recorridos que incluyen ambos sentidos; una parada publicada cercana permite corregir su distancia sobre el trazado. La auditoría distingue coordenadas oficiales, ubicación aproximada y geometría insuficiente.

Los perfiles se calculan en el dominio de distancia, con muestreo de 18 m, curvatura local, aceleración y frenado acotados. Se cachean por ruta, tramo, período y variación de crucero. El reloj consulta posición y velocidad analíticamente; 120× no significa buses 120 veces más rápidos en km/h. Un cruce 2D no conecta rutas ni genera colisiones: no hay un grafo vial inferido del dibujo.

En las seis estaciones detalladas se dibujan huellas OSM reales y se estiman puestos compatibles sobre cada ruta con reservas independientes por puesto físico. Las cubiertas de Ricaurte/Jiménez no se reinterpretan como andenes publicados. En el respaldo esquemático, los puntos de vagón se desplazan a lo largo del trazado únicamente en visitas intermedias, con límite según distancia entre paradas. Separación de 64 m y andén de 58 m son medidas de representación estimadas; no se modifican las coordenadas originales guardadas. Los tamaños mínimos de iconos al alejarse y el desplazamiento lateral de carriles son convenciones visuales.

## Eventos y capacidad

Una cola de prioridad prepara salidas, atención y liberación de vehículos en orden temporal. Se construye el día elegido más el anterior para incluir viajes que cruzan medianoche. Después se descartan viajes anteriores que no pueden verse y se conservan índices ordenados para el muestreo. Retroceder consulta los mismos eventos; no integra con tiempo negativo.

La clave estación/sentido/puesto físico (o vagón de respaldo) reserva dos posiciones de atención, o una en calle. La asignación servicio→vagón es determinista y estimada. No bloquea expresos que pasan. Buses que completan un servicio quedan disponibles tras 240 s de regulación en la terminal de destino y pueden reutilizarse en salidas compatibles. No se dibujan accesos de patio inventados, no hay inventario oficial de flota ni desplazamientos en vacío modelados.

La velocidad entre dos paradas sale del campo medido por trecho de corredor (`app/dist/speed_profiles.json`): el techo cambia con la posición, y un trecho congestionado se representa como bus lento y no como bus detenido. Un bus solo se queda quieto por cola de entrada al andén o por un rojo, y esas esperas se resuelven junto con las fases de los semáforos. Un único factor por tramo ajusta esa forma al tiempo publicado, que sigue fijando la llegada. Sin cobertura —calle, dual— se conserva el crucero continuo anterior. Método y límites en [la velocidad la pone el lugar](VELOCIDAD_POR_LUGAR_20260912.md).

El tipo de cada vehículo permanece fijo; los depósitos separan tipos. F63/Z63 tienen perfil publicado propio. Las demás rutas llevan el tipo que se lee de la flota que las atiende en las lecturas de posición —`data/curated/fleet_types.json`, adjunto como `vehicle_profile`— y las que no tienen lecturas usan el articulado de referencia, declarado estimación; no se mezcla tipo dentro de una ruta. Los cruceros varían hasta ±5 km/h por vehículo, sin variar capacidad.

## Pasajeros

Se agregan cantidades por estación y sentido, no millones de objetos individuales. Los perfiles históricos aportan entradas por hora. El reparto hacia/desde un centro de empleo aproximado, descensos, fines de semana y demanda sin observaciones son hipótesis. Al simular una parte de la red se asigna una fracción de la demanda por proporción de servicios seleccionados; esto no sustituye asignación OD por destinos.

La capacidad se conserva en cada visita: carga anterior − descensos + abordajes. El exceso queda esperando. Se aplica abandono agregado con tiempo medio estimado de 30 minutos. `boardingDenials` cuenta oportunidades de abordaje no satisfechas, pudiendo contar de nuevo a una persona que espera; no es número de personas únicas. El último punto del viaje solo admite descensos.

## Renderizado y memoria

Buses, estaciones y vagones usan geometrías instanciadas. Se descartan símbolos fuera de cámara y se agrupan los cercanos cuando el mapa está alejado, sin suprimir vehículos del motor. Un movimiento de cámara vuelve a muestrear el dibujo incluso en pausa. Los colores identifican las rutas; la ocupación y el estado se muestran en el inspector.

La interfaz solicita estados hasta 20 veces/s y dibuja a ritmo de `requestAnimationFrame`. Un cambio de parámetros o fecha cancela el trabajador anterior; sus respuestas se distinguen por generación. El mapa interpola la distancia sobre la polilínea durante 60 ms entre respuestas, y la cámara sigue esa posición cada frame mediante suavizado exponencial. Se descartan respuestas obsoletas por número de muestreo además de generación. El arrastre del reloj suspende actualizaciones concurrentes. Las pestañas de exploración son independientes de la selección operativa. Al ocultar la pestaña se congela el reloj visible. El guardado conserva configuración y hora, no enormes estados de buses. La reconstrucción al cambiar de día conserva identificadores de viaje, pero los números de inventario de bus no son matrículas reales ni una flota persistente entre días.

Los límites de los controles acotan densidad; aún así, los ajustes más exigentes consumen más memoria y tardan varios segundos en preparar el día. Las cifras del benchmark son del motor Node, no FPS ni garantía para cualquier dispositivo. Ver el informe de validación.
