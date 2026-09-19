# Exploración: simulación de TransMilenio en 2D

Exploración abierta el 9 de septiembre de 2026. **Primer laboratorio local implementado el 10 de septiembre de 2026.** Mapa fuente, ensayos con paradas y prueba lógica de carga hasta 3.000 buses sintéticos. Ver [resultado, uso y límites](SIMULACION_2D_LOCAL.md). No reemplaza el simulador de conducción 3D. El resto de este documento conserva el alcance y los criterios de expansión.

## Alcance confirmado

La meta es **simular la mayoría de las rutas troncales y la mayoría de los buses del sistema**, circulando simultáneamente. El piloto acotado es una validación técnica, no el alcance final. Incluir tanto una flota numerosa como sus tipos principales (articulados, biarticulados y duales cuando sus servicios correspondan); no exigir modelado 3D detallado para cada vehículo de esta vista.

Antes de afirmar qué fracción se cubre, construir un inventario fechado de servicios, variantes por sentido y flota pertinente. Medir cobertura como servicios verificados sobre servicios elegibles y buses simulados sobre flota del escenario; no usar los 256 registros candidatos como denominador ni prometer un número de buses sin fuente. Se mantiene el foco troncal BRT; los servicios zonales no se incorporan por defecto.

La arquitectura deberá mantener una simulación lógica de toda la flota seleccionada aunque parte quede fuera de la vista. Separar despachos, vehículos, paradas y colas del renderizado; agrupar o simplificar iconos al alejarse y, si hace falta, procesar la simulación en un trabajador del navegador. Los tipos de bus pueden diferir en longitud, capacidad, puertas, compatibilidad y tiempos de atención; no requieren una física mecánica detallada en esta exploración.

## Viabilidad y experiencia propuesta

Es viable hacerla con Three.js: mapa cenital de Bogotá, troncales, estaciones y buses que se desplazan por servicios seleccionables. La referencia Mini Metro aporta claridad visual y facilidad para observar una red. La propuesta conserva el trazado real de TransMilenio; inicialmente sería una simulación de su operación, sin presuponer que se pueda rediseñar la red libremente. [Referencia del creador de Mini Metro](https://dinopoloclub.com/games/mini-metro/).

Three.js dispone de una cámara ortográfica adecuada para una escena 2D sin perspectiva. Los buses podrían dibujarse con formas simples compartidas mediante InstancedMesh, que permite reducir llamadas de dibujo para muchos objetos iguales con posiciones distintas. Esto respalda la viabilidad de representación; el rendimiento del conjunto debe medirse en el prototipo. [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html), [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).

La propuesta técnica inicial es TypeScript + Three.js, cámara cenital y paneles HTML. Three.js dibujaría el mapa; un módulo independiente simularía movimiento, paradas y despachos. No incluye por sí mismo un simulador de transporte. No es necesario cambiar Godot o portar el juego 3D para hacer la exploración.

## Qué significa 1:1 en 2D

Usar los vectores originales proyectados en metros, **sin la compresión selectiva del mundo 3D**. Las distancias y las posiciones se conservarían dentro de la precisión cartográfica y de proyección. El zoom determina cuántos metros caben en pantalla; no hace falta que un metro ocupe una unidad física en el monitor.

Separar geometría de símbolos: al alejarse, buses y estaciones pueden mantener un tamaño mínimo en píxeles para seguir siendo visibles. Sus posiciones y distancias operativas siguen siendo métricas aunque el icono sea deliberadamente mayor. Al acercarse podría activarse una vista proporcional. La escala temporal también sería independiente: pausa, 1× y aceleración del reloj sin alterar kilómetros ni velocidades del modelo.

## Datos aprovechables y pendientes

| Pieza | Ya disponible | Trabajo para la exploración |
|---|---|---|
| Red y estaciones | Instantánea oficial con 22 registros de trazado y 153 de estación; no equivalen a conteos operativos actuales | Seleccionar componentes, sentidos y fecha de escenario; conservar IDs y atribuciones |
| Ciudad de referencia | Calzadas y manzanas del recorte Américas | Dibujar contexto tenue y generalizar solo la representación visual al alejarse |
| Servicios | 256 registros candidatos de la API del buscador, sin validar como 256 rutas troncales | Verificar variantes, secuencias de paradas, frecuencia y vigencia antes de presentar servicios reales |
| Vehículos | Ficha métrica del articulado y modelo de parada del prototipo | Definir un estado lógico de bus reutilizable y compatible con unidades fuente/jugables |
| Puentes e intersecciones | Cartografía de planta; investigación de niveles en curso | Guardar nivel y conexión permitida: dos líneas que se cruzan en pantalla no necesariamente conectan |

Reutilizar contratos de datos, identificadores, procedencia y pruebas de lógica con el proyecto 3D. El código de GDScript no se ejecutaría automáticamente en el navegador: el núcleo de simulación de la prueba web necesitaría su implementación o una estrategia explícita de intercambio. Una vista 2D puede ayudar a comprobar recorridos, colas, saltos de estación y despachos antes de introducir NPC en el mundo 3D.

## Primer experimento acotado

1. Mostrar el eje fuente Mandalay–Av. Boyacá–Marsella con posiciones reales, zoom y selección de estaciones. El contexto urbano sería ligero, sin fachadas ni modelos de puentes.
2. Añadir un itinerario **de ensayo** sobre un grafo dirigido explícito, con uno y después varios buses visibles. No derivar conexiones de la mera intersección de trazos ni ofrecerlo como una ruta vigente.
3. Simular detención, espera, salida y separación entre buses, con reloj independiente del renderizado. Probar que dos buses no se atraviesan ni saltan una parada al acelerar el tiempo.
4. Añadir selección de bus/ruta, próxima parada, tiempo y filtros visuales. La demanda de pasajeros, ocupación, despacho editable y objetivos de gestión se evaluarían en otra etapa; no se asumen como requisitos ya decididos.
5. Medir legibilidad y rendimiento con distintos números de buses. El objetivo de cobertura mayoritaria exige un inventario de expansión por corredor y pruebas de flota concurrente; una animación de puntos sin paradas ni conflictos no basta para declarar una simulación completa.

## Entrega y límites

La primera tarea de exploración debía producir una maqueta local funcional y un breve resultado de viabilidad: distancia fuente conservada, movimiento coherente en el tiempo y trazabilidad de lo que es ensayo frente a operación verificada. No desplegar ni publicar una web por el solo hecho de construirla. La elección concreta del soporte local y sus dependencias se verificará al implementarla.

La representación 2D evita modelar volúmenes, materiales, cabinas y rampas visibles. Sigue necesitando resolver la red operativa, sentidos, niveles, secuencias de parada y datos de servicio. Ese sería su principal coste y también el trabajo más reutilizable para los buses NPC del simulador 3D.
