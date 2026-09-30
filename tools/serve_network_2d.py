"""Serve only public simulator assets: loopback by default, optional explicit LAN.

Static files and nothing else: the simulator runs entirely in the browser, so this is just a way to
open it without a build step. Directory listing is refused and nothing is cached, so editing a file
and reloading shows the change.
"""
import argparse
import datetime
import functools
import http.server
import json
import shutil
import socket
import subprocess
import threading
import urllib.parse
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'app/dist'

class LocalHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, 'Not found')
        return None

    def json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def refresh_checkpoints():
    """Recalcula en segundo plano el día precalculado si es de otro motor.

    Sin él, cada navegador —un teléfono en la red local, sobre todo— simula desde las 03:00 hasta la
    hora actual antes de mostrar nada. Mientras se recalcula, la página funciona igual, solo que abre
    más despacio; cuando termina, la siguiente carga ya lo usa.
    """
    try:
        engine = json.loads((DIRECTORY / 'engine.json').read_text())['engine']
    except (OSError, ValueError, KeyError):
        return
    try:
        index = json.loads((DIRECTORY / 'checkpoints/index.json').read_text())
    except (OSError, ValueError):
        index = {}
    # Hace falta ayer (la madrugada es todavía su día de servicio) y hoy.
    bogota = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-5))).date()
    needed = {str(bogota - datetime.timedelta(days=1)), str(bogota)}
    covered = {d for s in index.get('scenarios', {}).values() for d in s.get('dates', [])}
    node = shutil.which('node')
    if (index.get('engine') == engine and needed <= covered) or not node:
        return
    print('Precalculando el día del escenario inicial para este motor (un par de minutos)…', flush=True)
    def run():
        result = subprocess.run([node, str(ROOT / 'tools/build_day_checkpoints.mjs'), '--days', '8'],
                                cwd=ROOT, capture_output=True, text=True)
        print('Día precalculado listo.' if result.returncode == 0 else
              'No se pudo precalcular el día: ' + (result.stderr.strip().splitlines() or ['?'])[-1], flush=True)
    threading.Thread(target=run, daemon=True).start()

def lan_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            # A connect without send discovers the selected interface; no packet payload.
            connection.connect(('192.0.2.1', 9))
            return connection.getsockname()[0]
    except OSError:
        return socket.gethostname() + '.local'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--lan', action='store_true', help='Permitir acceso desde la red local por el puerto 8767')
    args = parser.parse_args()
    port = 8767 if args.lan else 8766
    host = '0.0.0.0' if args.lan else '127.0.0.1'
    local_url = f'http://127.0.0.1:{port}/'
    player_url = f'http://{lan_address()}:{port}/' if args.lan else local_url
    try:
        server = http.server.ThreadingHTTPServer((host, port), functools.partial(LocalHandler, directory=str(DIRECTORY)))
    except OSError as error:
        try:
            with urllib.request.urlopen(local_url + 'services.json', timeout=2) as response:
                current = json.loads(response.read(20_000_000))
            expected = json.loads((DIRECTORY / 'services.json').read_text())
            if current.get('revision') != expected['revision'] or current.get('source_hashes') != expected['source_hashes']:
                raise ValueError('Different server')
        except Exception:
            raise SystemExit(f'El puerto {port} está ocupado por otra aplicación. {error}')
        print('Transmi ya está abierto: ' + player_url)
        if args.open:
            webbrowser.open(local_url)
        return
    print('Transmi 2D: ' + player_url, flush=True)
    if args.lan:
        print('Abre esa dirección desde otro dispositivo de la misma red. Cada dispositivo tiene su propio escenario.', flush=True)
    print('Mantén esta Terminal abierta; Ctrl+C cierra este servidor.', flush=True)
    refresh_checkpoints()
    if args.open:
        threading.Timer(.3, lambda: webbrowser.open(local_url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
