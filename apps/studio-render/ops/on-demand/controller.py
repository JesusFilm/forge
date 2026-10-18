#!/usr/bin/env python3
"""Trusted single-VM power controller. Canonical leases remain inside the worker."""
import fcntl
import json
import os
import stat
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

VM = 'forge-render-ai01'
HERE = Path(__file__).resolve().parent


class Refused(Exception):
    pass


def unique_object(pairs):
    value = {}
    for k, v in pairs:
        if k in value:
            raise Refused('Duplicate field')
        value[k] = v
    return value


def private_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_uid != os.getuid() or s.st_mode & 0o077 or not 0 < s.st_size <= 8192:
            raise Refused('Private configuration required')
        with os.fdopen(os.dup(fd)) as f:
            return json.load(f, object_pairs_hook=unique_object)
    finally:
        os.close(fd)


def config(path):
    c = private_json(path)
    if set(c) != {'version', 'endpoint', 'key', 'poolId', 'workerId', 'profileId', 'idleSeconds', 'pollSeconds'}:
        raise Refused('Configuration fields refused')
    if type(c['version']) is not int or c['version'] != 1:
        raise Refused('Configuration version refused')
    if c['endpoint'] != 'https://manager.jesusfilm.org/api/shorts/render-demand':
        raise Refused('Fixed production demand endpoint required')
    if not isinstance(c['key'], str) or not 32 <= len(c['key']) <= 4096 or any(not 33 <= ord(x) <= 126 for x in c['key']):
        raise Refused('Demand key refused')
    for field in ['poolId', 'workerId', 'profileId']:
        if not isinstance(c[field], str) or not 1 <= len(c[field]) <= 256:
            raise Refused('Configured identity refused')
    if type(c['idleSeconds']) is not int or not 600 <= c['idleSeconds'] <= 86400:
        raise Refused('Idle interval refused')
    if type(c['pollSeconds']) is not int or not 5 <= c['pollSeconds'] <= 60:
        raise Refused('Polling interval refused')
    return c


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Refused('Redirect refused')


class Demand:
    def __init__(self, c):
        self.c = c
        self.opener = urllib.request.build_opener(NoRedirect)

    def read(self):
        req = urllib.request.Request(self.c['endpoint'], headers={
            'Authorization': 'Bearer ' + self.c['key'], 'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'User-Agent': 'Forge-Studio-OnDemand/1',
        })
        with self.opener.open(req, timeout=8) as response:
            if response.status != 200:
                raise Refused('Demand unconfirmed')
            raw = response.read(4097)
        if len(raw) > 4096:
            raise Refused('Demand response too large')
        o = json.loads(raw, object_pairs_hook=unique_object)
        if set(o) != {'version', 'poolId', 'workerId', 'profileId', 'enabled', 'hasPending'}:
            raise Refused('Demand shape refused')
        if type(o['version']) is not int or o['version'] != 1:
            raise Refused('Demand version refused')
        if any(o[k] != self.c[k] for k in ['poolId', 'workerId', 'profileId']):
            raise Refused('Demand identity refused')
        if any(type(o[k]) is not bool for k in ['enabled', 'hasPending']) or (o['hasPending'] and not o['enabled']):
            raise Refused('Demand state refused')
        return o['hasPending']


class Lxd:
    def run(self, args, data=None, timeout=15):
        # Explicit local/default project. No shell and no remote-controlled argv.
        return subprocess.run(['/snap/bin/lxc', '--force-local', '--project', 'default', *args],
                              input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              check=True, timeout=timeout).stdout

    def state(self):
        rows = json.loads(self.run(['list', VM, '--format=json']))
        if len(rows) != 1 or rows[0]['name'] != VM or rows[0]['type'] != 'virtual-machine':
            raise Refused('Fixed VM identity unconfirmed')
        state = rows[0]['status'].upper()
        if state not in ['RUNNING', 'STOPPED']:
            raise Refused('VM transition unconfirmed')
        return state

    def start(self):
        self.run(['start', VM], timeout=60)

    def stop(self):
        # A timeout is an error, never permission to force the VM off.
        self.run(['stop', VM, '--timeout=30'], timeout=40)
        if self.state() != 'STOPPED':
            raise Refused('Graceful shutdown unconfirmed')

    def guest(self, action):
        if action not in ['probe', 'drain', 'wake']:
            raise Refused('Guest operation refused')
        raw = self.run(['exec', VM, '--mode=non-interactive', '--',
                        '/opt/forge-studio/current/node', '--input-type=module', '-', action],
                       (HERE / 'guest.mjs').read_bytes(), timeout=30)
        value = json.loads(raw)
        if set(value) != {'version', 'state'} or type(value['version']) is not int or value['version'] != 1 or value['state'] not in ['idle', 'working', 'busy', 'draining', 'safe', 'blocked']:
            raise Refused('Guest state unconfirmed')
        return value['state']


class Recovery:
    def __init__(self, path):
        self.path = path
        self.required = False
        if path.exists():
            o = private_json(path)
            if set(o) != {'version', 'required'} or type(o['version']) is not int or o['version'] != 1 or type(o['required']) is not bool:
                raise Refused('Recovery record refused')
            self.required = o['required']

    def set(self, value):
        p = self.path.with_suffix('.pending')
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({'version': 1, 'required': value}, f); f.flush(); os.fsync(f.fileno())
        os.replace(p, self.path)
        fd = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
        self.required = value


class Controller:
    def __init__(self, vm, demand, recovery, idle_seconds, clock=time.monotonic):
        self.vm, self.demand, self.recovery = vm, demand, recovery
        self.idle_seconds, self.clock = idle_seconds, clock
        self.idle_since = None
        self.waking = False

    def tick(self):
        try:
            # Read errors must not become empty-queue or shutdown authority.
            state = self.vm.state()
            if state == 'STOPPED' and self.recovery.required:
                self.vm.start()
                self.waking = True
                return 'recovering'
            if state == 'RUNNING' and not self.recovery.required:
                self.recovery.set(True)
            pending = self.demand.read()
            if state == 'STOPPED':
                self.idle_since = None
                if pending or self.recovery.required:
                    self.recovery.set(True)  # Durable before starting execution.
                    self.vm.start()
                    self.waking = True
                    return 'starting'
                return 'stopped'
            guest = self.vm.guest('probe')
            if guest == 'blocked':
                self.idle_since = None
                return 'blocked'
            if pending or self.waking:
                guest = self.vm.guest('wake')
                self.waking = guest not in ['idle', 'working']
                self.idle_since = None
                return 'ready' if guest == 'idle' else 'working'
            if guest in ['busy', 'working']:
                self.idle_since = None
                return guest
            if guest == 'idle':
                now = self.clock()
                if self.idle_since is None:
                    self.idle_since = now
                if now - self.idle_since < self.idle_seconds:
                    return 'idle'
                guest = self.vm.guest('drain')
            if guest == 'draining':
                return 'draining'
            if guest != 'safe':
                raise Refused('Retirement unconfirmed')
            if self.demand.read():  # Jobs in the drain race win over shutdown.
                self.vm.guest('wake')
                self.idle_since = None
                return 'working'
            self.vm.stop()
            self.recovery.set(False)  # Clear only after proven graceful shutdown.
            self.idle_since = None
            return 'stopped'
        except Exception:
            self.idle_since = None
            raise


def main():
    c = config(sys.argv[1])
    state = Path.home() / '.local/state/forge-studio-on-demand'
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (state / 'controller.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        controller = Controller(Lxd(), Demand(c), Recovery(state / 'recovery.json'), c['idleSeconds'])
        last = None
        healthy = False
        while True:
            try:
                current = controller.tick()
                if not healthy and current in ['idle', 'ready', 'working', 'stopped']:
                    health = state / 'healthy.pending'
                    health.write_text(json.dumps({'version': 1, 'pid': os.getpid(), 'at': time.time()}))
                    health.chmod(0o600)
                    os.replace(health, state / 'healthy.json')
                    healthy = True
            except Exception as error:
                reason = str(error) if isinstance(error, Refused) else type(error).__name__
                current = 'unconfirmed:' + reason
            if current != last:
                print(json.dumps({'version': 1, 'state': current, 'at': time.time()}), flush=True)
                last = current
            time.sleep(c['pollSeconds'])


if __name__ == '__main__':
    main()
