# Viabilidad de publicar en GitHub Pages — análisis, 11 sep. 2026

Se evaluó si es posible subir el simulador a un host como GitHub Pages y que
**todas las funcionalidades sigan presentes**. Este documento evalúa eso. **No se publicó
nada**; AGENTS.md exige solicitud expresa y aquí solo se pidió la evaluación.

## Respuesta corta

Sí. `app/dist` es estático puro y no necesita servidor. Con una salvedad de tipo MIME que
se comprueba en el primer despliegue y una decisión de licencia que no es técnica.

## Qué se publicaría

25 archivos, **10 MB sin comprimir y 1,7 MB comprimidos**: 13 módulos `.mjs`, 7 JSON de
datos, Three.js vendorizado con su licencia, un HTML y una hoja de estilo. El límite de
GitHub Pages es 1 GB por sitio y 100 GB de tráfico al mes, así que el tamaño no es un
problema ni de lejos.

## Revisión funcionalidad por funcionalidad

| Qué necesita | Estado | Nota |
|---|---|---|
| Servidor de aplicación | No necesita | Todo el cálculo ocurre en el navegador |
| Rutas de los recursos | Compatible | Todas relativas (`./services.json`); funciona bajo `/transmi-game/` |
| Web Worker de módulo | Compatible | `new Worker('./worker.mjs', {type:'module'})` funciona sobre HTTPS |
| Recursos externos | Ninguno | No se carga ni una fuente, script o imagen de otro dominio |
| Cabeceras especiales | Ninguna | No usa `SharedArrayBuffer`, aislamiento de origen ni service worker |
| Guardado del escenario | Compatible | `localStorage`, por origen y por navegador |
| Invalidación de caché | Ya resuelta | Sufijo `?v=` en los 25 usos; Pages cachea, el sufijo fuerza la recarga |
| Nombres que Jekyll ignora | Ninguno | No hay archivos ni carpetas que empiecen por `_` |
| Consultas en vivo a APIs | No hace | Los datos son instantáneas locales; jugar no consulta TransMilenio ni OSM |

**Lo único a verificar:** que Pages sirva `.mjs` con un tipo JavaScript. Si lo sirviera
como `text/plain`, el navegador rechazaría los módulos y la aplicación no arrancaría. Se
comprueba en el primer despliegue abriendo la consola; si fallara, la solución es renombrar
a `.js` o añadir un paso de construcción. Conviene añadir un `.nojekyll` vacío de todos
modos, que cuesta nada y evita sorpresas del procesado de Jekyll.

## Cómo habría que desplegarlo

Pages publica la raíz del repositorio o la carpeta `docs/`. **Ninguna de las dos sirve
aquí**: la raíz expone `data/` entero, unos 90 MB de instantáneas crudas, y `docs/` es la
documentación del proyecto, no la aplicación.

Lo correcto es un flujo de GitHub Actions que publique **solo `app/dist`** como artefacto
de Pages. Eso mantiene fuera del sitio los datos crudos, las herramientas y el histórico,
y deja el repositorio como está.

## Lo que cambia al publicar, aunque el código sea el mismo

- **El lanzador LAN deja de ser el camino**. `ABRIR_EN_RED_LOCAL.command` seguiría
  existiendo para uso local, pero la URL pública lo reemplaza para cualquiera.
- **Cada visitante ejecuta su propia simulación**, como ya pasa entre pestañas. No hay
  estado compartido ni servidor que lo sostenga.
- **La construcción inicial toma unos 8 s de CPU** y unos 500 MB de memoria en el
  escenario completo. En un equipo modesto o un móvil de poca memoria puede ser lento o
  fallar. La QA del proyecto es de escritorio: antes de presentarlo como público conviene
  probar en móviles reales, que es un pendiente ya declarado en el plan.
- **Las cifras y vigencias quedan a la vista de cualquiera.** La aplicación ya distingue
  publicado de estimado y rotula los horarios vencidos, que es justo lo que hace falta
  para que no se malinterprete.

## Licencia y atribución

Se decidió que, al estar públicos los enlaces y no declarar licencia, se asumirá que
pueden usarse, y que el proyecto quede sin licencia o con la que corresponda. Queda
registrado como decisión suya.

Dos cosas que conviene hacer igual, porque son obligaciones concretas y baratas:

1. **OpenStreetMap es ODbL 1.0** y exige atribución. Ya aparece «© OpenStreetMap» en el
   mapa; al publicar conviene que el enlace a la licencia sea visible, no solo el texto.
2. **Three.js va con su licencia MIT** en `app/dist/vendor/THREE-LICENSE.txt`, que se
   publica junto con la librería. Eso ya cumple.

Sobre el resto: [Operación y datos](OPERACION_Y_DATOS.md) registra que la licencia de los endpoints de
rutas y cartografía de TransMilenio no está establecida en las respuestas consultadas. No
soy quien pueda resolver eso, y «es público» no equivale a «es reutilizable» en términos
legales. Queda anotado una vez: la decisión está tomada.

Un detalle práctico distinto de la licencia: publicar una réplica del sistema conviene que
deje claro que **no es un sitio oficial de TransMilenio y no son posiciones en vivo**. Eso
ya está dicho dentro de la aplicación; en un sitio público debería estar también en la
primera pantalla.

## Qué quedó preparado

Todo listo, **sin desplegar**: se valida antes del primer cargue.

- `.github/workflows/pages.yml` — flujo que publica **solo `app/dist`**.
- `app/dist/.nojekyll` — evita cualquier procesado de Jekyll.

El flujo **se dispara a mano y no se ejecuta al hacer push**. Eso es deliberado: guardar
trabajo no debería publicar nada. Si más adelante se quiere publicación automática, el
propio archivo lleva comentadas las tres líneas que hay que añadir.

Antes de empaquetar comprueba, y falla si algo no cuadra:

1. Las 56 pruebas del motor.
2. Que estén los siete JSON de datos y que sean JSON válido.
3. Que `station_layouts`, `busway_signals` y `busway_lanes` sean **idénticos byte a byte**
   entre `data/curated` y `app/dist`.
4. Que haya **una sola versión `?v=`**: servir una mezcla rompe la aplicación.
5. Que no haya rutas absolutas, que romperían bajo `/transmi-game/`.

Después de desplegar consulta el `Content-Type` de `app.mjs` y falla si no es JavaScript,
que es justo la única incógnita real de Pages. Así el primer despliegue responde la
pregunta solo, sin que haya que abrir la consola a mano.

## Primer cargue: hecho

Publicado el 11 de septiembre de 2026 en **https://daniii3012.github.io/transmi-game/**.

> El 12 de septiembre el repositorio pasó a llamarse `transmi-sim` y la dirección
> publicada es **https://daniii3012.github.io/transmi-sim/**. Este informe conserva la
> URL de su fecha: describe lo que se comprobó el 11, no dónde está el sitio hoy.

El flujo solo respondía a disparo manual y este equipo no tiene `gh` ni token: la única
credencial de GitHub vive en el llavero de macOS, que no es mía para leer. Así que el
disparador por push se activó para ese commit y se retiró en el siguiente. El flujo vuelve
a ser manual.

Comprobado sobre el sitio publicado:

- La página responde 200 y la aplicación construye el escenario: viernes 11 de septiembre,
  21:40, 395 buses y 7.016 pasajeros a bordo, en la hora real de Bogotá.
- **`.mjs` se sirve como `text/javascript`**, que era la única incógnita real de Pages. Los
  módulos y el worker cargan.
- Los JSON salen como `application/json` y comprimidos: `services.json` viaja en 562 KB en
  vez de 2,0 MB.
- El resumen «La red ahora» calcula igual que en local: día de semana, media de 13 días,
  pico a las 06:00, 1.875.996 validaciones.

Un detalle que conviene saber al revisarlo desde una automatización: la aplicación **no
calcula mientras la pestaña está oculta** (`document.hidden`), así que un panel de navegador
en segundo plano muestra los bloques vacíos aunque todo esté bien. No es un fallo; es no
gastar CPU en una pestaña que nadie mira.

## Pasos para volver a publicar

1. **Actions → Publicar simulador en Pages → Run workflow**, sobre `main`. El origen de
   Pages ya está en GitHub Actions y no hay que volver a tocarlo.
2. Revisar el último paso del flujo: dice si `.mjs` se sirvió bien.
3. Abrir la URL y comprobar que la simulación construye y no hay errores de consola.

Si `.mjs` no se sirviera como JavaScript, la salida lo dirá explícitamente y la solución
es renombrar los módulos a `.js` o añadir un paso de construcción que lo haga.

## Si se quisiera publicar en cada push

El archivo del flujo lleva comentadas las líneas que lo activarían. No está puesto a
propósito: `app/dist` cambia en casi cada commit, y el proyecto trabaja con la regla de que
guardar no publica.
