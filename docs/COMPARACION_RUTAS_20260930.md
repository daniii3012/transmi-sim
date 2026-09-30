# Comparación ruta por ruta: duración simulada, medida y publicada

30 de septiembre de 2026. Día hábil simulado (16 sep.), toda la red, con la velocidad libre y los
transbordos de esta fecha. Para cada servicio, la mediana de sus viajes del día: duración simulada y su
cociente frente a la suma de sus tramos medidos en las lecturas de la flota y frente al horario
publicado. Generada con `work/probe_tiempos_viaje.mjs` (no versionada) con `TABLA=<archivo>`.

Red entera: mediana 0,90 frente a lo medido y 0,77 frente a lo publicado. 115 servicios con tiempos medidos.

Lectura: por debajo de 0,85 el servicio va más rápido que en la calle (le faltan colas o su crucero
es alto para su corredor); por encima de 1,10, más lento. Los extremos son los primeros a revisar
cuando se calibren las colas de andén (fase 2 pendiente).

| Servicio | Destino | Viajes | Simulado (min) | sim / medido | sim / publicado |
|---|---|---|---|---|---|
| B13 | Portal Norte | 208 | 57 | **0,69** | 0,64 |
| K53 | P. ElDorado | 54 | 42 | **0,71** | 0,54 |
| C15 | Portal Suba | 211 | 66 | **0,71** | 0,68 |
| A60 | Calle 72 | 217 | 45 | **0,75** | 0,62 |
| A61 | Polo | 88 | 62 | **0,76** | 0,62 |
| B75 | Portal Norte | 222 | 62 | **0,76** | 0,65 |
| B18 | Terminal | 201 | 56 | **0,76** | 0,66 |
| D20 | Portal 80 | 203 | 64 | **0,76** | 0,69 |
| E48 | CAD | 87 | 34 | **0,77** | 0,72 |
| 3 | Corferias | 213 | 38 | **0,78** | 0,73 |
| B74 | Portal Norte | 184 | 36 | **0,78** | 0,74 |
| C19 | P.SUBA | 200 | 75 | **0,78** | 0,72 |
| 8 | Terminal | 216 | 53 | **0,79** | 0,69 |
| D21 | PORTAL 80 | 203 | 52 | **0,80** | 0,70 |
| F28 | Portal Américas | 182 | 56 | 0,81 | 0,69 |
| E42 | 7 de Agosto | 255 | 36 | 0,81 | 0,81 |
| J23 | Aguas | 252 | 25 | 0,81 | 0,66 |
| G53 | Portal Sur | 65 | 45 | 0,81 | 0,66 |
| S45 | San Mateo | 49 | 10 | 0,81 | 0,74 |
| B46 | P Norte | 144 | 53 | 0,82 | 0,77 |
| E32 | NQS Calle 75 | 204 | 38 | 0,82 | 0,74 |
| K43 | P. ElDorado | 250 | 46 | 0,82 | 0,76 |
| C73 | P.SUBA | 53 | 43 | 0,83 | 0,74 |
| B72 | Toberín | 277 | 54 | 0,83 | 0,73 |
| D24 | P. 80 | 181 | 38 | 0,83 | 0,71 |
| B28 | Portal Norte | 194 | 52 | 0,83 | 0,74 |
| L82 | Portal 20 de Julio | 311 | 58 | 0,84 | 0,69 |
| K54 | Portal Eldorado | 186 | 51 | 0,84 | 0,78 |
| C17 | Portal Suba | 218 | 63 | 0,84 | 0,74 |
| M83 | Museo Nacional | 211 | 34 | 0,84 | 0,72 |
| A52 | Flores Temporal | 53 | 47 | 0,85 | 0,77 |
| S48 | San Mateo | 94 | 35 | 0,85 | 0,73 |
| B23 | Alcalá | 193 | 49 | 0,85 | 0,72 |
| H76 | Portal Usme | 60 | 49 | 0,85 | 0,82 |
| 4 | Héroes | 215 | 45 | 0,85 | 0,75 |
| C30 | PORTAL SUBA | 109 | 54 | 0,85 | 0,78 |
| C25 | Portal Suba | 212 | 53 | 0,86 | 0,75 |
| C84 | Av. Suba - K114 D | 209 | 38 | 0,86 | 0,71 |
| B12 | P. Norte | 265 | 48 | 0,86 | 0,80 |
| S41 | San Mateo | 177 | 34 | 0,86 | 0,79 |
| 2 | Portal 20 de Julio | 193 | 20 | 0,87 | 0,65 |
| B11 | Terminal | 175 | 57 | 0,87 | 0,77 |
| 5 | Av. Jiménez | 235 | 36 | 0,87 | 0,73 |
| M51 | Museo Nacional | 171 | 39 | 0,87 | 0,73 |
| L41 | Bicentenario | 187 | 32 | 0,87 | 0,77 |
| G47 | Portal Sur | 180 | 35 | 0,87 | 0,77 |
| H83 | Portal Usme | 224 | 34 | 0,87 | 0,79 |
| Z63 | Tibanica | 363 | 25 | 0,88 | 0,78 |
| J76 | Universidades | 33 | 37 | 0,88 | 0,75 |
| Z61 | Tibanica | 87 | 77 | 0,88 | 0,72 |
| 2 | Museo Nacional | 195 | 22 | 0,88 | 0,86 |
| G45 | Portal Sur | 40 | 11 | 0,88 | 0,86 |
| M47 | Museo Nacional | 194 | 35 | 0,88 | 0,74 |
| D22 | Portal 80 | 209 | 48 | 0,88 | 0,79 |
| B26 | Alcalá | 79 | 59 | 0,88 | 0,76 |
| F32 | Portal Américas | 211 | 40 | 0,89 | 0,75 |
| 7 | Portal suba | 205 | 28 | 0,89 | 0,81 |
| M84 | KR 7 - CLL 73 | 209 | 41 | 0,89 | 0,72 |
| L81 | Portal 20 de Julio | 293 | 74 | 0,89 | 0,69 |
| H21 | PORTAL TUNAL | 201 | 56 | 0,89 | 0,78 |
| J73 | UNIVERSIDADES | 35 | 47 | 0,89 | 0,79 |
| K16 | P ElDorado | 218 | 45 | 0,90 | 0,79 |
| L18 | PORTAL 20 DE JULIO | 188 | 66 | 0,90 | 0,75 |
| K10 | P. ELDORADO | 207 | 38 | 0,90 | 0,86 |
| H27 | Portal Tunal | 105 | 71 | 0,91 | 0,81 |
| B16 | Terminal | 197 | 46 | 0,91 | 0,84 |
| S43 | San Mateo | 223 | 50 | 0,91 | 0,78 |
| G30 | PORTAL SUR | 133 | 57 | 0,92 | 0,87 |
| 5 | Portal Américas | 246 | 39 | 0,92 | 0,77 |
| 1 | Portal Eldorado | 211 | 25 | 0,92 | 0,83 |
| P85 | AV 68 Calle 9 | 113 | 22 | 0,92 | 0,71 |
| D81 | AV CL80 - KR114 | 302 | 72 | 0,92 | 0,80 |
| M82 | CLL134 - KR 7 | 316 | 60 | 0,92 | 0,71 |
| J70 | Aguas | 56 | 42 | 0,92 | 0,81 |
| B10 | Portal Norte | 186 | 35 | 0,92 | 0,84 |
| S46 | San Mateo | 138 | 58 | 0,92 | 0,72 |
| 6 | Portal 80 | 190 | 25 | 0,93 | 0,81 |
| 3 | Portal Tunal | 216 | 42 | 0,93 | 0,77 |
| L10 | P. 20 DE JULIO | 191 | 37 | 0,93 | 0,80 |
| F63 | Pradera | 364 | 30 | 0,93 | 0,69 |
| 6 | Calle 72 | 192 | 24 | 0,93 | 0,85 |
| F23 | P. Américas | 266 | 41 | 0,93 | 0,74 |
| F51 | PORTAL AMÉRICAS | 176 | 42 | 0,94 | 0,72 |
| L25 | Portal 20 de Julio | 195 | 58 | 0,94 | 0,81 |
| 7 | Polo FINCOMERCIO | 197 | 29 | 0,94 | 0,84 |
| D10 | Portal 80 | 179 | 37 | 0,94 | 0,77 |
| B50 | Calle 161 | 35 | 43 | 0,94 | 0,82 |
| G22 | Portal Sur | 207 | 50 | 0,94 | 0,84 |
| H15 | Portal Tunal | 250 | 84 | 0,95 | 0,79 |
| G52 | Portal Sur | 49 | 58 | 0,95 | 0,93 |
| H20 | Portal Usme | 233 | 76 | 0,96 | 0,80 |
| F19 | P. Américas | 187 | 89 | 0,96 | 0,83 |
| G11 | Portal Sur | 179 | 60 | 0,96 | 0,83 |
| J74 | Universidades | 176 | 45 | 0,96 | 0,85 |
| K86 | Portal ElDorado | 276 | 60 | 0,97 | 0,75 |
| J24 | Universidades | 201 | 45 | 0,97 | 0,83 |
| B55 | Terminal | 53 | 42 | 0,97 | 0,80 |
| H13 | P. TUNAL | 237 | 72 | 0,97 | 0,80 |
| S42 | San Mateo | 231 | 38 | 0,97 | 0,84 |
| G12 | G. Santander | 9 | 44 | 0,98 | 0,86 |
| 8 | Guatoque | 196 | 63 | 0,99 | 0,77 |
| 4 | Portal Sur | 210 | 47 | 0,99 | 0,86 |
| H75 | P.USME | 210 | 79 | 0,99 | 0,83 |
| H72 | P. Usme | 240 | 60 | 1,00 | 0,84 |
| F60 | Portal Américas | 197 | 57 | 1,00 | 0,82 |
| H17 | Portal Usme | 212 | 72 | 1,00 | 0,89 |
| K23 | Portal Eldorado | 179 | 54 | 1,01 | 0,89 |
| G12 | P. Sur | 282 | 51 | 1,01 | 0,85 |
| H54 | Portal Usme | 174 | 56 | 1,02 | 0,83 |
| 1 | Universidades | 221 | 23 | 1,04 | 0,93 |
| M85 | Museo Nacional | 113 | 31 | 1,06 | 0,78 |
| M86 | KR 7 - CLL 107A | 282 | 50 | 1,07 | 0,70 |
| D55 | Portal 80 | 57 | 45 | 1,08 | 0,87 |
| C50 | P. Suba | 35 | 52 | **1,15** | 0,97 |
| F26 | Portal Américas | 58 | 84 | **1,29** | 0,96 |
