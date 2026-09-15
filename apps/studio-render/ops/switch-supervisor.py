#!/usr/bin/env python3
"""Drain and switch to an installed release. Rollback uses this same command with
an older approved SHA. Image acquisition and configuration are separate actions.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('sha256')
parser.add_argument('--activate', action='store_true', help='Explicitly start the selected configured worker')
args = parser.parse_args()
if os.getuid() != 0 or not re.fullmatch('[a-f0-9]{64}', args.sha256):
    raise SystemExit('Root and an installed approved release SHA256 are required')
release = Path('/opt/forge-studio/releases') / args.sha256
if not release.is_dir() or release.is_symlink():
    raise SystemExit('Installed release required')
env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'DOCKER_HOST': 'unix:///var/run/docker.sock', 'DOCKER_CONFIG': '/var/lib/forge-studio/docker-client'}

def run(command, timeout=10, check=True):
    return subprocess.run(command, check=check, timeout=timeout, env=env, capture_output=True, text=True)

# Verify installed bytes again before asking the old version to drain.
verified = subprocess.run(['/usr/bin/sha256sum', '--check', '--strict', 'SHA256SUMS'], cwd=release, env=env, capture_output=True, timeout=10)
if verified.returncode:
    raise SystemExit('Installed release verification failed')
script = "const {loadHostConfig}=await import(process.argv[1]);const c=await loadHostConfig();process.stdout.write(JSON.stringify([c.renderImage,c.verifyImage]))"
images = json.loads(run([str(release / 'node'), '--input-type=module', '-e', script, (release / 'vm/config.mjs').as_uri()]).stdout)
for image in images:
    result = json.loads(run(['/usr/bin/docker', 'image', 'inspect', image]).stdout)
    if len(result) != 1 or (result[0]['Id'] != image and image not in (result[0].get('RepoDigests') or [])):
        raise SystemExit('Approved image must be preloaded before switching')
def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def durable_write(path, data, mode=0o600):
    with path.open('wb') as file:
        file.write(data)
        os.fchmod(file.fileno(), mode)
        file.flush()
        os.fsync(file.fileno())
    sync_directory(path.parent)


state = Path('/var/lib/forge-studio')
drain = state / 'drain'
durable_write(drain, b'')
unit = 'forge-studio-supervisor.service'
end = time.monotonic() + 1200
while True:
    active = run(['/usr/bin/systemctl', 'show', unit, '--property=ActiveState', '--value']).stdout.strip()
    if active in ('inactive', 'failed', ''):
        break
    if time.monotonic() >= end:
        raise SystemExit('Drain unconfirmed; current release and drain flag preserved')
    time.sleep(1)
# An inactive process alone is not proof that its assignment is retired.
check = "const {readdir}=await import('node:fs/promises');const {VmJournal}=await import(process.argv[1]+'/journal.mjs');const {readCycleState}=await import(process.argv[1]+'/cycle-state.mjs');for(const e of await readdir('/var/lib/forge-studio/poll',{withFileTypes:true})){if(!e.isDirectory()||!/^[a-f0-9]{32}$/.test(e.name))throw Error('Unexpected journal');const s=await readCycleState(new VmJournal('/var/lib/forge-studio/poll/'+e.name));if(s.assignment&&!s.complete)throw Error('Unfinished assignment requires current-version reconciliation')}"
run([str(release / 'node'), '--input-type=module', '-e', check, (release / 'vm').as_uri()])
current = Path('/opt/forge-studio/current')
if current.exists() and not current.is_symlink():
    raise SystemExit('Unexpected current release path')
if current.is_symlink() and current.resolve() != release:
    durable_write(state / 'previous-release', (str(current.resolve()) + '\n').encode())
pending = Path('/opt/forge-studio/current.pending')
if pending.exists() or pending.is_symlink():
    raise SystemExit('Unresolved switch preserved')
pending.symlink_to(release)
sync_directory(pending.parent)
os.replace(pending, current)
sync_directory(current.parent)
unit_path = Path('/etc/systemd/system') / unit
durable_write(unit_path, (release / 'supervisor.service').read_bytes(), 0o644)
run(['/usr/bin/systemctl', 'daemon-reload'])
if args.activate:
    drain.unlink()
    sync_directory(state)
    run(['/usr/bin/systemctl', 'reset-failed', unit], check=False)
    run(['/usr/bin/systemctl', 'start', unit])
print('Selected release ' + args.sha256 + ('; started configured worker' if args.activate else '; left drained and inactive'))
