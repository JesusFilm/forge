import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

source = Path(__file__).resolve().parents[1] / 'ops/install-supervisor.py'
spec = importlib.util.spec_from_file_location('installer', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def archive_bytes(name):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w') as archive:
        member = tarfile.TarInfo(name)
        member.size = 1
        archive.addfile(member, io.BytesIO(b'x'))
    return data.getvalue()


class BundleTests(unittest.TestCase):
    def test_replacement_after_read_cannot_replace_verified_members(self):
        original = archive_bytes('original')
        replacement = archive_bytes('replacement')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bundle.tar'
            path.write_bytes(original)

            class SnapshotPath:
                def open(self, mode):
                    class Reader(io.BytesIO):
                        def close(self):
                            path.write_bytes(replacement)
                            super().close()
                    return Reader(path.read_bytes())

            with module.verified_archive(SnapshotPath(), hashlib.sha256(original).hexdigest()) as archive:
                self.assertEqual(archive.getnames(), ['original'])
            self.assertEqual(path.read_bytes(), replacement)

    def test_wrong_approved_hash_refuses_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bundle.tar'
            path.write_bytes(archive_bytes('original'))
            with self.assertRaisesRegex(ValueError, 'checksum'):
                module.verified_archive(path, '0' * 64)


if __name__ == '__main__':
    unittest.main()
