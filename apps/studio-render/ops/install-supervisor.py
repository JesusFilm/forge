#!/usr/bin/env python3
"""Install a checksum-approved bundle without enabling dispatch or acquiring images."""
import argparse
import hashlib
import io
import os
from pathlib import Path
import re
import tarfile
import tempfile

def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def verified_archive(path, digest):
    # Hash and parse one bounded immutable snapshot, never reopen caller paths.
    with path.open('rb') as source:
        payload = source.read(150_000_001)
    if len(payload) > 150_000_000 or hashlib.sha256(payload).hexdigest() != digest:
        raise ValueError('Bundle checksum/size refused')
    return tarfile.open(fileobj=io.BytesIO(payload), mode='r:')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('sha256')
    args = parser.parse_args()
    if os.getuid() != 0 or not re.fullmatch('[a-f0-9]{64}', args.sha256):
        raise SystemExit('Root and an approved archive SHA256 are required')
    archive_input = verified_archive(args.archive, args.sha256)
    root = Path('/opt/forge-studio/releases')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    sync_directory(root.parent)
    sync_directory(root.parent.parent)
    release = root / args.sha256
    if release.exists():
        raise SystemExit('Release already exists; preserve and use the existing verified release')
    with archive_input as archive:
        entries = archive.getmembers()
        names = [entry.name for entry in entries]
        if len(entries) > 64 or len(set(names)) != len(names) or sum(entry.size for entry in entries) > 150_000_000:
            raise SystemExit('Bundle layout refused')
        for entry in entries:
            if not entry.isfile() or not re.fullmatch(r'(node|vm-watchdog|supervisor.service|SHA256SUMS|vm/[a-z-]+\.mjs)', entry.name):
                raise SystemExit('Bundle entry refused')
        required = {'node', 'vm-watchdog', 'supervisor.service', 'SHA256SUMS', 'vm/supervisor.mjs', 'vm/controller.mjs'}
        if not required.issubset(names):
            raise SystemExit('Incomplete bundle')
        manifest = archive.extractfile('SHA256SUMS').read().decode('ascii').splitlines()
        hashes = {}
        for line in manifest:
            if not re.fullmatch(r'[a-f0-9]{64}  [a-zA-Z0-9/.-]+', line):
                raise SystemExit('Manifest refused')
            digest, name = line.split('  ')
            if name in hashes:
                raise SystemExit('Duplicate manifest entry')
            hashes[name] = digest
        if set(hashes) != set(names) - {'SHA256SUMS'}:
            raise SystemExit('Manifest coverage refused')
        stage = Path(tempfile.mkdtemp(prefix='.install-', dir=root))
        # An interrupted or failed install remains preserved and is never activated.
        for entry in entries:
            data = archive.extractfile(entry).read()
            if entry.name != 'SHA256SUMS' and hashlib.sha256(data).hexdigest() != hashes[entry.name]:
                raise SystemExit('Bundle member checksum refused')
            target = stage / entry.name
            target.parent.mkdir(exist_ok=True, mode=0o700)
            with target.open('xb') as output:
                output.write(data)
                os.fchmod(output.fileno(), 0o500 if entry.name in ('node', 'vm-watchdog') else 0o400)
                output.flush()
                os.fsync(output.fileno())
        sync_directory(stage / 'vm')
        sync_directory(stage)
        os.rename(stage, release)
        sync_directory(root)
    for path in ('/etc/forge-studio', '/var/lib/forge-studio', '/var/lib/forge-studio/poll', '/var/lib/forge-studio/jobs', '/var/lib/forge-studio/docker-client', '/var/lib/forge-studio/tmp'):
        Path(path).mkdir(exist_ok=True, mode=0o700)
        sync_directory(Path(path).parent)
    print('Installed inactive release ' + args.sha256)


if __name__ == '__main__':
    main()
