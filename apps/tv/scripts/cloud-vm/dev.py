#!/usr/bin/env python3
"""One entry point for native, VM and GitHub-queued tvOS builds."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
import uuid
from evidence import REPORT_PREFIX, validate_report

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parents[1]
CONFIG = ROOT / '.dev.local.json'
MODES = ('auto', 'local', 'cloud')

def run(args, **kwargs):
    kwargs.setdefault('capture_output', True)
    return subprocess.run([str(x) for x in args], cwd=ROOT, check=True, **kwargs)

def capture(args):
    return run(args, capture_output=True, text=True).stdout.strip()

def save_diagnostics(error):
    directory = ROOT / '.build-results' / 'diagnostics'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / (uuid.uuid4().hex + '.log')
    with path.open('xb') as output:
        for part in (error.stdout, error.stderr):
            if part:
                output.write(part.encode() if isinstance(part, str) else part)
    path.chmod(0o600)
    return path

def config():
    public = json.loads((ROOT / 'dev.project.json').read_text())
    local = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    return {**public, **local}

def executable(name):
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f'Install {name} and put it on PATH.')
    return found


def git():
    return executable('git')


def route(cfg, override=None):
    mode = override or os.environ.get('HYBRID_BUILDER') or cfg.get('builder', 'auto')
    if mode not in MODES:
        raise RuntimeError(f'Unknown builder: {mode}')
    if mode == 'auto':
        if platform.system() != 'Darwin':
            return 'cloud'
        return 'local'
    return mode

def source_identity():
    sha = capture([git(), 'rev-parse', 'HEAD'])
    dirty = bool(capture([git(), 'status', '--porcelain']))
    return sha, dirty


def require_clean_source(expected=None):
    sha, dirty = source_identity()
    if dirty or (expected and sha != expected):
        raise RuntimeError('Expected an unchanged, clean, committed checkout.')
    return sha


def logged(args, log, cwd=ROOT, env=None):
    # Keep subprocess diagnostics in private files; dependency tools can emit URLs.
    with log.open('w') as output:
        process = subprocess.Popen([str(x) for x in args], cwd=cwd, env=env,
                                   stdout=output, stderr=subprocess.STDOUT)
        try:
            return process.wait()
        except BaseException:
            process.terminate()
            process.wait()
            raise


def bootstrap(output):
    executable('corepack')
    executable('pod')
    major = capture(['node', '-p', 'process.versions.node.split(".")[0]'])
    if major != '24':
        raise RuntimeError('Select Node 24 before building Forge TV.')
    if capture(['corepack', 'pnpm', '--version']) != '9.12.3':
        raise RuntimeError('Expected the repository-pinned pnpm 9.12.3.')
    env = dict(os.environ, EXPO_TV='1',
               REACT_NATIVE_OVERRIDE_NIGHTLY_BUILD_VERSION='0.81.5')
    # Corepack shims ensure nested pnpm calls use the same pinned package manager.
    bin_dir = output / 'bin'
    bin_dir.mkdir()
    run(['corepack', 'enable', '--install-directory', bin_dir], capture_output=True)
    env['PATH'] = str(bin_dir) + os.pathsep + env['PATH']
    commands = [
        (['corepack', 'pnpm', '--filter', 'forge', '--filter', '@forge/tv...',
          'install', '--frozen-lockfile', '--child-concurrency=2'], REPO, 'install.log'),
        (['corepack', 'pnpm', 'exec', 'expo', 'prebuild', '--platform', 'ios',
          '--no-install', '--skip-dependency-update', 'react-native,react'],
         ROOT, 'prebuild.log'),
        (['pod', 'install'], ROOT / 'ios', 'pods.log'),
    ]
    for command, cwd, filename in commands:
        code = logged(command, output / filename, cwd=cwd, env=env)
        if code:
            raise RuntimeError(f'{filename} failed (exit {code}); inspect the private VM log.')
    return env


def tvos_destination(devices):
    available = [d for runtime, rows in devices.items() if '.tvOS-' in runtime
                 for d in rows if d.get('isAvailable') and d['name'].startswith('Apple TV')]
    if not available:
        raise RuntimeError('Install a tvOS simulator runtime and create an Apple TV in Xcode.')
    return 'platform=tvOS Simulator,id=' + available[0]['udid']


def native_command(cfg, xcodebuild, output, destination):
    return [str(xcodebuild), '-workspace', cfg['workspace'], '-scheme', cfg['scheme'],
            '-configuration', 'Release', '-destination', destination,
            '-derivedDataPath', str(ROOT / '.build-results/DerivedData'),
            '-resultBundlePath', str(output / 'Results.xcresult'),
            'CODE_SIGNING_ALLOWED=NO', 'build']


def native(action):
    cfg = config()
    if platform.system() != 'Darwin':
        raise RuntimeError('Native Apple TV builds require macOS. Use cloud mode here.')
    sha = require_clean_source(os.environ.get('TV_BUILD_COMMIT'))
    developer_path = os.environ.get('DEVELOPER_DIR') or capture(['xcode-select', '-p'])
    xcodebuild = Path(developer_path) / 'usr/bin/xcodebuild'
    if not xcodebuild.is_file():
        raise RuntimeError('Select full Xcode, not just Command Line Tools.')
    lockdir = Path.home() / 'Library/Caches/HybridBuilder'
    lockdir.mkdir(parents=True, exist_ok=True)
    with (lockdir / 'build.lock').open('a') as lock:
        print('Waiting for the shared Apple builder lock…', flush=True)
        deadline = time.monotonic() + 1800
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise RuntimeError('Builder remained busy for 30 minutes.')
                time.sleep(2)
        build_id = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
        output = ROOT / '.build-results' / build_id
        output.mkdir(parents=True, mode=0o700)
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as step_output:
                step_output.write(f'results={output.relative_to(REPO)}\n')
        metadata = {'commit': sha, 'dirty': False, 'action': action, 'platform': 'tvos',
                    'host': platform.node(), 'xcode': capture([xcodebuild, '-version']),
                    'exit_code': 1}
        code = 1
        try:
            devices = json.loads(capture(['xcrun', 'simctl', 'list', 'devices',
                                          'available', '-j']))['devices']
            destination = tvos_destination(devices)
            env = bootstrap(output)
            require_clean_source(sha)
            if action == 'test':
                code = logged(['corepack', 'pnpm', 'exec', 'jest', '--ci',
                               '--maxWorkers=2', '--json',
                               '--outputFile=' + str(output / 'jest-results.json')],
                              output / 'jest.log', env=env)
                if code:
                    return code
                # Reject Jest's --passWithNoTests and any missing/failed result.
                from evidence import jest_counts
                jest_counts(output / 'jest-results.json')
            cmd = native_command(cfg, xcodebuild, output, destination)
            print(f'Building TV commit {sha}; logs: {output}', flush=True)
            code = logged(['/usr/bin/caffeinate', '-i', *cmd], output / 'build.log', env=env)
            if code == 0:
                require_clean_source(sha)
                app = ROOT / '.build-results/DerivedData/Build/Products/Release-appletvsimulator' / (cfg['app_name'] + '.app')
                if not app.is_dir():
                    raise RuntimeError('Xcode did not produce the expected tvOS simulator app.')
                archive = output / (cfg['app_name'] + '-simulator.zip')
                run(['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent',
                     app, archive], capture_output=True)
                metadata['simulator_app'] = archive.name
            return code
        except BaseException:
            code = 1
            raise
        finally:
            current_sha, dirty = source_identity()
            metadata.update(exit_code=code, dirty=dirty or current_sha != sha)
            (output / 'summary.json').write_text(json.dumps(metadata, indent=2) + '\n')


def cloud_report(gh, repo, run_id, sha, action, cfg):
    jobs = json.loads(capture([gh, 'api',
                              f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100']))['jobs']
    reports = []
    for job in jobs:
        if job.get('name') != 'tvos' or job.get('conclusion') != 'success':
            continue
        labels = {'self-hosted', 'macOS', cfg['runner_arch'], cfg['runner_label']}
        if not labels.issubset(set(job.get('labels', []))):
            raise RuntimeError('VM runner labels do not match the TV project configuration.')
        uploaded = False
        for step in job.get('steps', []):
            if step.get('name') == 'Upload build evidence' and step.get('conclusion') == 'success':
                uploaded = True
            if step.get('conclusion') == 'success' and step['name'].startswith(REPORT_PREFIX):
                if not uploaded:
                    raise RuntimeError('VM evidence was published without successful artifact upload.')
                report = validate_report(json.loads(step['name'][len(REPORT_PREFIX):]), sha, action)
                reports.append((report, job.get('runner_name')))
    if len(reports) != 1 or not reports[0][1]:
        raise RuntimeError('Expected one successful VM evidence report with a runner name. '
                           'Check the workflow version and run details on GitHub.')
    return reports[0]


def cloud_build(action, cfg, wait_seconds, download_artifacts=False):
    gh = executable('gh')
    sha, dirty = source_identity()
    if dirty or sha == 'uncommitted':
        raise RuntimeError('Cloud builds require committed changes. Commit and push your branch first.')
    repo = cfg.get('repository') or capture([gh, 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    if '/' not in repo or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._/' for c in repo):
        raise RuntimeError('Invalid repository name.')
    # Confirms the exact local commit is available remotely before dispatch.
    remote_sha = capture([gh, 'api', f'repos/{repo}/commits/{sha}', '--jq', '.sha'])
    if remote_sha != sha:
        raise RuntimeError('Push this commit before requesting a cloud build.')
    request = uuid.uuid4().hex
    # Dispatch this branch's workflow so its verifier matches the tested source.
    ref = capture([git(), 'branch', '--show-current'])
    if not ref:
        raise RuntimeError('Cloud builds require a pushed branch checkout, not a detached HEAD.')
    branch_sha = capture([gh, 'api', f'repos/{repo}/commits/{ref}', '--jq', '.sha'])
    if branch_sha != sha:
        raise RuntimeError('Push this branch before requesting a cloud build.')
    run([gh, 'workflow', 'run', 'tvos-vm-build.yml', '--repo', repo, '--ref', ref,
         '-f', f'commit={sha}', '-f', f'action={action}', '-f', f'request_id={request}'])
    pending = ROOT / '.build-results' / ('request-' + request + '.json')
    pending.parent.mkdir(parents=True, exist_ok=True)
    request_info = {'request_id': request, 'commit': sha, 'action': action,
                    'branch': ref, 'repository': repo, 'run_id': None, 'status': 'pending'}
    pending.write_text(json.dumps(request_info, indent=2) + '\n')
    print(f'Build requested: {request} | commit: {sha}', flush=True)
    deadline = time.monotonic() + wait_seconds
    run_id = None
    last_status = None
    while time.monotonic() < deadline:
        jobs = json.loads(capture([gh, 'run', 'list', '--repo', repo, '--workflow', 'tvos-vm-build.yml',
                                  '--limit', '100', '--json', 'databaseId,displayTitle,status,conclusion,url']))
        job = next((j for j in jobs if j['displayTitle'] == f'tvos-{request}'), None)
        if job:
            run_id = str(job['databaseId'])
            request_info.update(run_id=run_id, status=job['status'], conclusion=job.get('conclusion'))
            pending.write_text(json.dumps(request_info, indent=2) + '\n')
            if job['status'] != last_status:
                print(f"{job['status']}: {job['url']}", flush=True)
                last_status = job['status']
            if job['status'] == 'completed':
                if job['conclusion'] != 'success':
                    print(f'Cloud build: {job["conclusion"]}; inspect {job["url"]}')
                    return 1
                report, runner = cloud_report(gh, repo, run_id, sha, action, cfg)
                results = ROOT / '.build-results' / ('cloud-' + run_id)
                results.mkdir(parents=True, exist_ok=True)
                report.update(runner=runner, workflow_url=job['url'], evidence_source='vm')
                report_path = results / 'verification.json'
                report_path.write_text(json.dumps(report, indent=2) + '\n')
                print(f'VM verified commit {sha} on {runner}; report: {report_path}')
                if action == 'test':
                    print(f'Tests: {report["tests"]}; failures: {report["failures"]}')
                print(f'App and full evidence: {job["url"]} (Artifacts)')
                if download_artifacts:
                    # gh errors may contain signed storage URLs. Never echo them.
                    downloaded = subprocess.run(
                        [gh, 'run', 'download', run_id, '--repo', repo, '--dir', str(results / 'artifacts')],
                        cwd=ROOT, capture_output=True, text=True)
                    if downloaded.returncode:
                        print('VM verification passed, but the requested artifact download failed. '
                              'Download from the workflow page.', file=sys.stderr)
                        return downloaded.returncode
                    print(f'Artifacts downloaded: {results / "artifacts"}')
                print('Cloud build: success (evidence verified on VM)')
                return 0
        time.sleep(5)
    print(f'Build is still pending. Request: {request}; run: {run_id or "not yet listed"}.')
    print('No completed verification yet. Inspect this request before dispatching another build.')
    return 75

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['build', 'test', 'builder', 'doctor'])
    p.add_argument('value', nargs='?')
    p.add_argument('--builder', choices=MODES)
    p.add_argument('--wait', type=int, default=600)
    p.add_argument('--download-artifacts', action='store_true',
                   help='Also download cloud artifacts; download failures return nonzero.')
    args = p.parse_args()
    cfg = config()
    if args.command == 'builder':
        if args.value:
            if args.value not in MODES:
                p.error('builder must be auto, local, or cloud')
            local = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
            local['builder'] = args.value
            CONFIG.write_text(json.dumps(local, indent=2) + '\n')
            cfg['builder'] = args.value
        print(f'Selected: {cfg.get("builder", "auto")}; resolves to: {route(cfg)}')
        return 0
    mode = route(cfg, args.builder)
    if args.command == 'doctor':
        print(json.dumps({'system': platform.system(), 'builder': mode,
                          'runner_labels': ['self-hosted', 'macOS', cfg['runner_arch'], cfg['runner_label']],
                          'runner_access': 'unverified; doctor does not contact the VM',
                          'project': str(ROOT)}, indent=2))
        if mode == 'local':
            return subprocess.call(['xcode-select', '-p'])
        return 0
    if args.value != 'tvos':
        p.error('This helper supports tvos. Example: ./apps/tv/dev build tvos')
    print(f'Routing {args.command} tvos to {mode}', flush=True)
    if mode == 'local':
        return native(args.command)
    return cloud_build(args.command, cfg, args.wait, args.download_artifacts)

if __name__ == '__main__':
    os.umask(0o077)
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as e:
        diagnostic = save_diagnostics(e)
        print(f'Build setup: subprocess failed (exit {e.returncode}); private log: {diagnostic}', file=sys.stderr)
        sys.exit(1)
    except (RuntimeError, OSError) as e:
        print(f'Build setup: {e}', file=sys.stderr)
        sys.exit(1)

