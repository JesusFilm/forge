import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ops/release'))
import ci
from github import GitHub
from release import ReleaseRefused


class WorkflowToken(unittest.TestCase):
    def test_jwt_installation_token_reaches_password_stdin(self):
        token = 'ghs_123_eyJhbGciOiJSUzI1NiJ9.eyJmaXh0dXJlIjp0cnVlfQ.sig-123_abc'
        self.assertEqual(GitHub(token).token, token)
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / 'registry.json'
            registry.write_text('{}')
            with patch.dict(os.environ, {'GITHUB_ACTOR': 'tataihono', 'GH_TOKEN': token}), patch.object(ci, 'workspace', return_value=Path(directory)), patch.object(ci, 'tool', return_value='/fixture/oras'), patch.object(ci, 'run') as run:
                self.assertEqual(ci.login(), registry)
                self.assertEqual(run.call_args.kwargs['input'], token.encode())
                self.assertNotIn(token, ' '.join(run.call_args.args[0]))

    def test_control_and_config_injection_tokens_refuse_before_command(self):
        for token in ['x' * 9000, 'ghs_abc\nheader = bad', 'ghs_abc"bad', 'ghs_abc\\bad', 'ghs_abc bad']:
            with self.subTest(token_length=len(token)):
                with self.assertRaises(ReleaseRefused):
                    GitHub(token)
                with patch.dict(os.environ, {'GITHUB_ACTOR': 'tataihono', 'GH_TOKEN': token}), patch.object(ci, 'run') as run:
                    with self.assertRaises(ReleaseRefused):
                        ci.login()
                    run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
