import os
from pathlib import Path
import subprocess
import sys
import unittest

OPS = Path(__file__).resolve().parents[1] / 'ops/release'


class ReleaseEntryPoints(unittest.TestCase):
    def test_non_main_preflight_exits_before_network(self):
        env = {'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1',
               'GITHUB_REPOSITORY': 'JesusFilm/forge', 'GITHUB_REF': 'refs/heads/feature',
               'GITHUB_SHA': '1' * 40, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}
        # Non-main dispatch must fail before any token or network access.
        result = subprocess.run([sys.executable, str(OPS / 'ci.py'), 'preflight'], env=env,
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b'')
        self.assertIn(b'Studio release refused', result.stderr)
        self.assertNotIn(b'Traceback', result.stderr)

    @unittest.skipIf(os.getuid() == 0, 'Run as ordinary development user to test root-operator boundary')
    def test_non_root_cannot_acquire_or_apply_caller_claimed_selection(self):
        for script, extra in [('host.py', ['--bundle', '/nonexistent']),
                              ('acquire.py', ['--output-directory', '/nonexistent'])]:
            with self.subTest(script=script):
                result = subprocess.run([sys.executable, str(OPS / script), '--candidate', '/nonexistent',
                                         '--approved-candidate-sha256', 'a' * 64, *extra],
                                        env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'},
                                        capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn(b'Traceback', result.stderr)
                self.assertEqual(result.stdout, b'')


if __name__ == '__main__':
    unittest.main()
