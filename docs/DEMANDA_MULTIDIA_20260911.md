# Demanda medida sobre 17 días — 11 sep. 2026

Hasta ahora el escenario se calibraba con **un solo miércoles**, el 9 de septiembre. El
perfil de sábado y el de domingo/festivo no se medían: se aplicaba una reducción estimada
del día de semana, 0,70 y 0,55. Se revisaron varios días para sacar un mejor
estimado.

## Qué se observó

Dos semanas completas de lunes a domingo más los tres primeros días de la siguiente:
**del 24 de agosto al 9 de septiembre de 2026, 17 días y 28.014.777 validaciones**. En
ese rango no cae ningún festivo colombiano, así que el perfil de festivo se apoya en los
dos domingos, que es el mismo tipo de día en el calendario del simulador.

| tipo de día | días | media diaria | factor medido | factor que se usaba |
|---|---:|---:|---:|---:|
| Entre semana | 13 | 1.878.704 | 1,000 | 1,00 |
| Sábado | 2 | 1.228.340 | **0,654** | 0,70 |
| Domingo/festivo | 2 | 567.472 | **0,302** | 0,55 |

**El domingo estaba muy sobreestimado.** Con 0,55 el modelo generaba cerca del 80 % más
de demanda dominical que la observada. El sábado estaba razonablemente cerca.

Un hallazgo que conviene registrar: **entre días de semana la variación es de solo 2,0 %**
(desviación de 37.334 sobre 1.878.704, entre 1.810.802 y 1.939.746). Es decir, el miércoles
único era un buen representante del día de semana; lo que faltaba de verdad era el fin de
semana.

## Qué cambió en el modelo

`demand.json` ahora trae, por estación, **un perfil horario por tipo de día** en
`hourly_by_day_type`, con la media de los días observados de ese tipo y cuántos fueron.
El campo `hourly` se conserva con el perfil de día de semana para que cualquier lector
antiguo siga funcionando.

En `passengers.mjs`, cuando existe el perfil medido se usa directamente y el factor de
día pasa a 1. Los factores 0,70 y 0,55 solo se mantienen como respaldo para un agregado de
un único día. Nada más cambió: la referencia 1× sigue siendo el 2,25 ya calibrado,
y la dirección y el destino siguen estimados.

Efecto a las 08:00 del escenario completo:

| día | buses | a bordo | abordados en el día | denegaciones |
|---|---:|---:|---:|---:|
| jueves 10 sep. | 1.099 | 71.593 | 1.000.250 | 3.994.975 |
| sábado 12 sep. | 487 | 34.695 | 500.697 | 848.700 |
| domingo 13 sep. | 279 | 9.755 | 174.255 | 30.235 |

## Reproducir

Los ZIP diarios no entran al repositorio: se descargan a un directorio de trabajo fuera de
Git. Solo se versiona el agregado, que basta para reconstruir los perfiles.

```sh
python3 tools/aggregate_validation_period.py /ruta/validacionTroncal*.zip
python3 tools/import_passenger_profiles.py
```

`aggregate_validation_period.py` lee cada archivo, clasifica su fecha con el mismo
calendario colombiano del simulador —festivos fijos, trasladados al lunes y los de Pascua—
y escribe medias, desviación, mínimo y máximo por estación, tipo de día y hora. Exporta
únicamente código y nombre de estación, totales por hora y procedencia con SHA-256 por
archivo. No lee ni exporta tarjetas, dispositivos, vehículos ni transacciones.

`import_passenger_profiles.py` prefiere el agregado de periodo si existe y vuelve al de un
solo día si no. Ambos caminos están en el mismo script y se eligen solos.

## ¿Es este periodo representativo?

Se contrastó con 15 días de marzo de 2026: los factores por tipo de día se mueven poco más
de un punto y el reparto por hora es casi idéntico, aunque el nivel de marzo está un 7 %
por debajo. También apareció que un festivo entre semana queda 16,5 % por debajo de un
domingo, y que la red física cambió entre ambas fechas. Detalle en
[DEMANDA_COMPARACION_MARZO_20260911.md](DEMANDA_COMPARACION_MARZO_20260911.md).

## Límites que siguen

- Diecisiete días de agosto y septiembre de 2026 no predicen otros meses, ni vacaciones,
  ni un día de paro o lluvia fuerte.
- **Ningún festivo entre semana quedó observado en este periodo.** El perfil de festivo son
  dos domingos. El contraste de marzo midió uno, el 23 de marzo, y resultó 16,5 % por debajo
  de un domingo: separar ambos tipos de día es una mejora con evidencia, pendiente de medir
  más festivos antes de aplicarla.
- Dos sábados y dos domingos son pocos: la media de esos tipos descansa sobre menos
  evidencia que la de día de semana. El agregado guarda desviación, mínimo y máximo por
  estación para que ese margen sea visible.
- Una validación es un acceso registrado, no un viaje origen-destino. La matriz OD sigue
  siendo estimada y sigue pendiente.
