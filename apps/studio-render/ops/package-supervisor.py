#!/usr/bin/env python3
"""Make a local host-only bundle. Supply reviewed Node and native watchdog bytes.
Does not pull images, publish artifacts, access credentials or activate a service.
"""
import argparse
import hashlib
import io
from pathlib import Path
import tarfile

parser = argparse.ArgumentParser()
for name in ('node', 'watchdog', 'output'):
    parser.add_argument('--' + name, required=True, type=Path)
args = parser.parse_args()
source = Path(__file__).resolve().parents[1]
files = {'node': args.node, 'vm-watchdog': args.watchdog,
         'supervisor.service': source / 'ops/forge-studio-supervisor.service'}
files.update({'vm/' + path.name: path for path in sorted((source / 'src/vm').glob('*.mjs'))})
manifest = ''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + name + '\n' for name, path in sorted(files.items()))
with tarfile.open(args.output, 'w') as archive:
    for name, path in sorted(files.items()):
        data = path.read_bytes()
        info = tarfile.TarInfo(name)
        info.size, info.mode = len(data), 0o500 if name in ('node', 'vm-watchdog') else 0o400
        archive.addfile(info, io.BytesIO(data))
    data = manifest.encode()
    info = tarfile.TarInfo('SHA256SUMS')
    info.size, info.mode = len(data), 0o400
    archive.addfile(info, io.BytesIO(data))
print(hashlib.sha256(args.output.read_bytes()).hexdigest())
