import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ops/release'))
from github import authorize_publication, decode_response
from release import ReleaseRefused
spec = importlib.util.spec_from_file_location('records', Path(__file__).with_name('release-record.test.py'))
records = importlib.util.module_from_spec(spec)
spec.loader.exec_module(records)


class ActualApprovalAdapter(unittest.TestCase):
    def setUp(self):
        self.candidate = records.candidate()
        self.digest = hashlib.sha256(json.dumps(self.candidate).encode()).hexdigest()
        self.policy = {'environmentId': 42, 'reviewerIds': [101]}
        self.responses = {
            'actions/runs/123': {'id': 123, 'run_attempt': 1, 'head_sha': '1' * 40,
                                'head_branch': 'main', 'event': 'workflow_dispatch',
                                'path': '.github/workflows/studio-release.yml',
                                'actor': {'id': 202}, 'triggering_actor': {'id': 303}},
            'environments/studio-release': {'id': 42, 'name': 'studio-release', 'protection_rules': [
                {'type': 'required_reviewers', 'prevent_self_review': True,
                 'reviewers': [{'type': 'User', 'reviewer': {'id': 101}}]}]},
            'actions/runs/123/approvals': [{'state': 'approved', 'user': {'id': 101},
                                          'environments': [{'id': 42}],
                                          'comment': 'studio-candidate-sha256:' + self.digest}],
        }
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        return decode_response(b'HTTP/2 200\r\n\r\n', json.dumps(self.responses[path]).encode())

    def test_adapter_reads_exact_run_environment_and_complete_history(self):
        authorize_publication(self, self.candidate, self.digest, self.policy)
        self.assertEqual(self.calls, ['actions/runs/123', 'environments/studio-release', 'actions/runs/123/approvals'])

    def test_documented_main_qualified_workflow_path_is_accepted(self):
        self.responses['actions/runs/123']['path'] += '@main'
        authorize_publication(self, self.candidate, self.digest, self.policy)
        self.responses['actions/runs/123']['path'] = '.github/workflows/studio-release.yml@other'
        with self.assertRaises(ReleaseRefused):
            authorize_publication(self, self.candidate, self.digest, self.policy)

    def test_either_original_or_rerun_actor_cannot_self_approve(self):
        for actor in ('actor', 'triggering_actor'):
            with self.subTest(actor=actor):
                self.responses['actions/runs/123'][actor]['id'] = 101
                with self.assertRaises(ReleaseRefused):
                    authorize_publication(self, self.candidate, self.digest, self.policy)
                self.responses['actions/runs/123'][actor]['id'] = 202

    def test_missing_rerun_identity_and_changed_attempt_refuse(self):
        del self.responses['actions/runs/123']['triggering_actor']
        with self.assertRaises(ReleaseRefused):
            authorize_publication(self, self.candidate, self.digest, self.policy)
        self.responses['actions/runs/123']['triggering_actor'] = {'id': 303}
        self.responses['actions/runs/123']['run_attempt'] = 2
        with self.assertRaises(ReleaseRefused):
            authorize_publication(self, self.candidate, self.digest, self.policy)

    def test_paginated_redirected_or_truncated_history_is_not_complete(self):
        for headers, body in [
            (b'HTTP/2 200\r\nLink: <next>; rel="next"\r\n', b'[]'),
            (b'HTTP/2 302\r\nLocation: https://other.example\r\n', b'[]'),
            (b'HTTP/2 200\r\n', b'[{'),
            (b'HTTP/2 200\r\n', b' ' * 1048576),
        ]:
            with self.subTest(headers=headers, size=len(body)), self.assertRaises(ReleaseRefused):
                decode_response(headers, body)


if __name__ == '__main__':
    unittest.main()
