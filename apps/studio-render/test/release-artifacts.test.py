import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ops/release'))
from artifacts import fetch_payload
from release import ReleaseRefused


class ArtifactBytes(unittest.TestCase):
    def fixture(self, directory, *, changed_manifest=False, changed_payload=False, title='supervisor.tar'):
        payload = b'bounded inert fixture bytes'
        digest = hashlib.sha256(payload).hexdigest()
        manifest = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                              'layers': [{'digest': 'sha256:' + digest, 'size': len(payload),
                                          'annotations': {'org.opencontainers.image.title': title}}]}).encode()
        ref = 'ghcr.io/jesusfilm/forge-studio-host@sha256:' + hashlib.sha256(manifest).hexdigest()
        calls = []
        def run(argv, output, maximum):
            calls.append(argv)
            raw = manifest if argv[0] == 'manifest' else payload
            if (argv[0] == 'manifest' and changed_manifest) or (argv[0] == 'blob' and changed_payload):
                raw = b'changed'
            output.write_bytes(raw)
        return ref, digest, calls, run

    def test_manifest_and_payload_are_bound_without_extracting_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            ref, digest, calls, run = self.fixture(directory)
            result = fetch_payload(ref, digest, 1024, 'supervisor.tar', directory, run)
            self.assertEqual(hashlib.sha256(result.read_bytes()).hexdigest(), digest)
            self.assertEqual([call[0] for call in calls], ['manifest', 'blob'])

    def test_manifest_mismatch_or_traversal_title_prevents_blob_fetch(self):
        for options in [{'changed_manifest': True}, {'title': '../supervisor.tar'}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                ref, digest, calls, run = self.fixture(directory, **options)
                with self.assertRaises(ReleaseRefused):
                    fetch_payload(ref, digest, 1024, 'supervisor.tar', directory, run)
                self.assertEqual([call[0] for call in calls], ['manifest'])

    def test_changed_payload_is_never_admitted(self):
        with tempfile.TemporaryDirectory() as directory:
            ref, digest, calls, run = self.fixture(directory, changed_payload=True)
            with self.assertRaises(ReleaseRefused):
                fetch_payload(ref, digest, 1024, 'supervisor.tar', directory, run)


if __name__ == '__main__':
    unittest.main()
