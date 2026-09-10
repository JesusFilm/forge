"""Fixed-origin read-only GitHub evidence. No fixture URL or approval write API."""
import json
from pathlib import Path
import re
import subprocess
import tempfile

from release import ReleaseRefused, matches, unique_object, refuse_constant


class GitHub:
    def __init__(self, token):
        if not matches(token, '[A-Za-z0-9_.-]{10,8192}'):
            raise ReleaseRefused('Scoped GitHub read token required')
        self.token = token

    def download_artifact(self, artifact_id, output):
        if not matches(artifact_id, '[1-9][0-9]{0,19}'):
            raise ReleaseRefused('Exact GitHub artifact ID required')
        config = 'header = "Authorization: Bearer ' + self.token + '"\n'
        # GitHub supplies the signed HTTPS archive redirect. Curl strips the
        # Authorization header on cross-origin redirects; never location-trusted.
        try:
            result = subprocess.run(['/usr/bin/curl', '--fail', '--silent', '--show-error',
                                     '--proto', '=https', '--proto-redir', '=https', '--location',
                                     '--max-redirs', '2', '--noproxy', '*', '--max-time', '300',
                                     '--max-filesize', str(8 * 1024**3), '--config', '-', '--output', str(output),
                                     'https://api.github.com/repos/JesusFilm/forge/actions/artifacts/' + artifact_id + '/zip'],
                                    input=config.encode(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=305, check=False, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        except subprocess.TimeoutExpired as error:
            raise ReleaseRefused('Candidate download timed out') from error
        if result.returncode:
            raise ReleaseRefused('Candidate download failed')

    def get(self, path):
        if not re.fullmatch(r'actions/runs/[1-9][0-9]{0,19}', path):
            raise ReleaseRefused('GitHub evidence path refused')
        with tempfile.TemporaryDirectory(prefix='studio-release-api-') as temporary:
            root = Path(temporary)
            body, headers = root / 'body', root / 'headers'
            config = ('header = "Authorization: Bearer ' + self.token + '"\n'
                      'header = "Accept: application/vnd.github+json"\n'
                      'header = "X-GitHub-Api-Version: 2022-11-28"\n')
            try:
                result = subprocess.run(['/usr/bin/curl', '--fail', '--silent', '--show-error',
                                         '--proto', '=https', '--noproxy', '*', '--max-time', '15',
                                         '--max-filesize', '1048576', '--dump-header', str(headers),
                                         '--output', str(body), '--config', '-',
                                         'https://api.github.com/repos/JesusFilm/forge/' + path],
                                        input=config.encode(), stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, timeout=17, check=False,
                                        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
            except subprocess.TimeoutExpired as error:
                raise ReleaseRefused('GitHub evidence timed out') from error
            if result.returncode:
                raise ReleaseRefused('GitHub evidence unavailable')
            return decode_response(headers.read_bytes(), body.read_bytes())


def decode_response(headers, body):
    if len(headers) > 65536 or len(body) >= 1048576:
        raise ReleaseRefused('GitHub evidence exceeds completeness bound')
    lines = headers.decode('iso-8859-1').splitlines()
    statuses = [line.split()[1] for line in lines if line.startswith('HTTP/') and len(line.split()) >= 2]
    # Refuse redirects, pagination and incomplete responses.
    if statuses != ['200'] or any(line.lower().startswith('link:') for line in lines):
        raise ReleaseRefused('Redirected or paginated GitHub evidence refused')
    try:
        return json.loads(body, object_pairs_hook=unique_object, parse_constant=refuse_constant)
    except (ValueError, UnicodeDecodeError, RecursionError) as error:
        raise ReleaseRefused('Incomplete GitHub evidence refused') from error


def authorize_publication(api, candidate):
    identity = candidate['build']
    run = api.get('actions/runs/' + identity['runId'])
    if (not isinstance(run, dict) or type(run.get('id')) is not int or str(run['id']) != identity['runId']
            or type(run.get('run_attempt')) is not int or run['run_attempt'] != identity['runAttempt']
            or run.get('head_sha') != candidate['source']['commit'] or run.get('head_branch') != 'main'
            or run.get('event') != 'workflow_dispatch' or run.get('path') not in (identity['workflow'], identity['workflow'] + '@main')):
        raise ReleaseRefused('Actual workflow identity differs from candidate')
