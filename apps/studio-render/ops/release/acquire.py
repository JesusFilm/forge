#!/usr/bin/env python3
"""Acquire one explicitly selected host bundle; no install, switch or activation."""
import argparse
import json
import os
from pathlib import Path
import sys

from artifacts import fetch_payload, oras
from host import read_private
from release import ReleaseRefused, exact_keys, unique_object, verify_candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--approved-candidate-sha256', required=True)
    parser.add_argument('--output-directory', required=True, type=Path)
    args = parser.parse_args()
    if os.getuid() != 0:
        raise ReleaseRefused('Trusted root operator command required')
    policy = json.loads(read_private(Path('/etc/forge-studio/release-policy.json')), object_pairs_hook=unique_object)
    exact_keys(policy, ['version', 'enabled', 'target'])
    if type(policy['version']) is not int or policy['version'] != 1 or policy['enabled'] is not True:
        raise ReleaseRefused('Host release policy is disabled')
    candidate = verify_candidate(read_private(args.candidate), args.approved_candidate_sha256, policy['target'])
    args.output_directory.mkdir(mode=0o700)
    bundle = candidate['bundle']
    path = fetch_payload(bundle['artifact'], bundle['sha256'], 150000000, 'supervisor.tar', args.output_directory,
                         lambda command, output, maximum: oras(command, output, maximum,
                             tool='/usr/local/lib/forge-studio-release/oras',
                             registry_config='/var/lib/forge-studio/docker-client/config.json'))
    if path.stat().st_size != bundle['size']:
        raise ReleaseRefused('Selected bundle size differs')
    path.chmod(0o600)
    print('Exact selected bundle acquired. Installation and selection remain separate.')


if __name__ == '__main__':
    try:
        main()
    except (ReleaseRefused, OSError, ValueError) as error:
        print('Bundle acquisition refused; preserve staging for trusted inspection.', file=sys.stderr)
        raise SystemExit(1) from error
