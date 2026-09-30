# Plan de trabajo — de simulador a juego de observación

30 de septiembre de 2026. Reemplaza el orden de pendientes de `CONTINUAR.md` y amplía el alcance de
`PLAN_DEL_PROYECTO.md` (versión 4, 11 sep.). Fases cortas, pensadas para cerrarse en una o dos
sesiones cada una, con un hito comprobado al final de cada fase.

## Principios que no cambian

- Geografía real 1:1, sin disposición esquemática. Medido y estimado siempre separados y rotulados.
- Una sola aplicación y un solo motor. Metro, cable y lo que venga se suman como vistas o capas que
  reutilizan mapa, reloj y motor, no como programas aparte que haya que mantener dos veces.
- El rendimiento se gana en cálculo, índices y dibujo, nunca borrando buses ni simplificando la red.
- La estética actual ya tiene identidad (referencias: Subway Builder y la vista de transporte de
  Cities: Skylines). Se pule, no se rehace.
- Nada se despliega en Pages sin pedirlo. Nada se descarga de un portal sin avisar antes.

## Diagnóstico de esta revisión

Hallazgos comprobados en el código y los datos el 29–30 sep., que ordenan el plan:

1. **La carga lenta en móvil tiene una causa concreta.** Los puntos de control precalculados del
   escenario inicial (`app/dist/checkpoints/`) son de la versión `20260928.4`; la aplicación va en
   `20260929.15`. `checkpoints.mjs` descarta los de otra versión, así que el navegador simula el día
   desde las 03:00 hasta la hora actual. En escritorio son ~25 s para el día completo; en un teléfono,
   minutos. Cada salto de `?v=` deja inservibles los puntos de control si no se regeneran.
2. **Los buses van lentos porque el crucero no depende de la hora.** `speedCells` toma como crucero el
   percentil 75 del campo de velocidad del tramo (`CRUISE_QUANTILE`), y ese campo promedia todas las
   franjas. Las lecturas de posición de un miércoles (16 sep.) dan, en la troncal, una mediana en
   movimiento de 23–25 km/h a cualquier hora, pero el 10 % más rápido va a 44–50 km/h, también a las
   21 h. El bus de noche por la Calle 13 o las Américas a ~60 km/h es real y el modelo no lo produce:
   usa un promedio de todo el día donde debería usar la velocidad libre de esa franja.
3. **Las estaciones de transbordo se ven vacías.** `passengers.mjs`: «un transbordo cuenta como seguir
   de largo». Quien cambia de bus en Las Nieves, Jiménez o Ricaurte no aparece esperando allí; solo
   aparece quien valida en la entrada. Las validaciones cuentan entradas, no transbordos internos.
4. **La flota ajustable no pone más buses en la calle.** El parámetro «Flota disponible» (200–8.000)
   es un tope: si sobra, no se despacha nada adicional porque las salidas vienen del horario. Para
   «ver colapsar el sistema con miles de buses» hace falta un multiplicador de oferta.
5. **El seguimiento de bus ya compensa el panel** (`focusShift` en `map.mjs`), pero no se recalcula
   al plegar la tarjeta, y la cámara no gira con el bus.
6. **El logo de móvil no es el de escritorio**: `mobile.css` reduce la marca a la caja «tm».
7. **Puentes y niveles.** `busway_structures.json` trata igual un puente sobre un caño (a nivel, de
   pocos metros) que un viaducto, y no tiene la categoría «a desnivel bajo la calle sin ser túnel»
   (la intersección de la Caracas con la Calle 26). La calzada, los puentes semitransparentes y las
   líneas de recorrido se dibujan unos sobre otros en empalmes y cruces.

## Fase 0 — Organización y publicación (esta semana)

- [x] Espacio de trabajo local reunido en una sola carpeta (copia; los árboles anteriores quedan
      intactos).
- [x] **Versión legado publicada.** La primera versión pública (`30a7840`, 19 sep.) es la raíz de la
      historia de `main`, así que no necesita rama propia: el workflow de Pages la extrae con
      `git archive 30a7840 app/dist` y la sirve en `/transmi-sim/legado/`, junto a la actual en la
      raíz. Solo comparte con la nueva la preferencia de tema en `localStorage` (`transmi-theme`),
      que es inocua. Enlace a «Versión 1 (legado)» desde el panel Fuentes.
- [x] Empujar `main` a `origin` (42 commits revisados: sin coautoría, sin direcciones de servicios,
      sin la matriz por pares).
- [ ] Publicar en Pages la versión actual en la raíz y el legado en `/legado/` — **solo cuando se
      pida**.

Hito: las dos URL responden y el workflow pasa sus comprobaciones.

## Fase 1 — Arreglos rápidos (1 sesión) · hecha el 30 sep. salvo el punto 4, que pasa a la fase 5

1. **Puntos de control ligados al motor, no a la versión de la interfaz.** La llave pasa a ser un
   hash de lo que cambia el resultado (motor, horario, parámetros), no `?v=`. Un cambio de CSS ya no
   invalida nada. El lanzador local regenera los que falten al abrir, y el workflow ya los genera.
   Objetivo: móvil en la LAN abre a cualquier hora en segundos.
2. **Cámara.** Recentrar al plegar/desplegar la tarjeta o la hoja. Nuevo modo «Cámara detrás del
   bus»: la vista gira con el rumbo suavizado del bus (sin mareo en curvas); girar a mano, pedir el
   norte o dejar de seguir lo apagan.
3. **Logo único**: el de escritorio en todas las anchuras.
4. Lista de solapamientos y errores visuales de la hoja móvil, corregidos uno por uno con capturas a
   375×812 y 390×844.

Hito: carga en teléfono medida y anotada; capturas de antes/después.

## Fase 2 — Operación realista: velocidad y pasajeros (2 sesiones)

**Velocidad.**
1. Medir por franja (madrugada, pico AM, valle, pico PM, noche) y por corredor la velocidad en
   movimiento de las lecturas de la flota: mediana y percentiles 75/85/90 por cubeta de 100 m.
2. Campo de velocidad con dimensión de franja. El crucero de cada tramo sale de la velocidad libre
   de esa franja (percentil alto de quien rueda), no del promedio de todo el día. El tope de 60 km/h
   se mantiene, con la variación de ±5 por bus.
3. **Comparación ruta por ruta**: tiempo de recorrido simulado, observado y publicado por franja,
   para las 119 rutas. Tabla en `docs/` y ficha en «Datos». Objetivo: que la noche salga más rápida
   que el pico y que el 5,7 % de tramos que hoy no alcanzan su tiempo publicado baje.

**Estado al 30 sep.** Velocidad hecha (`docs/VELOCIDAD_LIBRE_20260930.md`): la franja resultó no
importar; lo que faltaba era la velocidad libre. Transbordos hechos. Pendientes: espera por ruta en
vez de por sentido (causa probable de Las Nieves), las colas de andén y detenciones en tráfico que
faltan (viajes en 0,90 del tiempo medido) y la tabla ruta por ruta.

**Pasajeros.**
4. Transbordos: quien cambia de servicio baja en la estación de transbordo y vuelve a esperar allí
   (sentido del segundo tramo), en vez de seguir de largo. Afecta sobre todo a Las Nieves, Jiménez,
   Ricaurte, Calle 76, Héroes y los portales.
5. Contraste en sitio: Las Nieves hacia las 21:30 de un día hábil, a partir de las entradas cada
   15 minutos de las validaciones. Revisar el abandono medio de 30 min y la escala del círculo
   (hoy «lleno» a 250).
6. K86: resolver el nudo de la vuelta de la Séptima con su registro publicado, si la comparación
   lo permite sin tocar la fuente curada a mano.

Hito: validación del día con la nueva velocidad (mediana y p90 frente a lo observado, por franja).

## Fase 3 — Malla vial, niveles y estaciones (2–3 sesiones)

Estado al 30 sep.: punto 1 hecho en su parte automática (16 puentes a nivel, 28 deprimidos como
trinchera de 3 m, puentes viales sobre caños planos). Falta revisar caso a caso con ortofoto, la losa
de las calles que cruzan sobre un deprimido y el dibujo limpio de la calzada.

1. **Auditoría de estructuras.** Cada puente/deprimido de `busway_structures.json` con su clase:
   - a nivel sobre cuerpo de agua (puentes sobre caños, alcantarillas): se dibujan planos;
   - elevado (puentes y viaductos reales): altura desde `layer` y longitud;
   - a desnivel bajo la calle (Caracas con Calle 26 y similares): calzada hundida con muros, sin
     ser túnel;
   - túnel.
   Criterios: etiquetas `bridge`, `layer`, `tunnel`, `cutting`, `covered`, cruce con `waterway`,
   longitud. Revisión de cada caso con ortofoto; la clase y su evidencia quedan en el JSON.
2. **Dibujo limpio de la calzada.** Una sola cinta de calzada por nivel, con empalmes y
   bifurcaciones cosidos (sin líneas superpuestas), las líneas de recorrido solo cuando se pide una
   ruta, puentes opacos con desvanecimiento cuando la cámara mira por debajo o el bus seguido pasa
   bajo ellos, y la capa «Puentes» conservada. Rendimiento medido antes y después (hoy ~4 ms por
   cuadro).
3. **Estaciones contra ortofoto.** Herramienta interna de revisión: cada estación sobre la ortofoto
   abierta de IDECA, con vagones, paradas y calzada superpuestos; estado por estación («confirmada»,
   «corregida», «sin evidencia») guardado en un JSON con fecha y fuente. Primero las 42 sin
   geometría OSM, luego las que pisan calzada o tienen paradas fuera del vagón.
4. **Buses en los patios.** `tools/build_depots.py` ya descuenta los parqueaderos, vías internas y
   edificios de OSM. Los solapes vienen de lo que OSM no trae: se descuentan además las construcciones
   de Catastro (las del 3D, `data/raw/construcciones*`), la calzada de TransMilenio que entra al patio
   (`busway_context.json`, `busway_geometry.json`) y los puentes; las filas se orientan por el eje
   largo de cada zona libre, revisado contra ortofoto. La posición sigue siendo estimada: no hay dato
   abierto de puestos.

Hito: 151 estaciones con estado; mapa sin solapes en Banderas, Calle 26/Caracas, NQS/26 y Ricaurte.

## Fase 4 — Panel de simulación y eventos (2 sesiones)

1. **Revisar el panel Parámetros** entero: agrupar en Oferta, Circulación, Estaciones, Pasajeros y
   Eventos; cada uno con su explicación y su valor por defecto medido o estimado.
2. **Multiplicador de oferta** (×0,25 a ×5): añade salidas entre las publicadas o las retira. Con
   flota ilimitada, es la forma de poner miles de buses y ver el colapso. Indicadores de colapso:
   buses detenidos, cola más larga, velocidad media por troncal.
3. **Eventos** colocables en el mapa, con hora de inicio y duración:
   - bloqueo de carril o de calzada (accidente, bus varado): los buses hacen fila o rebasan por el
     otro carril donde lo haya;
   - cierre de un tramo: los servicios se detienen o se desvían por la ruta
     alternativa más corta de la red de calzada; si no hay desvío posible, se retienen;
   - estación cerrada (los servicios pasan sin parar);
   - lluvia (factor de velocidad y de demanda).
   El motor ya tiene lo necesario: carriles, turnos en empalmes y colas.
4. **Escenario de ejemplo: cierre en la Calle 80**, entre Minuto de Dios y Ferias, precargado en el
   panel de eventos.
5. Escenario compartible por URL (fecha, hora, parámetros y eventos), sin guardar nada en el
   navegador sin pedirlo.

Hito: un cierre colocado a mano da filas y desvíos plausibles.

## Fase 5 — Móvil instalable (1–2 sesiones)

Recomendación: **una sola aplicación con dos cascarones**, no dos aplicaciones. El motor, el mapa y
los datos son los mismos; cambian el diseño de controles y los valores por defecto. Mantener dos
programas duplicaría cada arreglo.

1. PWA: `manifest.webmanifest`, íconos, pantalla de inicio y un service worker que guarda datos y
   puntos de control por versión. La segunda visita no descarga nada.
2. Cascarón de teléfono inspirado en apps de mapas y transporte (Citymapper, Transit, Apple Mapas):
   mapa a pantalla completa, hoja con tres alturas, controles en la zona del pulgar.
3. Valores por defecto de teléfono: edificios solo en la franja de 350 m, menos etiquetas, sombra
   simple. Medir memoria y cuadros por segundo en un teléfono real.
4. El diseño adaptable de escritorio sigue funcionando en móvil para quien no instale.

Hito: instalada en un teléfono, abre sin red después de la primera visita.

## Fase 6 — TransMiCable (1–2 sesiones)

1. **Línea de Ciudad Bolívar** (en operación): trazado, cuatro estaciones y cabinas con su
   frecuencia publicada; conexión con Portal Tunal.
2. **Línea de San Cristóbal**: se incorpora cuando haya trazado y fecha vigentes; hasta entonces,
   capa de proyecto rotulada.
3. **Terreno solo donde hace falta**: modelo digital de terreno abierto recortado a los corredores de
   cable (la sabana es casi plana; las laderas no). El resto de la ciudad sigue plano.

Hito: cabinas en movimiento sobre el terreno, con horario y capacidad declarados.

## Fase 7 — Metro de Bogotá, Línea 1 (investigación + 2–3 sesiones)

Vista aparte («Metro L1 · proyecto»), con el mismo mapa, reloj y motor, fuera de la simulación
principal.

1. **Investigación** con fuentes y fecha por dato: trazado del viaducto, las 16 estaciones, patio
   taller, altura del viaducto y de las estaciones, material rodante (30 trenes), planos por estación
   publicados, fecha estimada de operación. Fotos de referencia para modelar tren y estaciones.
2. Geometría: viaducto elevado con pilas, estaciones con su volumen, patio taller.
3. Operación estimada y rotulada como tal: horario, intervalos pico/valle y tiempos entre estaciones
   a partir de velocidad comercial publicada.
4. Integraciones con troncales de TransMilenio donde el metro las cruza, solo como referencia visual.

Hito: la Línea 1 corre un día completo con su operación estimada y cada cifra con su fuente.

### 7b — Troncal Av. 68 (proyecto, en la misma vista de proyectos)

La troncal está en obra y lo público es parcial: trazado del contrato, algunas estaciones y
calzadas ya construidas, ninguna ruta. Se incluye como capa opcional «Proyectos», nunca en la
simulación principal:

1. Investigación con fuente y fecha: trazado, estaciones y su estado de obra por grupo de contrato,
   conexiones con troncales existentes y fecha estimada de entrada.
2. Geometría: calzada y estaciones donde haya plano o imagen reciente; lo demás, sobre el eje de la
   avenida y rotulado como estimado.
3. Operación **ilustrativa**, claramente marcada: servicios hipotéticos armados con la lógica de la
   red actual (un corriente y un par de expresos con sus conexiones), frecuencias estimadas. Se
   retira en cuanto TransMilenio publique las rutas reales.

## Fase 8 — Juego de observación (después)

Retos acotados sobre la red existente, sin construir líneas: sostener un corredor durante un
cierre, reorganizar la oferta de un pico, llevar la ocupación por debajo de un umbral con
una flota dada. Se diseña cuando las fases 2 y 4 estén firmes.

## Fuera de alcance por ahora

- Componente zonal (SITP): miles de buses, toda la malla vial y el peso en móvil. Se retoma cuando
  el rendimiento en teléfono esté resuelto.
- B27: sin datos de medición; queda como está.
- Posición real de los buses en patios: no hay dato abierto.
- 20 registros del catálogo sin geometría: se aplica la regla de buscar la ruta publicada y estimar
  lo que falte, caso por caso, cuando aparezcan en una revisión.
- Fases semafóricas reales y matriz origen-destino oficial: sin fuente.

## Orden y dependencias

```
F0 organización/legado ─┬─ F1 arreglos rápidos ── F5 móvil instalable
                        ├─ F2 velocidad y pasajeros ── F4 panel y eventos ── F8 juego
                        └─ F3 niveles y estaciones ── F6 cable (terreno) ── F7 metro
```

F1 y F2 son lo más urgente: lo primero que se nota al usar la app es la carga en móvil, la cámara y
la velocidad. F3 y F4 pueden alternarse entre sesiones. F6 y F7 dependen del dibujo por niveles de
F3.
