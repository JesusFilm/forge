import json
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[3]


class HostedWorkflow(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.safe_load((ROOT / '.github/workflows/studio-release.yml').read_text())

    def test_only_manual_main_owned_repository_execution_is_possible(self):
        # PyYAML 1.1 parses the unquoted YAML key 'on' as True; workflow quotes it.
        self.assertEqual(set(self.workflow['on']), {'workflow_dispatch'})
        for job in self.workflow['jobs'].values():
            self.assertIn("github.ref == 'refs/heads/main'", job['if'])
            self.assertIn("github.repository == 'JesusFilm/forge'", job['if'])
        config = json.loads((ROOT / 'apps/studio-render/ops/release/config.json').read_text())
        self.assertIs(config['enabled'], False)
        self.assertEqual(config['codecArtifact'], 'ghcr.io/jesusfilm/forge-studio-codec@sha256:a60de84e61cded686c703768809e34dc20bc0e501273fe1a5d4b9af5400f9cad')
        self.assertNotIn('environmentId', config)
        self.assertNotIn('reviewerIds', config)

    def test_candidate_has_no_write_and_publisher_never_builds_or_runs_candidate(self):
        build, publish = self.workflow['jobs']['candidate'], self.workflow['jobs']['publish']
        self.assertEqual(build['permissions'], {'contents': 'read', 'packages': 'read', 'actions': 'read'})
        self.assertEqual(publish['permissions'], {'contents': 'read', 'packages': 'write', 'actions': 'read'})
        self.assertEqual(publish['environment']['name'], 'studio-release')
        self.assertEqual(publish['needs'], ['candidate'])
        body = json.dumps(publish['steps'])
        self.assertNotIn('docker ', body)
        self.assertNotIn('source/', body)
        self.assertIn('ci.py publish', body)
        self.assertIn('github.sha', body)

    def test_actions_are_pinned_and_checkout_does_not_persist_credentials(self):
        for job in self.workflow['jobs'].values():
            for step in job['steps']:
                if 'uses' in step:
                    self.assertRegex(step['uses'], r'^[a-zA-Z0-9_/-]+@[a-f0-9]{40}$')
                if step.get('uses', '').startswith('actions/checkout@'):
                    self.assertIs(step['with']['persist-credentials'], False)


if __name__ == '__main__':
    unittest.main()
