import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / 'ops/on-demand/controller.py'
spec = importlib.util.spec_from_file_location('on_demand', FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeVM:
    def __init__(self):
        self.status = 'RUNNING'
        self.phase = 'idle'
        self.actions = []
    def state(self): return self.status
    def start(self): self.actions.append('start'); self.status = 'RUNNING'
    def stop(self): self.actions.append('stop'); self.status = 'STOPPED'
    def guest(self, action):
        self.actions.append(action)
        if action == 'wake': self.phase = 'idle'
        if action == 'drain': self.phase = 'safe'
        return self.phase


class Queue:
    pending = False
    def read(self): return self.pending


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.recovery = m.Recovery(Path(self.tmp.name) / 'recovery.json')
        self.vm, self.queue, self.now = FakeVM(), Queue(), 0
        self.c = m.Controller(self.vm, self.queue, self.recovery, 600, lambda: self.now)
    def idle_timeout(self):
        self.assertEqual(self.c.tick(), 'idle'); self.now = 600
    def test_stopped_empty_vm_stays_off_and_pending_starts_without_claim(self):
        self.vm.status = 'STOPPED'
        self.assertEqual(self.c.tick(), 'stopped'); self.assertEqual(self.vm.actions, [])
        self.queue.pending = True
        self.assertEqual(self.c.tick(), 'starting'); self.assertTrue(self.recovery.required)
        self.assertEqual(self.c.tick(), 'ready')
        self.assertEqual(self.vm.actions, ['start', 'probe', 'wake'])
    def test_idle_600_seconds_then_drain_recheck_and_graceful_stop(self):
        self.idle_timeout()
        self.assertEqual(self.c.tick(), 'stopped')
        self.assertEqual(self.vm.actions, ['probe', 'probe', 'drain', 'stop'])
        self.assertFalse(self.recovery.required)
    def test_busy_or_unknown_state_restarts_idle_window(self):
        for phase in ['busy', 'blocked']:
            self.idle_timeout(); self.vm.phase = phase
            self.assertEqual(self.c.tick(), phase)
            self.vm.phase = 'idle'; self.now += 600
            self.assertEqual(self.c.tick(), 'idle')
            self.assertNotIn('stop', self.vm.actions)
            self.c.idle_since = None; self.now = 0
    def test_wait_for_drain_completion_across_ticks(self):
        self.idle_timeout()
        original = self.vm.guest
        def guest(action):
            if action == 'drain': self.vm.phase = 'draining'; return 'draining'
            return original(action)
        self.vm.guest = guest
        self.assertEqual(self.c.tick(), 'draining'); self.vm.phase = 'safe'
        self.assertEqual(self.c.tick(), 'stopped')
        self.assertNotIn('wake', self.vm.actions)
    def test_new_job_during_drain_cancels_shutdown(self):
        self.idle_timeout()
        original = self.vm.guest
        def guest(action):
            if action == 'drain': self.queue.pending = True
            return original(action)
        self.vm.guest = guest
        self.assertEqual(self.c.tick(), 'working'); self.assertNotIn('stop', self.vm.actions)
    def test_job_arriving_after_stop_wakes_next_poll(self):
        self.idle_timeout(); self.c.tick(); self.queue.pending = True
        self.assertEqual(self.c.tick(), 'starting')
    def test_api_failure_never_authorizes_shutdown_and_resets_timer(self):
        self.idle_timeout()
        with patch.object(self.queue, 'read', side_effect=OSError('offline')):
            with self.assertRaises(OSError): self.c.tick()
        self.assertNotIn('stop', self.vm.actions)
        self.assertEqual(self.c.tick(), 'idle')
    def test_failed_final_queue_check_leaves_drain_recoverable(self):
        self.idle_timeout()
        with patch.object(self.queue, 'read', side_effect=[False, OSError('offline')]):
            with self.assertRaises(OSError): self.c.tick()
        self.assertNotIn('stop', self.vm.actions)
        self.assertEqual(self.c.tick(), 'stopped')
    def test_controller_restart_resets_idle_window(self):
        self.idle_timeout()
        fresh = m.Controller(self.vm, self.queue, self.recovery, 600, lambda: self.now)
        self.assertEqual(fresh.tick(), 'idle'); self.assertNotIn('stop', self.vm.actions)
    def test_persisted_recovery_wakes_even_before_lease_expires_or_demand_api_works(self):
        self.recovery.set(True); self.vm.status = 'STOPPED'
        fresh = m.Controller(self.vm, self.queue, m.Recovery(self.recovery.path), 600)
        with patch.object(self.queue, 'read', side_effect=OSError('offline')):
            self.assertEqual(fresh.tick(), 'recovering')
        self.assertEqual(self.vm.actions, ['start'])
    def test_running_vm_records_recovery_before_first_failed_queue_read(self):
        with patch.object(self.queue, 'read', side_effect=OSError('offline')):
            with self.assertRaises(OSError): self.c.tick()
        self.assertTrue(self.recovery.required)
    def test_failed_start_remains_recoverable(self):
        self.vm.status = 'STOPPED'; self.queue.pending = True
        with patch.object(self.vm, 'start', side_effect=TimeoutError()):
            with self.assertRaises(TimeoutError): self.c.tick()
        self.assertTrue(self.recovery.required)
    def test_manual_or_unresolved_drain_blocks_wake_even_with_pending_jobs(self):
        self.vm.phase = 'blocked'; self.queue.pending = True
        self.assertEqual(self.c.tick(), 'blocked')
        self.assertNotIn('wake', self.vm.actions)
    def test_startup_does_not_drop_readiness_tracking_on_exiting_service(self):
        self.c.waking = True
        def guest(action): return 'busy'
        self.vm.guest = guest
        self.assertEqual(self.c.tick(), 'working')
        self.assertTrue(self.c.waking)
    def test_uncertain_shutdown_keeps_durable_recovery(self):
        self.idle_timeout()
        with patch.object(self.vm, 'stop', side_effect=TimeoutError()):
            with self.assertRaises(TimeoutError): self.c.tick()
        self.assertTrue(self.recovery.required)
    def test_invalid_private_recovery_never_defaults_to_empty(self):
        self.recovery.path.write_text('{bad')
        self.recovery.path.chmod(0o600)
        with self.assertRaises(ValueError): m.Recovery(self.recovery.path)


class DemandTests(unittest.TestCase):
    def setUp(self):
        self.config = {'endpoint': 'https://manager.jesusfilm.org/api/shorts/render-demand',
                       'key': 'x' * 48, 'poolId': 'pool', 'workerId': 'worker', 'profileId': 'profile'}
        self.demand = m.Demand(self.config)
        self.body = {'version': 1, 'poolId': 'pool', 'workerId': 'worker', 'profileId': 'profile',
                     'enabled': True, 'hasPending': False}
    def read(self, raw, status=200):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.status = status
        response.read.return_value = raw
        response.__enter__.return_value = response
        with patch.object(self.demand.opener, 'open', return_value=response) as opened:
            value = self.demand.read()
        self.assertEqual(opened.call_args.kwargs['timeout'], 8)
        self.assertEqual(opened.call_args.args[0].get_header('User-agent'), 'Forge-Studio-OnDemand/1')
        response.read.assert_called_once_with(4097)
        return value
    def test_valid_empty_and_pending(self):
        self.assertFalse(self.read(json.dumps(self.body).encode()))
        self.body['hasPending'] = True
        self.assertTrue(self.read(json.dumps(self.body).encode()))
    def test_invalid_states_identity_and_version_never_mean_empty(self):
        for changes in [{'version': True}, {'workerId': 'other'}, {'enabled': False, 'hasPending': True},
                        {'hasPending': 0}, {'extra': 'field'}]:
            with self.subTest(changes=changes):
                with self.assertRaises(m.Refused): self.read(json.dumps({**self.body, **changes}).encode())
    def test_http_failure_duplicate_fields_and_oversize_refused(self):
        for raw, status in [(b'{}', 503), (b'{' + b' ' * 4096, 200),
                            (b'{"version":1,"version":1}', 200)]:
            with self.assertRaises(m.Refused): self.read(raw, status)
        with patch.object(self.demand.opener, 'open', side_effect=TimeoutError()):
            with self.assertRaises(TimeoutError): self.demand.read()
    def test_redirect_never_forwards_secret(self):
        with self.assertRaises(m.Refused):
            m.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example')


class LxdCommands(unittest.TestCase):
    def test_no_force_remote_or_arbitrary_instance_operations(self):
        vm = m.Lxd()
        with patch.object(vm, 'run', side_effect=[b'', b'[{"name":"forge-render-ai01","type":"virtual-machine","status":"Stopped"}]']) as run:
            vm.stop()
        self.assertEqual(run.call_args_list[0].args[0], ['stop', 'forge-render-ai01', '--timeout=30'])
        with self.assertRaises(m.Refused): vm.guest('delete')
        with patch.object(vm, 'run', return_value=b'[{"name":"other","type":"virtual-machine","status":"Running"}]'):
            with self.assertRaises(m.Refused): vm.state()


if __name__ == '__main__': unittest.main()
