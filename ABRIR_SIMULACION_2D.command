#!/bin/zsh
set -eu
TRANSMI_PROJECT_DIR="${0:A:h}"
exec /usr/bin/python3 "$TRANSMI_PROJECT_DIR/tools/serve_network_2d.py" --open
