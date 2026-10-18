#!/usr/bin/env python3
"""Install only operator-acquired, reviewed main source; never downloads code."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from controller import config, Demand, Lxd, Recovery, Refused, private_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}', args.source):
        raise Refused('Exact reviewed main source required')
    home = Path.home()
    c = config(home / '.config/forge-studio-on-demand/config.json')
    Demand(c).read()
    vm = Lxd()
    state = vm.state()
    linger = subprocess.check_output(['loginctl', 'show-user', str(os.getuid()), '--property=Linger', '--value'], text=True).strip()
    if linger != 'yes':
        raise Refused('Owner must enable systemd user lingering before activation')
    base = home / '.local/lib/forge-studio-on-demand'
    target = base / args.source
    inventory = {name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                 for name in ['controller.py', 'guest.mjs', 'forge-studio-on-demand.service', 'install.py']}
    if target.exists():
        for name, digest in inventory.items():
            if hashlib.sha256((target / name).read_bytes()).hexdigest() != digest:
                raise Refused('Installed source identity changed')
    else:
        target.mkdir(parents=True, mode=0o700)
        for name in inventory:
            shutil.copyfile(Path(__file__).parent / name, target / name)
            (target / name).chmod(0o600)
        (target / 'release.json').write_text(json.dumps({'source': args.source, 'sha256': inventory}, indent=2) + '\n')
    stopped = subprocess.run(['systemctl', '--user', 'stop', 'forge-studio-on-demand.service'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if stopped.returncode not in [0, 5]:
        raise Refused('Existing controller stop unconfirmed')
    data = home / '.local/state/forge-studio-on-demand'
    data.mkdir(parents=True, mode=0o700, exist_ok=True)
    recovery = Recovery(data / 'recovery.json')
    # Preserve interrupted assignments. Starting an initially stopped VM once is
    # conservative until its installed journal history has been inspected.
    if not recovery.path.exists() or state == 'RUNNING':
        recovery.set(True)
    (data / 'healthy.json').unlink(missing_ok=True)
    pending = base / 'current.pending'
    pending.symlink_to(target)
    os.replace(pending, base / 'current')
    unit = home / '.config/systemd/user/forge-studio-on-demand.service'
    unit.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(target / 'forge-studio-on-demand.service', unit)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', 'forge-studio-on-demand.service'], check=True)
    active = subprocess.check_output(['systemctl', '--user', 'is-active', 'forge-studio-on-demand.service'], text=True).strip()
    if active != 'active': raise Refused('Host controller activation unconfirmed')
    deadline = time.monotonic() + 90
    while True:
        try:
            health = private_json(data / 'healthy.json')
            pid = int(subprocess.check_output(['systemctl', '--user', 'show', 'forge-studio-on-demand.service', '--property=MainPID', '--value'], text=True))
            if health['version'] == 1 and health['pid'] == pid and pid > 0:
                break
        except FileNotFoundError:
            pass
        if time.monotonic() >= deadline:
            raise Refused('Controller readiness unconfirmed; guest autostart unchanged')
        time.sleep(1)
    vm.run(['config', 'set', 'forge-render-ai01', 'boot.autostart', 'false'])
    print(json.dumps({'source': args.source, 'active': True, 'guestAutostart': False, 'idleSeconds': c['idleSeconds'], 'pollSeconds': c['pollSeconds']}))


if __name__ == '__main__': main()
