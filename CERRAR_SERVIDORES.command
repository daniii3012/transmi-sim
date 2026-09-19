#!/bin/zsh
# Cierra los servidores del simulador que hayan quedado abiertos. Cerrar la ventana de la Terminal
# no siempre detiene el proceso: queda escuchando en 8766 u 8767 y el siguiente arranque cree que
# ya hay uno bueno. Esto los cierra todos; no toca ningún otro programa.
set -eu
pids=$(pgrep -f 'serve_network_2d\.py' || true)
if [ -z "$pids" ]; then
  echo "No hay servidores del simulador abiertos."
else
  echo "Cerrando estos servidores: $pids"
  kill $pids 2>/dev/null || true
  sleep 1
  restantes=$(pgrep -f 'serve_network_2d\.py' || true)
  [ -n "$restantes" ] && kill -9 $restantes 2>/dev/null || true
  echo "Listos. Puertos 8766 y 8767 libres."
fi
echo "Para volver a abrir: ABRIR_SIMULACION_2D.command"
