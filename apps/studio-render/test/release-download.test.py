import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import struct
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ops/release'))
import artifacts
from release import ReleaseRefused
spec = importlib.util.spec_from_file_location('records', Path(__file__).with_name('release-record.test.py'))
records = importlib.util.module_from_spec(spec)
spec.loader.exec_module(records)


class CandidateDownload(unittest.TestCase):
    def fixture(self, root, *, extra=None):
        raw = json.dumps(records.candidate()).encode()
        path = root / 'download.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('candidate.json', raw)
            for role in ('render', 'verify', 'host'):
                archive.writestr(role + '.oci.tar', b'inert fixture')
            if extra:
                archive.writestr(extra, b'never extract')
        return path, hashlib.sha256(raw).hexdigest()

    def test_layout_and_candidate_are_verified_before_fixed_name_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, digest = self.fixture(root)
            artifacts.unpack_candidate(path, root / 'out', digest, 'forge-render-proxmox-1')
            self.assertEqual({p.name for p in (root / 'out').iterdir()}, {'candidate.json', 'render.oci.tar', 'verify.oci.tar', 'host.oci.tar'})

    def test_oversized_directory_is_refused_before_zip_reader_allocation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, digest = self.fixture(root)
            raw = bytearray(path.read_bytes())
            footer = raw.rfind(b'PK\x05\x06')
            struct.pack_into('<L', raw, footer + 12, 1000000)
            path.write_bytes(raw)
            with patch.object(zipfile, 'ZipFile') as reader, self.assertRaises(ReleaseRefused):
                artifacts.unpack_candidate(path, root / 'out', digest, 'forge-render-proxmox-1')
            reader.assert_not_called()
            self.assertFalse((root / 'out').exists())

    def test_unsafe_member_or_changed_candidate_creates_no_output_directory(self):
        for extra in ('../escape', None):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                path, digest = self.fixture(root, extra=extra)
                with self.assertRaises(ReleaseRefused):
                    artifacts.unpack_candidate(path, root / 'out', digest if extra else '0' * 64, 'forge-render-proxmox-1')
                self.assertFalse((root / 'out').exists())
                self.assertFalse((root / 'escape').exists())


if __name__ == '__main__':
    unittest.main()
