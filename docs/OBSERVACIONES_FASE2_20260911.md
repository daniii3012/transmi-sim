# Segunda revisión · 11 septiembre de 2026

El hito f6fa207e3830ef75979640caf8ab9af4c64feac8 quedó subido y se verificó coincidencia exacta de HEAD local y remoto antes de continuar.

Solicitud atendida en esta revisión:
- Completar geometría de plataformas/cubiertas para TODOS los portales, conservando los anteriores.
- Simular semáforos solo con evidencia de que controlan la calzada de TransMilenio. La proximidad de un semáforo general no basta; los ciclos pueden quedar estimados.
- Añadir pestaña de planificación de viaje con estación origen/destino, fecha y rutas a tomar, incluidos transbordos. Se incorpora hora de salida para respetar ventanas de operación. Planificación independiente del alcance/reloj de la simulación.
- Suavizar nombres de estaciones durante seguimiento: conservar nodos DOM y reposicionarlos cada frame de cámara; recálculo de colisiones separado.
- Mantener los 23 registros de rutas pendientes: siguen en validación.

Planos y semáforos investigados, integrados y revisados. Resultado y pruebas en [VALIDACION_FASE2_20260911.md](VALIDACION_FASE2_20260911.md). No despliegue público; LAN ya autorizado.
