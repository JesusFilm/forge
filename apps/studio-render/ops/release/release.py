#!/usr/bin/env python3
"""Validate exact operator-selected release bytes before any external action."""
import hashlib
import json
import re


class ReleaseRefused(Exception):
    pass


ARCHIVE_SHA256 = 'e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4'
FFMPEG_SHA256 = 'bf626ef18ccc5b1c8d26e2e046a90b998d1554d2bde0dcac0d497ad1886e9aa6'
FFPROBE_SHA256 = 'c7a58858f84f56ce52fee2d09d1c8a56fbd4226e15be15c8c8fe88da395d3a1c'
PROFILE = 'studio-render-1/900s-2cpu-2g-128p-96child-128m'


def exact_keys(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ReleaseRefused('Release record fields refused')


def matches(value, pattern):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def artifact(value, role):
    if not matches(value, re.escape('ghcr.io/jesusfilm/forge-studio-' + role + '@sha256:') + '[a-f0-9]{64}'):
        raise ReleaseRefused('Immutable owned artifact required')


def unique_object(pairs):
    value = {}
    for key, entry in pairs:
        if key in value:
            raise ReleaseRefused('Duplicate candidate field refused')
        value[key] = entry
    return value


def refuse_constant(value):
    raise ReleaseRefused('Nonstandard JSON constant refused')


def verify_candidate(raw, approved_sha256, target):
    if not isinstance(raw, bytes) or len(raw) > 65536:
        raise ReleaseRefused('Candidate size refused')
    if not isinstance(approved_sha256, str) or not re.fullmatch('[a-f0-9]{64}', approved_sha256):
        raise ReleaseRefused('Explicit operator-selected candidate digest required')
    if hashlib.sha256(raw).hexdigest() != approved_sha256:
        raise ReleaseRefused('Candidate differs from operator selection')
    try:
        value = json.loads(raw, object_pairs_hook=unique_object, parse_constant=refuse_constant)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseRefused('Candidate JSON refused') from error
    if not isinstance(value, dict) or set(value) != {'version', 'target', 'repository', 'source', 'build', 'platform', 'profile', 'codec', 'images', 'bundle'}:
        raise ReleaseRefused('Candidate contract refused')
    if not isinstance(target, str) or not re.fullmatch("[a-z][a-z0-9-]{2,63}", target) or value["target"] != target:
        raise ReleaseRefused("Candidate target differs from operator selection")
    if type(value['version']) is not int or value['version'] != 1 or value['repository'] != 'JesusFilm/forge' or value['platform'] != 'linux/amd64' or value['profile'] != PROFILE:
        raise ReleaseRefused('Release repository, platform or profile refused')
    exact_keys(value['source'], ['commit', 'ref'])
    if not matches(value['source']['commit'], '[a-f0-9]{40}') or value['source']['ref'] != 'refs/heads/main':
        raise ReleaseRefused('Exact reviewed main source required')
    exact_keys(value['build'], ['workflow', 'runId', 'runAttempt'])
    if value['build']['workflow'] != '.github/workflows/studio-release.yml' or not matches(value['build']['runId'], '[1-9][0-9]{0,19}') or type(value['build']['runAttempt']) is not int or not 1 <= value['build']['runAttempt'] <= 100:
        raise ReleaseRefused('Build identity refused')
    exact_keys(value['codec'], ['artifact', 'archiveSha256', 'ffmpegSha256', 'ffprobeSha256'])
    artifact(value['codec']['artifact'], 'codec')
    if (value['codec']['archiveSha256'], value['codec']['ffmpegSha256'], value['codec']['ffprobeSha256']) != (ARCHIVE_SHA256, FFMPEG_SHA256, FFPROBE_SHA256):
        raise ReleaseRefused('Reviewed codec supply required')
    exact_keys(value['images'], ['render', 'verify'])
    for role in ['render', 'verify']:
        artifact(value['images'][role], role)
    exact_keys(value['bundle'], ['artifact', 'sha256', 'size'])
    artifact(value['bundle']['artifact'], 'host')
    if not matches(value['bundle']['sha256'], '[a-f0-9]{64}') or type(value['bundle']['size']) is not int or not 1 <= value['bundle']['size'] <= 150000000:
        raise ReleaseRefused('Bounded host bundle required')
    return value


def apply_selected(raw, approved_sha256, policy, host):
    """Trusted host command supplies approval, never the candidate's own fields.

    Acquisition and inactive installation precede drain. Any failure leaves the
    prior selection in place; the adapter must retain drain after it is requested.
    Activation is deliberately a separate explicit host operation.
    """
    exact_keys(policy, ['version', 'enabled', 'target'])
    if type(policy['version']) is not int or policy['version'] != 1 or policy['enabled'] is not True:
        raise ReleaseRefused('Host release policy is disabled')
    candidate = verify_candidate(raw, approved_sha256, policy['target'])
    host.preload(candidate)
    host.install(candidate)
    host.drain()
    host.select(candidate)
    return candidate
