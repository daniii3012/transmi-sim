#!/bin/zsh
cd -- "${0:A:h}"
exec python3 tools/serve_network_2d.py --lan --open
