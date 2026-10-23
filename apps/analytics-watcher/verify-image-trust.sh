#!/bin/sh
# CI-only public TLS controls. Never starts the watcher or reads credentials.
set -eu
cd /app/apps/analytics-watcher
# Exercise persisted inert replacements and directory regeneration. A named
# alias may be absent or restored, but must never resolve to a certificate.
assert_inert_roots() {
  for certificate in emSign_ECC_Root_CA_-_G3 Comodo_AAA_Services_root; do
    file="/usr/share/ca-certificates/mozilla/$certificate.crt"
    test -f "$file"
    grep -q 'intentionally no PEM certificate' "$file"
    if openssl x509 -in "$file" -noout 2>/dev/null; then
      echo 'Distrusted root replacement is an X.509 certificate' >&2
      exit 1
    fi
    if openssl x509 -in "/etc/ssl/certs/$certificate.pem" -noout 2>/dev/null; then
      echo 'A named alias restored a distrusted certificate' >&2
      exit 1
    fi
  done
}
assert_inert_roots
update-ca-certificates --fresh >/dev/null
openssl rehash /etc/ssl/certs
assert_inert_roots
node --input-type=module - <<'NODE'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
assert.equal(process.version, 'v24.22.1')
for (const host of ['dv-g3b-emudhra.we-have-a-problem.com', 'dv-g3b-aaa-emudhra.we-have-a-problem.com']) {
  await assert.rejects(fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) }), error => error.cause?.code === 'CERT_REVOKED')
}
const good = await fetch('https://www.google.com/generate_204', { signal: AbortSignal.timeout(10000) })
assert.equal(good.status, 204)
console.log('PASS: patched Node rejects both affected chains and accepts valid TLS')
const browser = await chromium.launch({ headless: true })
try {
  for (const host of ['dv-g3b-emudhra.we-have-a-problem.com', 'dv-g3b-aaa-emudhra.we-have-a-problem.com']) {
    const page = await browser.newPage()
    await assert.rejects(page.goto(`https://${host}/`, { timeout: 10000, waitUntil: 'commit' }), /net::ERR_CERT_/)
    await page.close()
  }
  const page = await browser.newPage()
  const response = await page.goto('https://example.com/', { timeout: 10000, waitUntil: 'commit' })
  assert.equal(response?.status(), 200)
  console.log('PASS: installed watcher Chromium rejects both affected chains and accepts valid TLS')
} finally {
  await browser.close()
}
NODE
python3 - <<'PYTHON'
import concurrent.futures, json, os, ssl, urllib.error, urllib.request
hosts = ['dv-g3b-emudhra.we-have-a-problem.com', 'dv-g3b-aaa-emudhra.we-have-a-problem.com', 'www.google.com']
def check(item):
    mode, host = item
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if mode == 'bundle':
        context.load_verify_locations(cafile='/etc/ssl/certs/ca-certificates.crt')
    elif mode == 'default-directory':
        context.load_verify_locations(capath='/etc/ssl/certs')
    else:
        context.load_default_certs()
    try:
        with urllib.request.urlopen('https://' + host + '/', context=context, timeout=10) as response:
            assert host == 'www.google.com' and response.status == 200, 'Affected chain accepted'
    except urllib.error.URLError as error:
        assert host != 'www.google.com', 'Valid TLS control failed'
        assert isinstance(error.reason, ssl.SSLCertVerificationError), 'Failure was not certificate rejection'
    return {'context': mode, 'host': host, 'passed': True}
with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
    for result in pool.map(check, [(mode, host) for mode in ['bundle', 'default-directory', 'managed-default'] for host in hosts]):
        print(json.dumps(result), flush=True)
assert os.environ.get('SSL_CERT_DIR') == '/usr/local/share/security-ca/certs'
print('PASS: filtered bundle, inherited default directory and managed OpenSSL defaults')
PYTHON
