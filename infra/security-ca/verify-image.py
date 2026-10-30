"""Compare vendor runtime/binaries; exercise public TLS and empty isolated storage."""
import json
import re
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
row = next(row for row in json.loads((root / 'images.json').read_text()) if row['name'] == sys.argv[1])
image = 'security-ca-ci:' + row['name']

def run(*args):
    return subprocess.check_output(args, text=True)

run('docker', 'pull', row['base'])
run('docker', 'build', '-t', image, str(root / row['name']))
configs = [json.loads(run('docker', 'image', 'inspect', ref))[0]['Config'] for ref in [row['base'], image]]
for field in ['User', 'Entrypoint', 'Cmd', 'WorkingDir', 'Volumes', 'ExposedPorts']:
    assert configs[0].get(field) == configs[1].get(field), field
before = dict(value.split('=', 1) for value in configs[0].get('Env', []))
after = dict(value.split('=', 1) for value in configs[1].get('Env', []))
before['SSL_CERT_DIR'] = '/usr/local/share/security-ca/certs'
assert before == after
binary_probe = 'sha256sum /usr/lib/postgresql/*/bin/postgres /usr/lib/postgresql/*/bin/pg_ctl /usr/lib/postgresql/*/bin/initdb /usr/lib/postgresql/*/bin/psql' if row['kind'] == 'postgres' else 'sha256sum /opt/typesense-server'
hashes = [run('docker', 'run', '--rm', '--network=none', '--entrypoint', 'sh', ref, '-c', binary_probe) for ref in [row['base'], image]]
assert hashes[0] == hashes[1], 'Server or database utility binary changed'
package_probe = "dpkg-query -W -f='${Package}=${Version}\\n'"
packages = [dict(line.split('=', 1) for line in run('docker', 'run', '--rm', '--network=none', '--entrypoint', 'sh', ref, '-c', package_probe).splitlines()) for ref in [row['base'], image]]
assert packages[0].keys() == packages[1].keys(), 'Package set changed'
assert {name for name in packages[0] if packages[0][name] != packages[1][name]} <= {'ca-certificates'}, 'Non-CA package changed'
mount = str(root) + ':/audit:ro'
trust = run('docker', 'run', '--rm', '-v', mount, '--entrypoint', 'sh', image, '/audit/verify-trust.sh')
rows = re.findall(r'TLS (\S+) (bundle|directory|dedicated) status=(\d+)', trust)
assert len(rows) == 9 and all(int(code) == (0 if host == 'www.google.com' else 1) for host, store, code in rows), trust
assert trust.count('Verify return code: 20 (unable to get local issuer certificate)') == 6, trust
assert trust.count('Verify return code: 0 (ok)') == 3, trust
if row['kind'] == 'postgres':
    result = run('docker', 'run', '--rm', '--network=none', '--user=postgres', '-v', mount, '--entrypoint', 'sh', image, '-c', 'set -eu; set -- /usr/lib/postgresql/*/bin; exec sh /audit/verify-postgres-startup.sh "$1"')
    assert '\n1\n' in result and 'server stopped' in result, result
else:
    result = run('docker', 'run', '--rm', '--network=none', '-v', mount, '--entrypoint', 'bash', image, '/audit/verify-typesense-startup.sh')
    assert '"ok":true' in result and 'EMPTY_COLLECTIONS_RESPONSE' in result, result
print('PASS: unchanged runtime and binaries, independent TLS controls, isolated empty-data startup:', row['name'])
