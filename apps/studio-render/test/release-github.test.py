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


class ActualRunAdapter(unittest.TestCase):
    def setUp(self):
        self.candidate = records.candidate()
        self.digest = hashlib.sha256(json.dumps(self.candidate).encode()).hexdigest()
        self.responses = {'actions/runs/123': {
            'id': 123, 'run_attempt': 1, 'head_sha': '1' * 40,
            'head_branch': 'main', 'event': 'workflow_dispatch',
            'path': '.github/workflows/studio-release.yml'}}
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        return decode_response(b'HTTP/2 200\r\n\r\n', json.dumps(self.responses[path]).encode())

    def test_adapter_reads_exact_run_without_reviewer_or_approval_requests(self):
        authorize_publication(self, self.candidate)
        self.assertEqual(self.calls, ['actions/runs/123'])

    def test_documented_main_qualified_workflow_path_is_accepted(self):
        self.responses['actions/runs/123']['path'] += '@main'
        authorize_publication(self, self.candidate)
        self.responses['actions/runs/123']['path'] = '.github/workflows/studio-release.yml@other'
        with self.assertRaises(ReleaseRefused):
            authorize_publication(self, self.candidate)

    def test_changed_attempt_commit_branch_or_event_refuses(self):
        for field, value in [('run_attempt', 2), ('head_sha', '2' * 40),
                             ('head_branch', 'feature'), ('event', 'push')]:
            with self.subTest(field=field):
                original = self.responses['actions/runs/123'][field]
                self.responses['actions/runs/123'][field] = value
                with self.assertRaises(ReleaseRefused):
                    authorize_publication(self, self.candidate)
                self.responses['actions/runs/123'][field] = original

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
