import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ops/release'))
import ci
from release import ReleaseRefused
spec = importlib.util.spec_from_file_location('records', Path(__file__).with_name('release-record.test.py'))
records = importlib.util.module_from_spec(spec)
spec.loader.exec_module(records)


def archive(path, *, image):
    payload = b'bounded inert bundle fixture'
    config = json.dumps({'os': 'linux', 'architecture': 'amd64'} if image else {}).encode()
    config_digest, payload_digest = (hashlib.sha256(raw).hexdigest() for raw in (config, payload))
    layers = [] if image else [{'digest': 'sha256:' + payload_digest, 'size': len(payload), 'mediaType': 'application/x-tar',
                               'annotations': {'org.opencontainers.image.title': 'supervisor.tar'}}]
    manifest = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                           'config': {'digest': 'sha256:' + config_digest, 'size': len(config), 'mediaType': 'application/vnd.oci.image.config.v1+json'}, 'layers': layers}).encode()
    digest = hashlib.sha256(manifest).hexdigest()
    files = {'oci-layout': b'{"imageLayoutVersion":"1.0.0"}',
             'index.json': json.dumps({'schemaVersion': 2, 'manifests': [{'digest': 'sha256:' + digest, 'size': len(manifest), 'mediaType': 'application/vnd.oci.image.manifest.v1+json'}]}).encode(),
             'blobs/sha256/' + digest: manifest, 'blobs/sha256/' + config_digest: config}
    if not image:
        files['blobs/sha256/' + payload_digest] = payload
    with tarfile.open(path, 'w') as output:
        for name, raw in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(raw)
            output.addfile(member, io.BytesIO(raw))
    return digest, payload_digest, len(payload)


class PublisherCommand(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / 'studio-release/download'
        self.directory.mkdir(parents=True)
        self.value = records.candidate()
        for role in ('render', 'verify', 'host'):
            digest, payload_digest, size = archive(self.directory / (role + '.oci.tar'), image=role != 'host')
            ref = 'ghcr.io/jesusfilm/forge-studio-' + role + '@sha256:' + digest
            if role == 'host':
                self.value['bundle'] = {'artifact': ref, 'sha256': payload_digest, 'size': size}
            else:
                self.value['images'][role] = ref
        self.calls = []
        self.fail_role = None
        self.env = {'RUNNER_TEMP': str(self.root), 'GITHUB_REPOSITORY': 'JesusFilm/forge',
                    'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': '1' * 40, 'GITHUB_RUN_ID': '123',
                    'GITHUB_RUN_ATTEMPT': '1', 'GH_TOKEN': 'fixture_only_token', 'GITHUB_STEP_SUMMARY': str(self.root / 'summary')}
        self.save()
        self.config = {'target': self.value['target'], 'codecArtifact': self.value['codec']['artifact']}

    def save(self):
        raw = json.dumps(self.value).encode()
        (self.directory / 'candidate.json').write_bytes(raw)
        self.env['STUDIO_CANDIDATE_SHA256'] = hashlib.sha256(raw).hexdigest()

    def get(self, path):
        self.calls.append(('api', path))
        self.assertEqual(path, 'actions/runs/123')
        return {'id': 123, 'run_attempt': 1, 'head_sha': '1' * 40, 'head_branch': 'main', 'event': 'workflow_dispatch',
                'path': '.github/workflows/studio-release.yml@main', 'actor': {'id': 202}, 'triggering_actor': {'id': 303}}

    def login(self):
        self.calls.append(('login',))
        path = self.root / 'registry'
        path.write_bytes(b'fixture only')
        return path

    def run_command(self, argv, **kwargs):
        self.calls.append(('command', argv))
        if self.fail_role and any(self.fail_role + '.oci.tar@' in arg for arg in argv):
            raise ReleaseRefused('Injected copy failure')
        if argv[1] == 'push':
            Path(argv[argv.index('--export-manifest') + 1]).write_bytes(b'fixture manifest')

    def execute(self):
        with patch.dict(os.environ, self.env), patch.object(ci, 'configuration', return_value=self.config), patch.object(ci, 'GitHub', return_value=self), patch.object(ci, 'login', self.login), patch.object(ci, 'run', self.run_command), patch.object(ci, 'tool', return_value='/fixture/oras'):
            ci.publish()

    def test_exact_run_and_bytes_precede_inert_copy_and_record_is_last(self):
        self.execute()
        self.assertEqual([call[0] for call in self.calls], ['api', 'login', 'command', 'command', 'command', 'command'])
        commands = [call[1] for call in self.calls if call[0] == 'command']
        self.assertEqual([command[1] for command in commands], ['cp', 'cp', 'cp', 'push'])
        for command, role in zip(commands, ('render', 'verify', 'host')):
            ref = self.value['bundle']['artifact'] if role == 'host' else self.value['images'][role]
            self.assertIn(str(self.directory / (role + '.oci.tar')) + '@' + ref.split('@')[1], command)
        self.assertFalse((self.root / 'registry').exists())

    def test_inconsistent_host_payload_never_logs_into_registry(self):
        self.value['bundle']['sha256'] = '0' * 64
        self.save()
        with self.assertRaises(ReleaseRefused):
            self.execute()
        self.assertNotIn(('login',), self.calls)

    def test_partial_copy_has_no_release_record_or_success_summary(self):
        self.fail_role = 'verify'
        with self.assertRaises(ReleaseRefused):
            self.execute()
        self.assertFalse(any(call[0] == 'command' and call[1][1] == 'push' for call in self.calls))
        self.assertFalse((self.root / 'summary').exists())
        self.assertFalse((self.root / 'registry').exists())


if __name__ == '__main__':
    unittest.main()
