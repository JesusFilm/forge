"""Regression tests for tvOS routing and fail-closed VM evidence."""
import io
import json
import plistlib
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import dev
from evidence import REPORT_PREFIX, verify_results


class RoutingTests(unittest.TestCase):
    def test_linux_auto_uses_cloud(self):
        with patch.dict(dev.os.environ, {}, clear=True), patch.object(dev.platform, 'system', return_value='Linux'):
            self.assertEqual(dev.route({}), 'cloud')

    def test_mac_auto_uses_local(self):
        with patch.dict(dev.os.environ, {}, clear=True), patch.object(dev.platform, 'system', return_value='Darwin'):
            self.assertEqual(dev.route({}), 'local')

    def test_override_beats_saved_preference(self):
        with patch.dict(dev.os.environ, {'HYBRID_BUILDER': 'cloud'}, clear=True):
            self.assertEqual(dev.route({'builder': 'cloud'}, 'local'), 'local')

    def test_cloud_rejects_dirty_source_without_dispatch(self):
        with patch.object(dev, 'executable', return_value='gh'), patch.object(dev, 'source_identity', return_value=('a'*40, True)), patch.object(dev, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'committed'):
                dev.cloud_build('build', {}, 10)
            run.assert_not_called()

    def test_identity_cannot_be_overridden_by_environment(self):
        with patch.dict(dev.os.environ, {'HYBRID_SOURCE_COMMIT': 'b'*40, 'HYBRID_SOURCE_DIRTY': '0'}), patch.object(dev, 'capture', side_effect=['a'*40, ' M source.ts']), patch.object(dev, 'git', return_value='git'):
            self.assertEqual(dev.source_identity(), ('a'*40, True))

    def test_source_changes_or_commit_mismatch_fail_closed(self):
        for identity in [('a'*40, True), ('b'*40, False)]:
            with self.subTest(identity=identity), patch.object(dev, 'source_identity', return_value=identity):
                with self.assertRaises(RuntimeError):
                    dev.require_clean_source('a'*40)

    def test_failed_commands_keep_private_diagnostics(self):
        error = subprocess.CalledProcessError(1, ['gh', 'api'], stderr='https://storage.invalid/?signed-secret')
        with tempfile.TemporaryDirectory() as directory, patch.object(dev, 'ROOT', Path(directory)):
            path = dev.save_diagnostics(error)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertIn('signed-secret', path.read_text())


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.sha = 'a' * 40
        self.summary = {'commit': self.sha, 'dirty': False, 'action': 'test', 'exit_code': 0, 'platform': 'tvos'}
        self.jest = {'success': True, 'numTotalTests': 3, 'numPassedTests': 3,
                     'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0,
                     'numFailedTestSuites': 0, 'numRuntimeErrorTestSuites': 0}
        self.write_metadata()
        (self.directory / 'build.log').write_text('** BUILD SUCCEEDED **\n')
        bundle = self.directory / 'Results.xcresult'
        (bundle / 'Data').mkdir(parents=True)
        (bundle / 'Info.plist').write_bytes(plistlib.dumps({'version': 1}))
        (bundle / 'Data/data.0').write_bytes(b'xcresult fixture')
        self.archive = self.directory / 'ExampleApp-simulator.zip'
        self.write_zip()

    def write_metadata(self):
        (self.directory / 'summary.json').write_text(json.dumps(self.summary))
        (self.directory / 'jest-results.json').write_text(json.dumps(self.jest))

    def write_zip(self, platform='appletvsimulator', extension_version='1', bundle=True, binary=True):
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for base, name, version in [('ExampleApp.app', 'ExampleApp', '1'),
                    ('ExampleApp.app/PlugIns/ForgeTopShelf.appex', 'ForgeTopShelf', extension_version)]:
                archive.writestr(base + '/Info.plist', plistlib.dumps({
                    'CFBundleExecutable': name, 'DTPlatformName': platform,
                    'CFBundleSupportedPlatforms': ['AppleTVSimulator'],
                    'CFBundleVersion': version, 'CFBundleShortVersionString': '1.0.0'}))
                if binary:
                    archive.writestr(base + '/' + name, b'\xcf\xfa\xed\xfe' + b'executable fixture')
            if bundle:
                archive.writestr('ExampleApp.app/main.jsbundle', b'embedded JavaScript fixture')

    def verify(self):
        return verify_results(self.directory, self.sha, 'test', 'ExampleApp')

    def test_valid_evidence_reports_jest_counts(self):
        report = self.verify()
        self.assertEqual((report['tests'], report['failures'], report['test_framework']), (3, 0, 'jest'))
        self.assertTrue(report['app_zip'] and report['topshelf'] and report['embedded_js'])
        self.assertEqual(len(report['sha256']), 64)

    def test_rejects_wrong_identity_dirty_failed_or_wrong_platform(self):
        for key, value in [('commit', 'b'*40), ('action', 'build'), ('dirty', True),
                           ('exit_code', 1), ('platform', 'ios')]:
            with self.subTest(key=key):
                original = self.summary[key]
                self.summary[key] = value
                self.write_metadata()
                with self.assertRaises(RuntimeError):
                    self.verify()
                self.summary[key] = original

    def test_rejects_zero_failed_or_inconsistent_jest_results(self):
        for change in [{'numPassedTests': 0}, {'numFailedTests': 1}, {'success': False},
                       {'numFailedTestSuites': 1}, {'numRuntimeErrorTestSuites': 1},
                       {'numTotalTests': 5}, {'numPassedTests': True}]:
            with self.subTest(change=change):
                original = dict(self.jest)
                self.jest.update(change)
                self.write_metadata()
                with self.assertRaises(RuntimeError):
                    self.verify()
                self.jest = original

    def test_reports_skipped_separately(self):
        self.jest.update(numTotalTests=5, numPendingTests=1, numTodoTests=1)
        self.write_metadata()
        report = self.verify()
        self.assertEqual((report['tests'], report['skipped'], report['todo']), (3, 1, 1))

    def test_rejects_missing_build_success_marker(self):
        (self.directory / 'build.log').write_text('** TEST SUCCEEDED **')
        with self.assertRaises(RuntimeError):
            self.verify()

    def test_rejects_empty_result_bundle(self):
        (self.directory / 'Results.xcresult/Data/data.0').unlink()
        with self.assertRaises(RuntimeError):
            self.verify()

    def test_rejects_missing_zip(self):
        self.archive.unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()

    def test_rejects_corrupt_zip(self):
        self.archive.write_bytes(self.archive.read_bytes().replace(b'executable fixture', b'corrupted! fixture'))
        with self.assertRaises((RuntimeError, zipfile.BadZipFile)):
            self.verify()

    def test_rejects_phone_artifact_or_extension_version_mismatch(self):
        for args in [{'platform': 'iphonesimulator'}, {'extension_version': '2'}]:
            with self.subTest(args=args):
                self.write_zip(**args)
                with self.assertRaises(RuntimeError):
                    self.verify()

    def test_rejects_missing_bundle_or_executable(self):
        for args in [{'bundle': False}, {'binary': False}]:
            with self.subTest(args=args):
                self.write_zip(**args)
                with self.assertRaises(KeyError):
                    self.verify()

    def test_build_does_not_claim_tests(self):
        self.summary['action'] = 'build'
        self.write_metadata()
        report = verify_results(self.directory, self.sha, 'build', 'ExampleApp')
        self.assertNotIn('tests', report)


class CloudReportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.sha = 'a' * 40
        self.report = {'version': 2, 'commit': self.sha, 'dirty': False, 'action': 'test',
                       'exit_code': 0, 'tests': 3, 'failures': 0, 'xcresult': True, 'app_zip': True, 'platform': 'tvos', 'configuration': 'Release',
                       'embedded_js': True, 'topshelf': True, 'sha256': 'c'*64,
                       'test_framework': 'jest', 'skipped': 0, 'todo': 0}
        self.job = {'databaseId': 123, 'displayTitle': 'tvos-request', 'status': 'completed',
                    'conclusion': 'success', 'url': 'https://github.com/example/app/actions/runs/123'}
        self.step = {'name': REPORT_PREFIX + json.dumps(self.report), 'conclusion': 'success'}
        self.jobs = {'jobs': [{'name': 'tvos', 'conclusion': 'success', 'runner_name': 'utm-ios-builder',
                              'labels': ['self-hosted', 'macOS', 'ARM64', 'hybrid-ios'],
                              'steps': [{'name': 'Upload build evidence', 'conclusion': 'success'}, self.step]}]}

    def execute(self, download=False, download_code=0):
        answers = [self.sha, 'feature/vm-report', self.sha, json.dumps([self.job]), json.dumps(self.jobs)]
        with patch.object(dev, 'ROOT', self.root), \
             patch.object(dev, 'executable', return_value='gh'), \
             patch.object(dev, 'git', return_value='git'), \
             patch.object(dev, 'source_identity', return_value=(self.sha, False)), \
             patch.object(dev.uuid, 'uuid4', return_value=SimpleNamespace(hex='request')), \
             patch.object(dev, 'capture', side_effect=answers), \
             patch.object(dev, 'run') as dispatched, \
             patch.object(dev.subprocess, 'run', return_value=SimpleNamespace(
                 returncode=download_code, stderr='https://storage.invalid/?signed-secret')) as downloads, \
             patch('sys.stdout', new_callable=io.StringIO) as stdout, \
             patch('sys.stderr', new_callable=io.StringIO) as stderr:
            code = dev.cloud_build('test', {'repository': 'example/app', 'runner_arch': 'ARM64', 'runner_label': 'hybrid-ios'}, 10, download)
            self.output = stdout.getvalue() + stderr.getvalue()
            self.downloads = downloads.call_args_list
            self.dispatch = dispatched.call_args.args[0]
            return code

    def test_success_uses_api_report_without_downloading(self):
        self.assertEqual(self.execute(), 0)
        self.assertEqual(self.downloads, [])
        self.assertIn('feature/vm-report', self.dispatch)
        saved = json.loads((self.root / '.build-results/cloud-123/verification.json').read_text())
        self.assertEqual(saved['commit'], self.sha)
        self.assertEqual(saved['runner'], 'utm-ios-builder')
        self.assertEqual(saved['evidence_source'], 'vm')

    def test_optional_download_failure_remains_failure_and_redacts_error(self):
        self.assertEqual(self.execute(download=True, download_code=1), 1)
        self.assertEqual(len(self.downloads), 1)
        self.assertNotIn('signed-secret', self.output)
        self.assertNotIn('Cloud build: success', self.output)

    def test_optional_download_success(self):
        self.assertEqual(self.execute(download=True), 0)
        self.assertEqual(len(self.downloads), 1)

    def test_successful_legacy_workflow_without_report_is_rejected(self):
        self.jobs['jobs'][0]['steps'] = []
        with self.assertRaisesRegex(RuntimeError, 'Expected one'):
            self.execute()

    def test_rejects_skipped_report_step(self):
        self.step['conclusion'] = 'skipped'
        with self.assertRaises(RuntimeError):
            self.execute()

    def test_rejects_mismatched_report(self):
        self.report['commit'] = 'b' * 40
        self.step['name'] = REPORT_PREFIX + json.dumps(self.report)
        with self.assertRaisesRegex(RuntimeError, 'commit/action'):
            self.execute()

    def test_workflow_failure_is_not_overridden_by_report(self):
        self.job['conclusion'] = 'failure'
        self.assertEqual(self.execute(), 1)
        self.assertFalse((self.root / '.build-results/cloud-123/verification.json').exists())
        pending = json.loads((self.root / '.build-results/request-request.json').read_text())
        self.assertEqual(pending['conclusion'], 'failure')

    def test_pending_workflow_returns_75_without_report_or_download(self):
        self.job['status'] = 'queued'
        with patch.object(dev.time, 'monotonic', side_effect=[0, 1, 11]), patch.object(dev.time, 'sleep'):
            self.assertEqual(self.execute(), 75)
        self.assertEqual(self.downloads, [])
        self.assertNotIn('Cloud build: success', self.output)


    def test_rejects_wrong_runner_labels(self):
        self.jobs['jobs'][0]['labels'] = ['ubuntu-latest']
        with self.assertRaisesRegex(RuntimeError, 'labels'):
            self.execute()

    def test_rejects_missing_artifact_upload(self):
        self.jobs['jobs'][0]['steps'] = [self.step]
        with self.assertRaisesRegex(RuntimeError, 'artifact upload'):
            self.execute()

class NativeProjectConfigTests(unittest.TestCase):
    def test_selects_apple_tv_not_iphone(self):
        devices = {'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
            {'name': 'iPhone 17', 'udid': 'phone', 'isAvailable': True}],
            'com.apple.CoreSimulator.SimRuntime.tvOS-26-0': [
            {'name': 'Apple TV 4K', 'udid': 'tv', 'isAvailable': True}]}
        self.assertEqual(dev.tvos_destination(devices), 'platform=tvOS Simulator,id=tv')
        del devices['com.apple.CoreSimulator.SimRuntime.tvOS-26-0']
        with self.assertRaises(RuntimeError):
            dev.tvos_destination(devices)

    def test_native_uses_tvos_release_workspace_and_build_result(self):
        cfg = {'workspace': 'ios/JesusFilmWatch.xcworkspace', 'scheme': 'JesusFilmWatch'}
        command = dev.native_command(cfg, '/Xcode/usr/bin/xcodebuild', Path('/evidence'), 'platform=tvOS Simulator,id=tv')
        self.assertEqual(command[command.index('-workspace') + 1], cfg['workspace'])
        self.assertEqual(command[command.index('-scheme') + 1], cfg['scheme'])
        self.assertEqual(command[command.index('-configuration') + 1], 'Release')
        self.assertIn('CODE_SIGNING_ALLOWED=NO', command)
        self.assertEqual(command[-1], 'build')

    def test_bootstrap_uses_managed_ios_folder_and_tv_hermes_override(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(dev, 'executable'), patch.object(dev, 'capture', side_effect=['24', '9.12.3']), patch.object(dev, 'run'), patch.object(dev, 'logged', return_value=0) as commands:
            env = dev.bootstrap(Path(directory))
        self.assertEqual(env['EXPO_TV'], '1')
        self.assertEqual(env['REACT_NATIVE_OVERRIDE_NIGHTLY_BUILD_VERSION'], '0.81.5')
        self.assertIn('--frozen-lockfile', commands.call_args_list[0].args[0])
        prebuild = commands.call_args_list[1].args[0]
        self.assertEqual(prebuild[prebuild.index('--platform') + 1], 'ios')
        self.assertNotIn('--clean', prebuild)
        self.assertEqual(commands.call_args_list[2].kwargs['cwd'], dev.ROOT / 'ios')


if __name__ == '__main__':
    unittest.main()

