#!/usr/bin/env python3
"""Trusted, explicitly selected inactive rollout; never run inside a job container."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

from release import ReleaseRefused, apply_selected, unique_object


ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8',
       'DOCKER_HOST': 'unix:///var/run/docker.sock',
       'DOCKER_CONFIG': '/var/lib/forge-studio/docker-client'}
OPS = Path(__file__).resolve().parents[1]
STATE = Path('/var/lib/forge-studio')
CONFIG = Path('/etc/forge-studio/worker.json')


def read_private(path, limit=65536):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise ReleaseRefused('Root-owned private input required')
        raw = source.read(limit + 1)
    if len(raw) > limit:
        raise ReleaseRefused('Host input size refused')
    return raw


def sync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_once(path, raw):
    with path.open('xb') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    sync(path.parent)


def command(argv, timeout=30):
    # Discard command output: Docker/Node errors must not print registry/config
    # credentials. Failure leaves the release directory and drain for inspection.
    try:
        result = subprocess.run(argv, env=ENV, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        raise ReleaseRefused('Host command timed out; preserve pending rollout') from error
    if result.returncode:
        raise ReleaseRefused('Host command failed; preserve pending rollout')


class LocalHost:
    def __init__(self, stage, bundle):
        self.stage, self.bundle = stage, bundle
        self.config_raw = None

    def preload(self, candidate):
        # Acquisition is release work only. Runtime still uses --pull=never.
        for image in candidate['images'].values():
            command(['/usr/bin/docker', 'pull', '--platform', 'linux/amd64', image], 600)
            command(['/usr/bin/docker', 'image', 'inspect', image])
        write_once(self.stage / 'images-preloaded', b'')

    def install(self, candidate):
        bundle = candidate['bundle']
        raw = read_private(self.bundle, 150000000)
        if len(raw) != bundle['size'] or hashlib.sha256(raw).hexdigest() != bundle['sha256']:
            raise ReleaseRefused('Selected bundle bytes differ')
        snapshot = self.stage / 'supervisor.tar'
        write_once(snapshot, raw)
        installed = Path('/opt/forge-studio/releases') / bundle['sha256']
        if not installed.exists():
            command(['/usr/bin/python3', str(OPS / 'install-supervisor.py'), str(snapshot), bundle['sha256']])
        # Existing releases are reverified by switch-supervisor before selection.
        write_once(self.stage / 'installed-inactive', b'')

    def drain(self):
        current = Path('/opt/forge-studio/current')
        if not current.is_symlink():
            # Initial bootstrap is deliberately the existing explicit installation
            # contract. This update command cannot infer that an unknown host is idle.
            raise ReleaseRefused('Existing selected release required; bootstrap separately')
        selected = current.resolve()
        if selected.parent != Path('/opt/forge-studio/releases') or len(selected.name) != 64:
            raise ReleaseRefused('Current release identity refused')
        command(['/usr/bin/python3', str(OPS / 'switch-supervisor.py'), selected.name], 1250)
        self.config_raw = read_private(CONFIG)
        write_once(self.stage / 'previous-worker.json', self.config_raw)
        write_once(self.stage / 'previous-release', (selected.name + '\n').encode())
        write_once(self.stage / 'drained', b'')

    def select(self, candidate):
        if self.config_raw is None or read_private(CONFIG) != self.config_raw:
            raise ReleaseRefused('Worker configuration changed during rollout')
        value = json.loads(self.config_raw, object_pairs_hook=unique_object)
        value['renderImage'], value['verifyImage'] = candidate['images']['render'], candidate['images']['verify']
        pending = CONFIG.with_name('worker.release-pending.json')
        write_once(pending, (json.dumps(value, sort_keys=True) + '\n').encode())
        os.replace(pending, CONFIG)
        sync(CONFIG.parent)
        command(['/usr/bin/python3', str(OPS / 'switch-supervisor.py'), candidate['bundle']['sha256']], 1250)
        write_once(self.stage / 'selected-inactive', b'')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--approved-candidate-sha256', required=True)
    parser.add_argument('--bundle', required=True, type=Path,
                        help='Privately staged exact bundle; acquisition is a separate approved operation')
    args = parser.parse_args()
    if os.getuid() != 0:
        raise ReleaseRefused('Trusted root operator command required')
    for script in (Path(__file__).resolve(), OPS / 'release/release.py', OPS / 'install-supervisor.py', OPS / 'switch-supervisor.py'):
        for path in [script, *script.parents]:
            info = path.stat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                raise ReleaseRefused('Release tools and parent directories must be root-owned and non-writable')
    policy = json.loads(read_private(Path('/etc/forge-studio/release-policy.json')), object_pairs_hook=unique_object)
    raw = read_private(args.candidate)
    # Reject before creating state or starting any registry/process operation.
    from release import verify_candidate, exact_keys
    exact_keys(policy, ['version', 'enabled', 'target'])
    if type(policy['version']) is not int or policy['version'] != 1 or policy['enabled'] is not True:
        raise ReleaseRefused('Host release policy is disabled')
    verify_candidate(raw, args.approved_candidate_sha256, policy['target'])
    # The bundle must already match before any registry pull, too.
    candidate = json.loads(raw, object_pairs_hook=unique_object)
    bundle = read_private(args.bundle, 150000000)
    if len(bundle) != candidate['bundle']['size'] or hashlib.sha256(bundle).hexdigest() != candidate['bundle']['sha256']:
        raise ReleaseRefused('Selected bundle bytes differ')
    with (STATE / 'release.lock').open('a+b') as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        releases = STATE / 'selected-releases'
        releases.mkdir(mode=0o700, exist_ok=True)
        sync(STATE)
        pending = STATE / 'release-pending'
        if pending.exists() or pending.is_symlink():
            raise ReleaseRefused('Unresolved rollout preserved; trusted reconciliation required')
        stage = releases / uuid.uuid4().hex
        stage.mkdir(mode=0o700)
        sync(releases)
        write_once(stage / 'candidate.json', raw)
        write_once(pending, (stage.name + '\n').encode())
        apply_selected(raw, args.approved_candidate_sha256, policy, LocalHost(stage, args.bundle))
        pending.unlink()
        sync(STATE)
    print('Selected approved release; drained and inactive. Activation remains separate.')


if __name__ == '__main__':
    try:
        main()
    except (ReleaseRefused, OSError, ValueError) as error:
        print('Release refused; preserved state requires trusted inspection.', file=sys.stderr)
        raise SystemExit(1) from error
