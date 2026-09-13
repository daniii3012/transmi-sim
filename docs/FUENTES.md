# Fuentes e investigación histórica

**Para la aplicación 2D vigente ver [Operación y datos](OPERACION_Y_DATOS.md).** Lo que sigue conserva la investigación del 8 de septiembre y del proyecto 3D; los pendientes históricos de OSM, rutas y simulación no describen el estado actual.

Consulta: 8 de septiembre de 2026, hora de Bogotá. Conservar la fecha de publicación, la fecha del dato y la fecha de descarga como campos distintos.

## Datos obtenidos

| Fuente | Qué aporta | Estado y límites |
|---|---|---|
| [Construcción — UAECD](https://datosabiertos.bogota.gov.co/dataset/construccion) | Polígonos de construcciones y atributos | Descargados 9.772 registros para el recorte. La ficha consultada indica dato 2026-08-30 y CC BY 4.0. Los registros pueden ser partes de edificios. |
| [Catálogo del objeto Construcción](https://www.ideca.gov.co/sites/default/files/CO_Construccion_MR.pdf) | Significado de atributos | CONNPISOS cuenta pisos; CONELEVACI combina niveles y no es una medida directa en metros. Usamos alturas estimadas, no esa cifra como altura física. |
| [Calzada — Bogotá](https://datosabiertos.bogota.gov.co/dataset/calzada-bogota-d-c) | Superficies viales | 523 registros descargados; no son un grafo completo de carriles ni confirman desniveles actuales. CC BY 4.0 en ficha. |
| [Mapa de Referencia](https://datosabiertos.bogota.gov.co/dataset/mapa-de-referencia) | Andenes, separadores y otras capas | 797 andenes y 140 separadores descargados. Fuente para contexto; el terreno y los puentes necesitan tratamiento propio. CC BY 4.0 en ficha. |
| [Estaciones troncales — conjunto nuevo](https://datosabiertos.bogota.gov.co/dataset/estaciones-troncales-de-transmilenio1) | Ubicación y atributos de estaciones | 153 registros consultados en total; tres dentro del recorte. No equivale a un censo validado de estaciones operativas. CC BY 4.0. |
| [Trazados troncales — conjunto nuevo](https://datosabiertos.bogota.gov.co/dataset/trazados-troncales-de-transmilenio) | Ejes de corredores y atributos | 22 registros consultados. Un registro puede ser una extensión; no confundir con cantidad de troncales. CC BY 4.0. |

Las consultas de estaciones y trazados usan las capas 2 y 5 de [Consulta Planificación SITP](https://gis.transmilenio.gov.co/arcgis/rest/services/ConsultaSubgerenciaPlanificacionSITP/Consulta_Planificacion_SITP/FeatureServer). Las otras geometrías se obtienen de los servicios enlazados por las fichas. `manifest.json` guarda los endpoints exactos y SHA-256. El descargador solicita primero los identificadores y después grupos pequeños para comprobar que no se pierden registros por límites del servicio.

## Fuentes identificadas que necesitan trabajo adicional

> **Actualización del 12/09/2026.** El GTFS sí está resuelto: TRANSMILENIO S.A. lo publica como dato
> abierto, junto con un alimentador GTFS-Realtime. Ver [Horario publicado](HORARIO_GTFS_20260912.md),
> [Captura del alimentador en vivo](CAPTURA_RT_20260912.md) y, para las direcciones muertas que
> siguen citándose por ahí, [Endpoints de legado](ENDPOINTS_LEGADO_20260912.md). El párrafo que sigue
> conserva lo que se sabía el 8 de septiembre.

- [GTFS SITP](https://datosabiertos.bogota.gov.co/en/dataset/especificacion-gtfs-general-transport-feed-specification-sitp): localizado. La ficha antigua indica fecha del dato 2022-01-24 y CC BY-SA 4.0. El [endpoint probado](https://gis.transmilenio.gov.co/gtfs/) devolvió HTTP 500. No se descargó ni validó un paquete vigente. El catálogo nuevo y el [portal de datos de TransMilenio](https://datosabiertos-transmilenio.hub.arcgis.com/) son las siguientes vías de búsqueda.
- [Mapa digital de TransMilenio](https://mapadigital.transmilenio.gov.co/): referencia visual oficial de servicios. No se completó aún una auditoría interactiva de cada ruta y parada.
- [Mapas Bogotá](https://mapas.bogota.gov.co/) y [Mapas Bogotá 3D](https://mapas.bogota.gov.co/3d/): orientación y comparación visual. Se examinó la configuración pública del visor 3D, que construye volumen por extrusión. Esto no acredita disponibilidad de fachadas fotorealistas ni de un paquete de modelos terminado.
- [Planos de estaciones, acceso desde TransMilenio](https://www.transmilenio.gov.co/): localizado como sección del portal; falta revisar planos específicos del piloto y fechas. No se supone que el GTFS resuelva los vagones y las puertas.
- OpenStreetMap: posible fuente complementaria, aún no incorporada. La cobertura y la licencia de cualquier conjunto adicional se comprobarán antes de usarlo. No se necesita extraer modelos de Google Maps para el enfoque actual.
- Terreno/relieve: el visor oficial referencia servicios de elevación. Falta elegir un recurso descargable con resolución y condiciones adecuadas. El prototipo usa plano, no un modelo de elevación validado.

No se ha encontrado y comprobado un modelo completo de Bogotá listo para importar en un juego. Sí hay datos suficientes para automatizar una parte sustancial de su reconstrucción geométrica.

## Referencias aportadas por Daniel

| Referencia | Uso y estado |
|---|---|
| [Ejemplo de synabreu en X](https://x.com/synabreu/status/2096557555086725159) | Inspiración de ciudad 3D. El enlace directo devolvió 403; no se verificó su implementación. |
| [Ejemplo de Matt Shumer en X](https://x.com/mattshumer_/status/2095609734845927525) | Inspiración visual. El enlace directo devolvió 403; no se verificó código, rendimiento ni técnica. |
| [Bogotá TM Bus en Roblox](https://www.roblox.com/es/games/6242740929/Bogot-TM-Bus) | Referencia de diversión y reconocimiento del lugar según la experiencia del usuario. Página localizada; no se jugó ni se inspeccionaron sus recursos. |
| [Obras de Calle 13 y Américas](https://bogota.gov.co/mi-ciudad/movilidad/asi-van-obras-de-puentes-calle-13-con-avenida-las-americas-en-bogota) | Nota del 28 de agosto de 2026 sobre el nodo de Carrera 50. Sirve para registrar el avance; falta obtener trazados provisionales y PMT vigentes. |
| [50 articulados eléctricos duales](https://www.transmilenio.gov.co/comunicaciones/noticias-de-transmilenio/comunicados-oficiales/bogota-pone-rodar-futuro-llegan-50-buses-articulados-electricos-unicos-mundo) | Comunicado actualizado el 17 de agosto de 2026. Referencia para una familia de vehículos y sus dos carrocerías. |

## Herramientas y documentación técnica

- [Godot para macOS](https://godotengine.org/download/macos/): se descargó 4.7.2 universal y se comprobó la versión del ejecutable.
- [Requisitos de Godot](https://docs.godotengine.org/en/stable/about/system_requirements.html).
- [CharacterBody3D](https://docs.godotengine.org/en/stable/classes/class_characterbody3d.html): opción para control cinemático; no se ha implementado todavía un controlador de bus.
- [Requisitos de Unreal en macOS](https://dev.epicgames.com/documentation/unreal-engine/macos-development-requirements-for-unreal-engine?lang=en-US).
- [Requisitos de Unity 6](https://docs.unity3d.com/6000.0/Documentation/Manual/system-requirements.html).
- [Blender para Apple Silicon](https://www.blender.org/download/lts/4-2/): la versión de Blender que se instale se fijará al iniciar el modelado.

## Registro de derechos y procedencia

La API de rutas se registra por su dominio oficial, `api.buscador-rutas.transmilenio.gov.co`. El cliente público del buscador se apoya en un host interno de despliegue; el 12 de septiembre de 2026 se normalizaron los registros al dominio oficial, después de comprobar que responde el mismo contenido en los dos endpoints que usa el proyecto, la búsqueda paginada y el detalle por ID. Los hashes guardados son del contenido y no cambian con esa normalización.

Las licencias indicadas son las que declaran las fichas concretas consultadas. Hay conjuntos antiguos con nombres parecidos y licencias diferentes: no generalizar la licencia de un portal a todos sus recursos. Conservar atribución y descripción de transformaciones. Las fotografías y renders externos se mantienen como referencias enlazadas; no se incorporaron como texturas ni modelos del juego.
