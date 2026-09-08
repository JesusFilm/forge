#!/usr/bin/env python3
"""Hosted release commands. Source preparation does not authorize invoking publish."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

from artifacts import ORAS_SHA256, fetch_payload, oras, verify_oci_archive, unpack_candidate
from github import GitHub, authorize_publication
from release import (ARCHIVE_SHA256, FFMPEG_SHA256, FFPROBE_SHA256, PROFILE,
                     ReleaseRefused, artifact, exact_keys, matches, unique_object,
                     verify_candidate, verify_environment)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ORAS_ARCHIVE_SHA256 = '6cdc692f929100feb08aa8de584d02f7bcc30ec7d88bc2adc2054d782db57c64'


def workspace():
    base = Path(os.environ['RUNNER_TEMP']).resolve()
    root = base / 'studio-release'
    root.mkdir(mode=0o700, exist_ok=True)
    return root


def context():
    if os.environ.get('GITHUB_REPOSITORY') != 'JesusFilm/forge' or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise ReleaseRefused('Owned main workflow required')
    commit, run, attempt = (os.environ.get(key, '') for key in ('GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
    if not matches(commit, '[a-f0-9]{40}') or not matches(run, '[1-9][0-9]{0,19}') or not matches(attempt, '[1-9][0-9]?|100'):
        raise ReleaseRefused('Workflow context refused')
    return commit, run, int(attempt)


def configuration():
    value = json.loads((HERE / 'config.json').read_bytes(), object_pairs_hook=unique_object)
    exact_keys(value, ['version', 'enabled', 'target', 'codecArtifact', 'environmentId', 'reviewerIds'])
    if type(value['version']) is not int or value['version'] != 1 or value['enabled'] is not True:
        raise ReleaseRefused('Hosted release configuration is disabled')
    artifact(value['codecArtifact'], 'codec')
    if not matches(value['target'], '[a-z][a-z0-9-]{2,63}'):
        raise ReleaseRefused('Configured target required')
    return value


def approval_policy(config):
    return {key: config[key] for key in ('environmentId', 'reviewerIds')}


def run(argv, *, cwd=None, timeout=120, input=None, quiet=False):
    env = {key: os.environ[key] for key in ('PATH', 'LANG', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT') if key in os.environ}
    env['DOCKER_CONFIG'] = str(workspace() / 'docker-public')
    Path(env['DOCKER_CONFIG']).mkdir(mode=0o700, exist_ok=True)
    try:
        subprocess.run(argv, check=True, timeout=timeout, cwd=cwd, env=env, input=input,
                       stdout=subprocess.DEVNULL if quiet else None,
                       stderr=subprocess.DEVNULL if quiet else None)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise ReleaseRefused('Release command failed; no successful publication inferred') from error


def tool():
    path = workspace() / 'tools/oras'
    if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != ORAS_SHA256:
        raise ReleaseRefused('Exact ORAS tool is unavailable')
    return str(path)


def install_tools():
    directory = workspace() / 'tools'
    directory.mkdir(mode=0o700, exist_ok=True)
    archive = directory / 'oras.tar.gz'
    run(['/usr/bin/curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https',
         '--proto-redir', '=https', '--max-time', '30', '--max-filesize', '20000000',
         'https://github.com/oras-project/oras/releases/download/v1.3.0/oras_1.3.0_linux_amd64.tar.gz',
         '--output', str(archive)], timeout=35)
    raw = archive.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ORAS_ARCHIVE_SHA256:
        raise ReleaseRefused('ORAS archive checksum differs')
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as bundle:
        entry = bundle.getmember('oras')
        if not entry.isfile() or entry.size > 50000000:
            raise ReleaseRefused('ORAS executable layout refused')
        binary = bundle.extractfile(entry).read()
    if hashlib.sha256(binary).hexdigest() != ORAS_SHA256:
        raise ReleaseRefused('ORAS executable checksum differs')
    executable = directory / 'oras'
    executable.write_bytes(binary)
    executable.chmod(0o700)


def login():
    actor, token = os.environ.get('GITHUB_ACTOR', ''), os.environ.get('GH_TOKEN', '')
    if not matches(actor, '[A-Za-z0-9_-]{1,100}') or not matches(token, '[A-Za-z0-9_]{10,1024}'):
        raise ReleaseRefused('Scoped registry identity required')
    path = workspace() / 'registry.json'
    run([tool(), 'login', 'ghcr.io', '--registry-config', str(path), '--username', actor, '--password-stdin'],
        input=token.encode(), quiet=True)
    path.chmod(0o600)
    return path


def preflight():
    context()
    config = configuration()
    verify_environment(approval_policy(config), GitHub(os.environ['GH_TOKEN']).get('environments/studio-release'))


def codec():
    context()
    config = configuration()
    registry = login()
    directory = workspace() / 'codec'
    directory.mkdir(mode=0o700)
    try:
        fetch_payload(config['codecArtifact'], ARCHIVE_SHA256, 500000000, 'codec.tar.xz', directory,
                      lambda args, output, maximum: oras(args, output, maximum, tool=tool(), registry_config=registry))
    finally:
        registry.unlink(missing_ok=True)


def pack_layout(directory, output):
    with tarfile.open(output, 'w') as archive:
        for path in sorted(directory.rglob('*')):
            if path.is_symlink():
                raise ReleaseRefused('Unexpected OCI layout symlink')
            if path.is_file():
                archive.add(path, arcname=path.relative_to(directory).as_posix(), recursive=False)


def build():
    commit, run_id, attempt = context()
    config = configuration()
    codec_dir = workspace() / 'codec'
    if hashlib.sha256((codec_dir / 'codec.tar.xz').read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ReleaseRefused('Exact retained codec required before build')
    directory = workspace() / 'candidate'
    directory.mkdir(mode=0o700)
    images = {}
    for role in ('render', 'verify'):
        path = directory / (role + '.oci.tar')
        run(['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--provenance=false', '--sbom=false',
             '--file', 'apps/studio-render/Dockerfile', '--target', role + '-job',
             '--build-context', 'studio_codec=' + str(codec_dir),
             '--output', 'type=oci,dest=' + str(path), '.'], cwd=ROOT, timeout=1800)
        images[role] = 'ghcr.io/jesusfilm/forge-studio-' + role + '@' + verify_oci_archive(path, None, image=True)
    bundle_dir = workspace() / 'host-export'
    run(['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--provenance=false', '--sbom=false',
         '--file', 'apps/studio-render/Dockerfile', '--target', 'host-bundle',
         '--output', 'type=local,dest=' + str(bundle_dir), '.'], cwd=ROOT, timeout=600)
    bundle = bundle_dir / 'supervisor.tar'
    if bundle.stat().st_size > 150000000:
        raise ReleaseRefused('Host bundle exceeds installation bound')
    layout = workspace() / 'host-layout'
    run([tool(), 'push', '--oci-layout', str(layout) + ':candidate', '--artifact-type',
         'application/vnd.jesusfilm.studio.host.v1', 'supervisor.tar:application/x-tar'], cwd=bundle_dir)
    host_archive = directory / 'host.oci.tar'
    pack_layout(layout, host_archive)
    host_digest = verify_oci_archive(host_archive, None, image=False)
    value = {'version': 1, 'target': config['target'], 'repository': 'JesusFilm/forge',
             'source': {'commit': commit, 'ref': 'refs/heads/main'},
             'build': {'workflow': '.github/workflows/studio-release.yml', 'runId': run_id, 'runAttempt': attempt},
             'platform': 'linux/amd64', 'profile': PROFILE,
             'codec': {'artifact': config['codecArtifact'], 'archiveSha256': ARCHIVE_SHA256,
                       'ffmpegSha256': FFMPEG_SHA256, 'ffprobeSha256': FFPROBE_SHA256},
             'images': images, 'bundle': {'artifact': 'ghcr.io/jesusfilm/forge-studio-host@' + host_digest,
                                        'sha256': hashlib.sha256(bundle.read_bytes()).hexdigest(), 'size': bundle.stat().st_size}}
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    digest = hashlib.sha256(raw).hexdigest()
    verify_candidate(raw, digest, config['target'])  # Shape check; not a human approval.
    (directory / 'candidate.json').write_bytes(raw)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('sha256=' + digest + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
        output.write('Candidate SHA256: `' + digest + '`\n\nRequired review comment: `studio-candidate-sha256:' + digest + '`\n\nPublication does not activate the VM.\n')


def download():
    context()
    config = configuration()
    path = workspace() / 'candidate.zip'
    GitHub(os.environ['GH_TOKEN']).download_artifact(os.environ['STUDIO_CANDIDATE_ARTIFACT_ID'], path)
    unpack_candidate(path, workspace() / 'download', os.environ['STUDIO_CANDIDATE_SHA256'], config['target'])


def publish():
    commit, run_id, attempt = context()
    config = configuration()
    directory = workspace() / 'download'
    expected_files = {'candidate.json', 'render.oci.tar', 'verify.oci.tar', 'host.oci.tar'}
    if {path.name for path in directory.iterdir()} != expected_files or any(not p.is_file() or p.is_symlink() for p in directory.iterdir()):
        raise ReleaseRefused('Unexpected candidate artifact layout')
    with (directory / 'candidate.json').open('rb') as source:
        raw = source.read(65537)
    digest = os.environ['STUDIO_CANDIDATE_SHA256']
    candidate = verify_candidate(raw, digest, config['target'])
    if (candidate['source']['commit'], candidate['build']['runId'], candidate['build']['runAttempt'], candidate['codec']['artifact']) != (commit, run_id, attempt, config['codecArtifact']):
        raise ReleaseRefused('Candidate differs from this configured workflow')
    # GitHub-authenticated approval is separate from any downloaded JSON claims.
    authorize_publication(GitHub(os.environ['GH_TOKEN']), candidate, digest, approval_policy(config))
    for role in ('render', 'verify', 'host'):
        ref = candidate['bundle']['artifact'] if role == 'host' else candidate['images'][role]
        verify_oci_archive(directory / (role + '.oci.tar'), ref.split('@')[1], image=role != 'host',
                           payload=candidate['bundle'] if role == 'host' else None)
    registry = login()
    tag = 'candidate-' + run_id + '-' + str(attempt)
    try:
        for role in ('render', 'verify', 'host'):
            ref = candidate['bundle']['artifact'] if role == 'host' else candidate['images'][role]
            run([tool(), 'cp', '--from-oci-layout', str(directory / (role + '.oci.tar')) + '@' + ref.split('@')[1],
                 '--to-registry-config', str(registry), ref.split('@')[0] + ':' + tag], timeout=300)
        # Record publication is last. A partial copy has no successful release record.
        run([tool(), 'push', '--registry-config', str(registry), '--artifact-type',
             'application/vnd.jesusfilm.studio.release.v1', '--export-manifest', str(workspace() / 'release-manifest.json'),
             'ghcr.io/jesusfilm/forge-studio-releases:' + tag,
             'candidate.json:application/vnd.jesusfilm.studio.release.v1+json'], cwd=directory)
        record_digest = hashlib.sha256((workspace() / 'release-manifest.json').read_bytes()).hexdigest()
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write('Published inert candidate: `ghcr.io/jesusfilm/forge-studio-releases@sha256:' + record_digest + '`\n\nCandidate SHA256: `' + digest + '`\n\nVM selection/activation remains a separate approved host operation.\n')
    finally:
        registry.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'tools', 'codec', 'build', 'download', 'publish'])
    command = parser.parse_args().command
    {'preflight': preflight, 'tools': install_tools, 'codec': codec, 'build': build, 'download': download, 'publish': publish}[command]()


if __name__ == '__main__':
    try:
        main()
    except (ReleaseRefused, OSError, ValueError, KeyError) as error:
        print('Studio release refused: missing setup, mismatched evidence or failed bounded operation.', file=sys.stderr)
        raise SystemExit(1) from error
