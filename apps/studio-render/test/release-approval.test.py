import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('records', Path(__file__).with_name('release-record.test.py'))
records = importlib.util.module_from_spec(spec)
spec.loader.exec_module(records)
release = records.module


class PublicationApproval(unittest.TestCase):
    def setUp(self):
        self.digest = hashlib.sha256(json.dumps(records.candidate()).encode()).hexdigest()
        self.policy = {'environmentId': 42, 'reviewerIds': [101]}
        self.environment = {'id': 42, 'name': 'studio-release', 'protection_rules': [
            {'type': 'required_reviewers', 'prevent_self_review': True,
             'reviewers': [{'type': 'User', 'reviewer': {'id': 101}}]}]}
        self.reviews = [{'state': 'approved', 'user': {'id': 101}, 'environments': [{'id': 42}],
                         'comment': 'studio-candidate-sha256:' + self.digest}]

    def verify(self):
        release.verify_publication_approval(self.digest, self.policy, self.environment, self.reviews, [202])

    def test_actual_bound_non_self_review_is_required(self):
        self.verify()
        self.reviews[0]['user']['id'] = 202
        with self.assertRaises(release.ReleaseRefused):
            self.verify()

    def test_bypass_or_approval_of_previous_candidate_is_not_authority(self):
        for reviews in [[], [{'approved': True}], [{**self.reviews[0], 'comment': 'Ship it'}],
                        [{**self.reviews[0], 'comment': 'studio-candidate-sha256:' + '0' * 64}],
                        [{**self.reviews[0], 'environments': [{'id': 99}]}]]:
            with self.subTest(reviews=reviews):
                self.reviews = reviews
                with self.assertRaises(release.ReleaseRefused):
                    self.verify()

    def test_missing_or_recreated_unprotected_environment_is_refused(self):
        for environment in [{}, {'id': 99, 'name': 'studio-release', 'protection_rules': []},
                            {'id': 42, 'name': 'studio-release', 'protection_rules': []}]:
            with self.subTest(environment=environment):
                self.environment = environment
                with self.assertRaises(release.ReleaseRefused):
                    self.verify()

    def test_conflicting_rejection_for_same_candidate_is_fail_closed(self):
        self.reviews.append({**self.reviews[0], 'state': 'rejected'})
        with self.assertRaises(release.ReleaseRefused):
            self.verify()


if __name__ == '__main__':
    unittest.main()
