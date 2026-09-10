import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('records', Path(__file__).with_name('release-record.test.py'))
records = importlib.util.module_from_spec(spec)
spec.loader.exec_module(records)
release = records.module


class Host:
    def __init__(self, fail_at=None):
        self.calls = []
        self.fail_at = fail_at

    def call(self, name, *args):
        self.calls.append((name, *args))
        if name == self.fail_at:
            raise release.ReleaseRefused('Injected host failure')

    def preload(self, candidate):
        self.call('preload', candidate['images'])

    def install(self, candidate):
        self.call('install', candidate['bundle']['sha256'])

    def drain(self):
        self.call('drain')

    def select(self, candidate):
        self.call('select', candidate['images'], candidate['bundle']['sha256'])


class SelectedReleaseApplication(unittest.TestCase):
    def run_release(self, host, *, enabled=True, target='forge-render-proxmox-1', approved=None):
        raw = json.dumps(records.candidate()).encode()
        return release.apply_selected(raw, approved or hashlib.sha256(raw).hexdigest(),
                                      {'version': 1, 'enabled': enabled, 'target': target}, host)

    def test_disabled_or_mismatched_selection_cannot_acquire_or_install(self):
        for options in [{'enabled': False}, {'target': 'different-vm'}, {'approved': 'a' * 64}]:
            with self.subTest(options=options):
                host = Host()
                with self.assertRaises(release.ReleaseRefused):
                    self.run_release(host, **options)
                self.assertEqual(host.calls, [])

    def test_approved_selection_preloads_and_installs_inactive_then_drains_before_switch(self):
        host = Host()
        self.run_release(host)
        self.assertEqual([call[0] for call in host.calls], ['preload', 'install', 'drain', 'select'])
        self.assertEqual(host.calls[-1][1:], (records.candidate()['images'], records.candidate()['bundle']['sha256']))

    def test_unconfirmed_drain_never_selects_or_activates(self):
        host = Host('drain')
        with self.assertRaises(release.ReleaseRefused):
            self.run_release(host)
        self.assertEqual([call[0] for call in host.calls], ['preload', 'install', 'drain'])


if __name__ == '__main__':
    unittest.main()
