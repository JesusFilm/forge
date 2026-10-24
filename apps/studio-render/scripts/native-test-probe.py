"""Fixed CI fixture only. All paths are inside Bubblewrap's private root."""
import ctypes
import errno
import json
import os
import subprocess
import sys


def snapshot():
    with open('/proc/self/status', encoding='utf8') as source:
        status = dict(line.rstrip().split(':', 1) for line in source if ':' in line)
    with open('/proc/self/attr/current', encoding='utf8') as source:
        label = source.read().strip()
    with open('/proc/net/dev', encoding='utf8') as source:
        interfaces = sorted(line.split(':')[0].strip() for line in source if ':' in line)
    return dict(pid=os.getpid(), net=os.readlink('/proc/self/ns/net'), interfaces=interfaces,
                label=label, effective=status['CapEff'].strip(),
                permitted=status['CapPrm'].strip(), ambient=status['CapAmb'].strip())


report = snapshot()
if sys.argv[1] == 'normal':
    report['alternates'] = [json.loads(subprocess.check_output(command, timeout=2)) for command in [
        [sys.executable, __file__, 'snapshot'],
        ['/usr/bin/env', sys.executable, __file__, 'snapshot'],
    ]]
    report['escape'] = subprocess.run(['/usr/bin/unshare', '-Urn', '/usr/bin/true'],
                                     capture_output=True, timeout=2).returncode
elif sys.argv[1] == 'capability-denial':
    # This path exists only in the freshly mounted private root (--dir /probe).
    # No host directory is bound here. A successful mount is a failed test;
    # namespace teardown discards it even if the denial assertion fails.
    libc = ctypes.CDLL(None, use_errno=True)
    result = libc.mount(b'tmpfs', b'/probe', b'tmpfs', 0, b'size=4096')
    report['mountErrno'] = ctypes.get_errno() if result == -1 else 0
    report['expectedDenial'] = errno.EPERM
print(json.dumps(report))
