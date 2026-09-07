import json
import threading
import hashlib
import tempfile
import unittest
from pathlib import Path
from dispatch_guard_v2 import Guard, Rejected

BASE = Path(__file__).parents[1] / 'model-comparison-1'
SCRATCH = Path(__file__).resolve().parents[4] / '.tmp/studio458-guard-v2'

class ReplayFenceTests(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.path = str(Path(self.directory.name) / 'new-evaluation.sqlite')
        self.p = json.loads((BASE / 'verified-bound-proposal.body').read_text())
        self.p['dispatchGuardVersion'] = 'studio-request-replay-v2'
        self.raw = (BASE / 'live/request-0-0-request.body').read_bytes()
        self.result = json.loads((BASE / 'live/request-0-0-result.json').read_text())
    def tearDown(self):
        # Disposable test ledgers only; originals/LIVE ledgers never opened.
        self.directory.cleanup()
    def test_same_run_replay_is_rejected_before_a_second_reservation_after_restart(self):
        g = Guard(self.path, self.p)
        claim = g.reserve(0, 0, 'first-attempt', g.expected(0, 'first-attempt'), self.raw)
        g.finish(claim, 'COMPLETED', self.result)
        g.close()
        g = Guard(self.path, self.p)
        try:
            with self.assertRaises(Rejected):
                g.reserve(0, 1, 'first-attempt', g.expected(0, 'first-attempt'), self.raw)
            self.assertEqual(g.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0], 1)
            self.assertEqual(g.db.execute('SELECT state FROM calls').fetchone()[0], 'COMPLETED')
        finally:
            g.close()
    def test_identical_bytes_in_a_distinct_authorized_run_are_not_a_replay(self):
        self.p['runOrder'][1] = {**self.p['runOrder'][0], 'slot': 1}
        g = Guard(self.path, self.p)
        try:
            first = g.reserve(0, 0, 'first', g.expected(0, 'first'), self.raw)
            g.finish(first, 'COMPLETED', self.result)
            second = g.reserve(1, 0, 'second', g.expected(1, 'second'), self.raw)
            self.assertNotEqual(first['owner'], second['owner'])
            self.assertEqual(g.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0], 2)
        finally:
            g.close()
    def test_duplicate_owner_cannot_stop_or_finish_the_winner(self):
        a = Guard(self.path, self.p)
        b = Guard(self.path, self.p)
        try:
            claim = a.reserve(0, 0, 'winner', a.expected(0, 'winner'), self.raw)
            with self.assertRaises(Rejected):
                b.reserve(0, 0, 'loser', {}, b'malformed')
            self.assertEqual(a.db.execute('SELECT stopped FROM batch').fetchone()[0], 0)
            a.finish(claim, 'COMPLETED', self.result)
            self.assertEqual(a.db.execute('SELECT state FROM calls').fetchone()[0], 'COMPLETED')
        finally:
            a.close(); b.close()

    def test_concurrent_identical_dispatch_has_one_reservation(self):
        g = Guard(self.path, self.p)
        g.close()
        barrier = threading.Barrier(2)
        outcomes = []
        def run():
            connection = Guard(self.path, self.p)
            try:
                barrier.wait(timeout=5)
                outcomes.append(connection.reserve(0, 0, 'same', connection.expected(0, 'same'), self.raw))
            except Rejected:
                outcomes.append('rejected')
            finally:
                connection.close()
        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=10)
        self.assertTrue(all(not t.is_alive() for t in threads))
        self.assertEqual(outcomes.count('rejected'), 1)
        g = Guard(self.path, self.p)
        try:
            self.assertEqual(g.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0], 1)
            self.assertEqual(g.db.execute('SELECT stopped FROM batch').fetchone()[0], 0)
        finally: g.close()
    def test_ambiguous_unknown_charge_remains_consumed_after_restart(self):
        g = Guard(self.path, self.p)
        claim = g.reserve(0, 0, 'ambiguous', g.expected(0, 'ambiguous'), self.raw)
        g.finish(claim, 'AMBIGUOUS', {'actualCostUSD': None, 'completeStream': False})
        g.close()
        g = Guard(self.path, self.p)
        try:
            with self.assertRaises(Rejected):
                g.reserve(0, 1, 'ambiguous', g.expected(0, 'ambiguous'), self.raw)
            state, result = g.db.execute('SELECT state,result FROM calls').fetchone()
            self.assertEqual(state, 'AMBIGUOUS')
            self.assertIsNone(json.loads(result)['actualCostUSD'])
        finally: g.close()
    def test_old_manifest_is_refused_without_changing_existing_ledger(self):
        old = {k: v for k, v in self.p.items() if k != 'dispatchGuardVersion'}
        with self.assertRaises(Rejected): Guard(self.path, old)
        self.assertFalse(Path(self.path).exists())
        g = Guard(self.path, self.p)
        g.close()
        before = hashlib.sha256(Path(self.path).read_bytes()).hexdigest()
        with self.assertRaises(Rejected): Guard(self.path, {**self.p, 'changed': True})
        self.assertEqual(hashlib.sha256(Path(self.path).read_bytes()).hexdigest(), before)
    def test_unrelated_slot_violation_still_stops_batch(self):
        g = Guard(self.path, self.p)
        try:
            claim = g.reserve(0, 0, 'winner', g.expected(0, 'winner'), self.raw)
            with self.assertRaises(Rejected): g.reserve(1, 0, 'other', {}, b'malformed')
            self.assertEqual(g.db.execute('SELECT stopped FROM batch').fetchone()[0], 1)
            g.finish(claim, 'COMPLETED', self.result)
            self.assertEqual(g.db.execute('SELECT state FROM calls').fetchone()[0], 'COMPLETED')
        finally: g.close()

if __name__ == '__main__':
    unittest.main()
