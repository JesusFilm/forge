import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ops/release'))
import host
from release import ReleaseRefused


class HostRollout(unittest.TestCase):
    def test_image_configuration_changes_only_after_drain_and_stays_inactive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'worker.json'
            original = {'renderImage': 'old-render', 'verifyImage': 'old-verify', 'enabled': True, 'token': 'fixture-only'}
            config.write_text(json.dumps(original))
            adapter = host.LocalHost(root, root / 'bundle.tar')
            candidate = {'images': {'render': 'new-render', 'verify': 'new-verify'}, 'bundle': {'sha256': 'a' * 64}}
            with patch.object(host, 'CONFIG', config), patch.object(host, 'read_private', lambda p: p.read_bytes()):
                with self.assertRaises(ReleaseRefused):
                    adapter.select(candidate)
                self.assertEqual(json.loads(config.read_text()), original)
                adapter.config_raw = config.read_bytes()
                calls = []
                with patch.object(host, 'command', lambda argv, timeout: calls.append(argv)):
                    adapter.select(candidate)
                self.assertEqual(json.loads(config.read_text()), {**original, 'renderImage': 'new-render', 'verifyImage': 'new-verify'})
                self.assertTrue((root / 'selected-inactive').is_file())
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][-1], 'a' * 64)
                self.assertNotIn('--activate', calls[0])

    def test_concurrent_configuration_change_refuses_selection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'worker.json'
            config.write_bytes(b'changed')
            adapter = host.LocalHost(root, root / 'bundle.tar')
            adapter.config_raw = b'old'
            with patch.object(host, 'CONFIG', config), patch.object(host, 'read_private', lambda p: p.read_bytes()), patch.object(host, 'command') as command:
                with self.assertRaises(ReleaseRefused):
                    adapter.select({})
                command.assert_not_called()
                self.assertEqual(config.read_bytes(), b'changed')

    def test_failed_switch_does_not_record_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'worker.json'
            config.write_text('{}')
            adapter = host.LocalHost(root, root / 'bundle.tar')
            adapter.config_raw = config.read_bytes()
            with patch.object(host, 'CONFIG', config), patch.object(host, 'read_private', lambda p: p.read_bytes()), patch.object(host, 'command', side_effect=ReleaseRefused('fixture failure')):
                with self.assertRaises(ReleaseRefused):
                    adapter.select({'images': {'render': 'new-render', 'verify': 'new-verify'}, 'bundle': {'sha256': 'a' * 64}})
                self.assertFalse((root / 'selected-inactive').exists())
                # New config may be committed; do not pretend the old selection was
                # restored. CLI preserves pending rollout/drain for reconciliation.
                self.assertEqual(json.loads(config.read_text())['renderImage'], 'new-render')


if __name__ == '__main__':
    unittest.main()
