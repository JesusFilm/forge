import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / 'ops/release/release.py'
spec = importlib.util.spec_from_file_location('studio_release', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def candidate():
    return {
        'version': 1,
        'target': 'forge-render-proxmox-1',
        'repository': 'JesusFilm/forge',
        'source': {'commit': '1' * 40, 'ref': 'refs/heads/main'},
        'build': {'workflow': '.github/workflows/studio-release.yml', 'runId': '123', 'runAttempt': 1},
        'platform': 'linux/amd64',
        'profile': 'studio-render-1/900s-2cpu-2g-128p-96child-128m',
        'codec': {
            'artifact': 'ghcr.io/jesusfilm/forge-studio-codec@sha256:' + '2' * 64,
            'archiveSha256': 'e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4',
            'ffmpegSha256': 'bf626ef18ccc5b1c8d26e2e046a90b998d1554d2bde0dcac0d497ad1886e9aa6',
            'ffprobeSha256': 'c7a58858f84f56ce52fee2d09d1c8a56fbd4226e15be15c8c8fe88da395d3a1c',
        },
        'images': {
            'render': 'ghcr.io/jesusfilm/forge-studio-render@sha256:' + '3' * 64,
            'verify': 'ghcr.io/jesusfilm/forge-studio-verify@sha256:' + '4' * 64,
        },
        'bundle': {'artifact': 'ghcr.io/jesusfilm/forge-studio-host@sha256:' + '5' * 64, 'sha256': '6' * 64, 'size': 10240},
    }


class ApprovedReleaseRecord(unittest.TestCase):
    def test_exact_candidate_is_bound_to_the_operator_selected_target(self):
        value = candidate()
        raw = json.dumps(value).encode()
        digest = hashlib.sha256(raw).hexdigest()
        self.assertEqual(module.verify_candidate(raw, digest, 'forge-render-proxmox-1')['images'], value['images'])
        with self.assertRaises(module.ReleaseRefused):
            module.verify_candidate(raw, digest, 'another-vm')

    def test_mutable_foreign_and_changed_supply_identities_are_refused(self):
        changes = [
            ('images', 'render', 'ghcr.io/jesusfilm/forge-studio-render:latest'),
            ('images', 'verify', 'ghcr.io/attacker/verify@sha256:' + '4' * 64),
            ('images', 'render', 'ghcrXio/jesusfilm/forge-studio-render@sha256:' + '3' * 64),
            ('codec', 'archiveSha256', '0' * 64),
            ('bundle', 'size', 150000001),
            ('source', 'ref', 'refs/pull/123/merge'),
        ]
        for group, key, changed in changes:
            with self.subTest(group=group, key=key):
                value = candidate()
                value[group][key] = changed
                raw = json.dumps(value).encode()
                with self.assertRaises(module.ReleaseRefused):
                    module.verify_candidate(raw, hashlib.sha256(raw).hexdigest(), value['target'])

    def test_duplicate_keys_are_refused_even_if_the_last_value_is_valid(self):
        raw = json.dumps(candidate()).encode()
        raw = b'{"target":"different-vm",' + raw[1:]
        with self.assertRaises(module.ReleaseRefused):
            module.verify_candidate(raw, hashlib.sha256(raw).hexdigest(), 'forge-render-proxmox-1')

    def test_json_approval_cannot_authorize_a_different_candidate(self):
        raw = json.dumps({'approved': True, 'target': 'forge-render-proxmox-1'}).encode()
        with self.assertRaises(module.ReleaseRefused):
            module.verify_candidate(raw, 'a' * 64, 'forge-render-proxmox-1')

    def test_matching_hash_does_not_admit_an_unrecognized_record(self):
        raw = json.dumps({'approved': True, 'target': 'forge-render-proxmox-1'}).encode()
        with self.assertRaises(module.ReleaseRefused):
            module.verify_candidate(raw, hashlib.sha256(raw).hexdigest(), 'forge-render-proxmox-1')


if __name__ == '__main__':
    unittest.main()
