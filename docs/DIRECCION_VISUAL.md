# Dirección visual de Transmi 2D

10 de septiembre de 2026. Referencia principal: [Subway Builder](https://www.subwaybuilder.com/), complementada por la claridad de [Mini Metro](https://dinopoloclub.com/games/mini-metro/). La dirección cozy de Godot permanece archivada con el proyecto 3D en pausa.

La ciudad mantiene su forma geográfica. El objetivo es que al acercarse aparezcan calles y lugares reconocibles, y al alejarse se lea la red completa: contexto urbano tenue, corredores con colores oficiales, estaciones sobrias, buses distinguibles y controles compactos. No usar un mapa esquemático como base geométrica ni invertir en edificios o cabinas 3D.

Priorizar una superficie cartográfica amplia y el ciclo de observar, elegir rutas y mover el reloj. El contexto de edificios, vías, agua y zonas verdes será secundario y generalizado por zoom. Necesita fuentes cartográficas propias y sus atribuciones; no se copiarán los gráficos ni mosaicos del juego de referencia.

Colores de zonas desde los atributos publicados por el mapa digital; no equiparar sus letras con cualquier paleta de un plano histórico. Color de ruta, estado del vehículo y selección son señales diferentes. No usar un cambio de color que haga perder la identidad del servicio: añadir contorno o estado en el inspector.

Símbolos con tamaño mínimo en pantalla; posición y velocidad lógica siempre métricas. En coincidencias densas pueden agruparse con un contador, sin eliminar vehículos del modelo ni crear ocupación física según el tamaño del icono. En detalle, distinguir paso, detención y paraderos callejeros, con marcas estimadas claramente identificadas.

Se consultó la página oficial de Subway Builder y su galería enlazada. La recuperación de imágenes por la herramienta web fue parcial; no afirmar que se revisaron exhaustivamente sus capturas o animaciones. Esta ficha traduce esa referencia a decisiones del proyecto, no reproduce recursos de ese juego.
