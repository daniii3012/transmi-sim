# Plan y alcance vigente

Versión 4 · 11 de septiembre de 2026. El objetivo sigue siendo observar el sistema troncal y dual sobre la geografía real. Zonales, conducción 3D y construcción de líneas quedan fuera del alcance activo.

## Entrega integrada

| Hito | Estado |
|---|---|
| Reorganización y archivo 3D | Completo |
| Catálogo oficial ampliado, fuentes, normalización y auditoría | Integrado; 117 variantes utilizables, 20 registros bloqueados por datos |
| Operación de servicios, distancias métricas, paradas y paso independiente | Integrado |
| Reloj reversible, fechas, festivos, ventanas y pico/valle | Integrado |
| Selección por servicio, varias troncales y red | Integrado y probado en navegador |
| Vagones y flota en terminales | Integrados como modelo simplificado con supuestos visibles |
| Contexto urbano, colores oficiales y diseño de paneles | Integrado; OSM y geografía de rutas separadas |
| Pasajeros y clases de bus | Integrados; entradas históricas, destinos y parte de los tipos estimados |
| Planificador de viajes | Integrado: fecha/hora, servicios, hasta dos transbordos, geometría parcial y tiempos estimados |
| Semáforos corroborados | Integrados con ciclos estimados y control para desactivarlos |
| Guardado, pruebas y documentación local | Integrado; evidencia en VALIDACION_FASE2_20260911.md |

El resultado es una versión funcional local con cobertura explícita. No equivale a una réplica validada de toda la operación real. El número 116 describe registros del mapa original; no se usa como certificado de completitud.

## Mejoras que dependen de nuevos datos

1. **Geometrías y calendarios pendientes.** E48, H76 y K86 completo se resolvieron al reimportar su detalle publicado. Quedan J76 y las variantes Ciclovía ambiguas. Doce de los 20 registros pendientes ya estaban fuera de vigencia para la fecha inicial. Conservarlos como auditoría, no activarlos por rellenar el contador.
2. **Vagón por servicio.** Obtener planos y asignaciones vigentes con orientación/puertas. Doce estaciones lógicas, incluidos los nueve portales, tienen estructuras o puntos OSM detallados; la cantidad de vagones es publicada y la asignación operativa sigue estimada. El resto mantiene representación esquemática. Portales pueden tener más de tres vagones.
3. **Calibración de demanda/oferta.** Incorporar varias semanas de validaciones, salidas, tiempos de viaje, frecuencia y matriz OD. El único archivo diario actual sirve de referencia histórica, no valida destinos ni todo septiembre.
4. **Flota por ruta y patios reales.** Confirmar tipos de cada servicio y vínculos a patios/operadores, inventario y accesos. Actualmente hay regulación abstracta y reutilización compatible; no circulación en vacío ni garajes físicos completos.
5. **Cruces y obras.** Conservar y contrastar cada enlace con PMT vigente. OSM aporta etiquetas de puentes/túneles para contexto; falta una auditoría exhaustiva de niveles y enlaces de todo el sistema. La futura extensión por Avenida 68 no se trata como inaugurada.
6. **Semáforos.** Integrados donde OSM corrobora pertenencia directa a una vía de buses. La asociación exige distancia ≤12 m y sentido compatible. Fases y coordinación reales siguen pendientes; se usa un ciclo estimado visible de 90 s, sin colas microscópicas en los cruces.
7. **Dispositivos pequeños.** Hay diseño adaptable, pero la QA de esta entrega se concentra en escritorio. Ampliar a móviles, gestos táctiles y equipos de poca memoria antes de presentarlo como producto multiplataforma.

## Criterios que deben mantenerse

Datos medidos/publicados separados de hipótesis. Sin reducir distancias, unir cruces automáticamente, ocultar colas borrando buses o presentar frecuencias estimadas como oficiales. Las mejoras de rendimiento se hacen sobre cálculo, índices y dibujo. El usuario ya autorizó estimaciones ajustables, pruebas de navegador y respaldo Git; no hay autorización de despliegue público.
