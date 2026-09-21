import concurrent.futures
import os
from pathlib import Path
import socket
import subprocess
import urllib.request


def sql(statement):
    return subprocess.check_output(['psql', '-v', 'ON_ERROR_STOP=1', '-Atc', statement], text=True).strip()


# This is the actual changed candidate; the committed baseline fails instead.
assert Path('candidate.txt').read_text() == 'candidate\n'
assert not Path('/var/run/docker.sock').exists()
try:
    Path('candidate.txt').write_text('tampered')
except OSError:
    pass
else:
    raise AssertionError('candidate is writable')
assert '00000000' not in [line.split()[1] for line in Path('/proc/net/route').read_text().splitlines()[1:]]
for address, port in [('1.1.1.1', 443), ('host.docker.internal', int(os.environ['TEST_HOST_PORT'])), ('gateway.docker.internal', int(os.environ['TEST_HOST_PORT']))]:
    try:
        connection = socket.create_connection((address, port), timeout=0.5)
    except OSError:
        continue
    connection.close()
    raise AssertionError(f'external network reachable: {address}')

sql('CREATE TABLE counter (id integer PRIMARY KEY, value integer NOT NULL CHECK(value >= 0)); INSERT INTO counter VALUES (1, 0)')
sql('ALTER TABLE counter ADD COLUMN migrated boolean NOT NULL DEFAULT true')
assert sql('SELECT migrated FROM counter') == 't'
print('PASS migration and real PostgreSQL constraint', flush=True)

def transaction(_):
    sql('BEGIN; SELECT value FROM counter WHERE id=1 FOR UPDATE; SELECT pg_sleep(0.03); UPDATE counter SET value=value+1 WHERE id=1; COMMIT')


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(transaction, range(8)))
assert sql('SELECT value FROM counter') == '8'
print('PASS eight committed transactions across four competing sessions', flush=True)

api = os.environ['TEST_API']
assert b'8' in urllib.request.urlopen(api + '/value').read()
browser = subprocess.run(['chromium', '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-proxy-server', '--disable-background-networking', '--disable-crash-reporter',
    '--user-data-dir=/tmp/browser', '--virtual-time-budget=5000', '--dump-dom', api],
    capture_output=True, text=True, timeout=20)
assert browser.returncode == 0, browser.stderr
assert 'database-value=8' in browser.stdout, browser.stdout + browser.stderr
print('PASS Chromium JavaScript, API and persisted database readback', flush=True)
print('PASS read-only candidate, absent Docker socket and denied external network', flush=True)
