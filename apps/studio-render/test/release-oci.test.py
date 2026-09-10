import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ops/release'))
import artifacts
from release import ReleaseRefused


def fixture(path, *, escape=False, corrupt=False):
    config = json.dumps({'architecture': 'amd64', 'os': 'linux'}).encode()
    config_digest = hashlib.sha256(config).hexdigest()
    manifest = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                          'config': {'digest': 'sha256:' + config_digest, 'size': len(config)}, 'layers': []}).encode()
    digest = hashlib.sha256(manifest).hexdigest()
    index = json.dumps({'schemaVersion': 2, 'manifests': [{'digest': 'sha256:' + digest, 'size': len(manifest)}]}).encode()
    files = {'oci-layout': b'{"imageLayoutVersion":"1.0.0"}', 'index.json': index,
             'blobs/sha256/' + digest: manifest,
             'blobs/sha256/' + config_digest: b'changed' if corrupt else config}
    if escape:
        files['../escape'] = b'no'
    with tarfile.open(path, 'w') as archive:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return 'sha256:' + digest


class InertOCI(unittest.TestCase):
    def test_exact_archive_is_validated_without_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'image.tar'
            digest = fixture(path)
            self.assertEqual(artifacts.verify_oci_archive(path, digest, image=True), digest)
            self.assertEqual([p.name for p in Path(temporary).iterdir()], ['image.tar'])

    def test_oversized_extended_header_is_refused_before_tar_reader_allocation(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'image.tar'
            entry = tarfile.TarInfo('extended')
            entry.type = tarfile.XHDTYPE
            entry.size = 65537
            path.write_bytes(entry.tobuf() + b'\0' * 66048)
            with patch.object(tarfile, 'open') as reader, self.assertRaises(ReleaseRefused):
                artifacts.verify_oci_archive(path, None, image=True)
            reader.assert_not_called()

    def test_changed_blob_foreign_path_and_wrong_manifest_refused(self):
        for options in [{'escape': True}, {'corrupt': True}, {}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / 'image.tar'
                digest = fixture(path, **options)
                if not options:
                    digest = 'sha256:' + '0' * 64
                with self.assertRaises(ReleaseRefused):
                    artifacts.verify_oci_archive(path, digest, image=True)


if __name__ == '__main__':
    unittest.main()
