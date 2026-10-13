"""Verify tvOS build artifacts on the VM; report via GitHub's Jobs API."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import zipfile

REPORT_PREFIX = 'VM evidence: '


def jest_counts(path):
    result = json.loads(Path(path).read_text())
    keys = ('numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests',
            'numTodoTests', 'numFailedTestSuites', 'numRuntimeErrorTestSuites')
    if any(type(result.get(k)) is not int or result[k] < 0 for k in keys):
        raise RuntimeError('Missing or invalid Jest result counts.')
    if (result.get('success') is not True or result['numPassedTests'] < 1
            or result['numFailedTests'] or result['numFailedTestSuites']
            or result['numRuntimeErrorTestSuites']):
        raise RuntimeError('Jest must execute tests successfully with zero failures.')
    if result['numTotalTests'] != sum(result[k] for k in
            ('numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests')):
        raise RuntimeError('Inconsistent Jest test counts.')
    return {'test_framework': 'jest', 'tests': result['numPassedTests'],
            'failures': 0, 'skipped': result['numPendingTests'], 'todo': result['numTodoTests']}


def validate_report(report, commit, action):
    if not isinstance(report, dict) or report.get('version') != 2:
        raise RuntimeError('Missing or unsupported tvOS VM evidence report.')
    if (report.get('commit') != commit or report.get('action') != action
            or action not in ('build', 'test') or not re.fullmatch('[0-9a-f]{40}', commit)):
        raise RuntimeError('VM evidence does not match the requested commit/action.')
    if (report.get('dirty') is not False or type(report.get('exit_code')) is not int
            or report['exit_code'] != 0):
        raise RuntimeError('VM evidence must describe a clean, successful build.')
    if report.get('platform') != 'tvos' or report.get('configuration') != 'Release':
        raise RuntimeError('Expected a Release Apple TV simulator build.')
    if any(report.get(k) is not True for k in ('xcresult', 'app_zip', 'embedded_js', 'topshelf')):
        raise RuntimeError('VM evidence is missing valid tvOS build artifacts.')
    if not re.fullmatch('[0-9a-f]{64}', report.get('sha256', '')):
        raise RuntimeError('Missing simulator archive checksum.')
    if action == 'test':
        if (report.get('test_framework') != 'jest' or type(report.get('tests')) is not int
                or report['tests'] < 1 or type(report.get('failures')) is not int
                or report['failures'] != 0):
            raise RuntimeError('VM evidence must include executed Jest tests with zero failures.')
        if any(type(report.get(k)) is not int or report[k] < 0 for k in ('skipped', 'todo')):
            raise RuntimeError('Missing skipped/todo test counts.')
    return report


def executable_in_zip(archive, base):
    info = plistlib.loads(archive.read(base + '/Info.plist'))
    if (info.get('DTPlatformName') != 'appletvsimulator'
            or 'AppleTVSimulator' not in info.get('CFBundleSupportedPlatforms', [])):
        raise RuntimeError('Artifact is not an Apple TV simulator binary.')
    executable = info.get('CFBundleExecutable')
    if (not isinstance(executable, str) or not executable or '/' in executable
            or executable in ('.', '..')):
        raise RuntimeError('App has no valid executable name.')
    with archive.open(base + '/' + executable) as binary:
        magic = binary.read(4)
    if magic not in (b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
        raise RuntimeError('App executable is not Mach-O.')
    return info


def verify_results(directory, commit, action, app_name):
    directory = Path(directory)
    summary = json.loads((directory / 'summary.json').read_text())
    report = {key: summary.get(key) for key in ('commit', 'dirty', 'action', 'exit_code', 'platform')}
    report.update(version=2, configuration='Release')
    if '** BUILD SUCCEEDED **' not in (directory / 'build.log').read_text():
        raise RuntimeError('Build log has no successful completion marker.')
    if action == 'test':
        report.update(jest_counts(directory / 'jest-results.json'))
    bundle = directory / 'Results.xcresult'
    report['xcresult'] = (bundle.is_dir() and (bundle / 'Info.plist').is_file()
                          and any(p.is_file() and p.stat().st_size for p in (bundle / 'Data').rglob('*')))
    path = directory / (app_name + '-simulator.zip')
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('Simulator ZIP failed its CRC integrity check.')
        base = app_name + '.app'
        info = executable_in_zip(archive, base)
        extension = executable_in_zip(archive, base + '/PlugIns/ForgeTopShelf.appex')
        if any(not info.get(k) or info[k] != extension.get(k)
               for k in ('CFBundleVersion', 'CFBundleShortVersionString')):
            raise RuntimeError('App and Top Shelf extension versions do not match.')
        report.update(app_zip=True, topshelf=True,
                      embedded_js=archive.getinfo(base + '/main.jsbundle').file_size > 0)
    digest = hashlib.sha256()
    with path.open('rb') as archive:
        for chunk in iter(lambda: archive.read(1024 * 1024), b''):
            digest.update(chunk)
    report['sha256'] = digest.hexdigest()
    return validate_report(report, commit, action)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('--commit', required=True)
    parser.add_argument('--action', required=True, choices=['build', 'test'])
    args = parser.parse_args()
    config = json.loads((Path(__file__).resolve().parents[2] / 'dev.project.json').read_text())
    report = verify_results(args.directory, args.commit, args.action, config['app_name'])
    encoded = json.dumps(report, separators=(',', ':'))
    (Path(args.directory) / 'verification.json').write_text(encoded + '\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('report=' + encoded + '\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write('## VM-verified Apple TV simulator build\n\n```json\n' +
                         json.dumps(report, indent=2) + '\n```\n\n' +
                         'Tests are Jest, not XCTest or simulator UI tests. ' +
                         'Download the app and evidence from this run’s Artifacts.\n')
    print(REPORT_PREFIX + encoded)


if __name__ == '__main__':
    main()

