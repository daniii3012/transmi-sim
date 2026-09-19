# Observaciones de la primera revisión · 11 septiembre de 2026

**Revisión implementada y comprobada.** El checkpoint inicial se respaldó como c0ed101 antes de estos cambios. Ver VALIDACION_20260911.md para pruebas y límites. Semáforos opcionales, los 23 registros y datos operativos sin evidencia quedan pendientes por acuerdo; las demás observaciones se incorporaron. Esta lista recoge la solicitud activa completa. No sustituye las decisiones anteriores salvo donde se indica expresamente. El usuario pidió guardar primero y compactar contexto; no hay herramienta de compactación manual disponible, por lo que este registro y CONTINUAR.md preservan el trabajo para la compactación automática.

## Mapa y estaciones

- Mostrar permanentemente solo líneas de troncales con sus colores. Quitar rutas duales coloreadas superpuestas; sus segmentos fuera de troncal (68, Séptima, Cali y demás) pueden verse gris punteado. Al seleccionar una ruta, mostrar exactamente su recorrido como ya hacen B16/E32, incluidos desvíos, sin mostrarlo siempre.
- Corregir vagones alineados artificialmente en portales y estaciones grandes: Portal Sur, Portal Suba, Portal Américas, Banderas, Ricaurte y Av. Jiménez. Revisar estaciones rectas también. OSM y capturas muestran plataformas separadas/paralelas y curvas, no una única fila.
- Ricaurte y Av. Jiménez tienen plataformas sobre dos troncales: distinguir ubicaciones/orientaciones dentro de una estación lógica. Conservar los trazados de buses que ya siguen giros/carriles; corregir ubicación de atención y representación, sin dibujar atajos.
- Investigar detalle OSM de plataformas, vías interiores y patios en portales si el coste es razonable. Fuente aportada: https://sitp-bogota.com/portal-del-sur-transmilenio/ (tercera parte, verificar con OSM/fuentes oficiales).
- Mantener23pendientes, incluidoK86, sin iniciar otra búsqueda exhaustiva de rutas faltantes.

## Flota y operación

- Capacidad fija: padrón80, articulado160, biarticulado240. Eliminar opción250.
- Tamaño fijo por ruta, sin mezcla entre buses de la misma ruta ni cambios de tipo. Rutas fáciles1–8 articuladas; M51/F51 biarticuladas según conocimiento del usuario. Verificar cuando sea posible; demás asignaciones probables y documentadas. F63/Z63 continúa articulado dual160.
- Velocidades iniciales:50km/h calle y60troncal, con variación determinista ±5km/h entre buses; conservar metros, curvas y aceleración. Actualizar rangos de controles y pruebas.
- Incrementar referencia de demanda a2–2,25veces la actual, de modo que el nuevo1× refleje esa base. Colas de pasajeros más realistas, sin forzar un número fijo de buses que deben esperar.
- Introducir variación moderada de despachos/viaje y excepciones de2–3buses/refuerzos a2min por demanda alta. No convertirlo en norma ni provocar flota descontrolada. Grupos pequeños de buses pueden ocurrir.
- Semáforos solo si son razonables de incorporar: sugerencia opcional, especialmente Américas/Calle13; si añade complejidad relevante, dejar documentado pendiente.
- F23 solo llega a Portal Américas: excluir la variante Banderas y conservar un único servicio. Registrar corrección del usuario explícitamente; no confundir con pendientes geométricos.

## Interacción

- Cuando finaliza el bus seguido, volver al detalle de su ruta; no dejar panel «Viaje finalizado» vacío.
- Seleccionar/seguir un bus cambia el resaltado a la ruta de ese bus, aun si antes había otra seleccionada. Atenuar troncales y también el trazado resaltado para que el bus se vea por encima.
- Suavizar seguimiento de cámara sin minisaltos; interpolación visual coherente con reloj, sin alterar simulación.
- Aumentar sensibilidad del zoom de trackpad/pinch y probar rueda si procede.
- Corregir slider de tiempo que salta entre posición actual y arrastre, o restaura hora anterior al soltar. Bloquear actualizaciones concurrentes mientras se arrastra y aplicar el valor final exactamente.
- Separar pestaña de exploración Ruta de alcance simulado. Entrar a Ruta y elegir una fila debe mantener simulación actual; solo «Simular solo este servicio» cambia operación.
- Cambiar entre Toda la red/Troncal/Ruta debe limpiar selección visual previa de ruta cuando corresponda, sin pausar o reiniciar reloj. Volver a Toda la red restaura/conserva simulación en marcha. Aplicar selección de troncales sigue siendo acción explícita.
- Botón de fecha/hora actual de Bogotá.
- Modo oscuro coherente con controles y mapa, preferencia guardada.

## Información y ejecución

- Quitar selector «Duales»; todas estas rutas pertenecen al sistema. Evitar explicaciones particulares F63/Z63 en Operación; allí solo datos generales de tipos/capacidades.
- Explicar «validaciones de referencia»: entradas registradas por recaudo en el archivo diario, no pasajeros presentes ahora. Mover valor y fuente del archivo al final del detalle de estación.
- Mantener incertidumbres en documentación y enlazarla desde la página; crear sección de fuentes consultadas dentro de la página.
- Nuevo `.command` para servir por red local a otros dispositivos del mismo Wi-Fi/LAN. Autorización explícita del usuario para esta exposición; limitar a assets públicos de app/dist, no al repositorio ni a archivos privados. Conservar lanzador loopback original.
- Mantener estimados cuando no exista información suficiente; no detener implementación por preguntas ya resueltas.

## Capturas aportadas (ya vistas en el mensaje)

Quince capturas de pantalla, fuera del repositorio:
`Portal sur proyecto.png`, `Portal sur openstreetmaps.png`, `Banderas proyecto.png`, `Banderas osm.png`, `Ricaurte proyecto.png`, `Ricaurte osp.png`, `Av jimenez proyecto.png`, `Av jimenez osm.png`, `Rutas de buses duales sobre el trazado sin seleccionarlas.png`, `E32.png`, `B16.png`, `Portal Suba proyecto.png`, `Portal Suba osm.png`, `Portal americas osm.png`, `Portal americas proyecto.png`.

No copiar capturas privadas al repositorio salvo necesidad/autorización; sirven como referencias. La implementación se hará con datos vectoriales/geométricos, no editando estas imágenes.
