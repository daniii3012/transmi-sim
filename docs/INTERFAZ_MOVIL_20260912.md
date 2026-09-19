# Interfaz web adaptable — 12 septiembre 2026

Revisión contra la galería oficial de Subway Builder: mantener el mapa como superficie principal, contexto tenue y paneles de consulta compactos. Se conservan la geografía 2D y los colores del sistema.

- Navegación principal simplificada; Terminales, Operación, Datos y Fuentes en Más.
- En pantallas pequeñas, navegación inferior y panel de lectura plegable. La ficha de selección sustituye al panel y al reloj mientras está abierta.
- En móvil el reloj desaparece al planear un viaje. La fecha del escenario queda accesible desde Más.
- Zoom con dos dedos y arrastre simultáneo, sin seleccionar un bus al terminar un gesto de zoom. Selección más amplia para pantalla táctil.
- Márgenes seguros iOS, altura dinámica del viewport, listas en una columna y tamaños legibles.

Comprobación: 75 pruebas JavaScript pasaron. Navegador a 1280×720, 390×844 y 375×667; navegación, plegado, mapa y consola sin errores. Esta revisión no equivale a una prueba táctil física. El empaquetado iOS y su transporte nativo se desarrollan exclusivamente en el repositorio privado; este hito no incorpora ese código.
