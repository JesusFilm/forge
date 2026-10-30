set -eu
for host in dv-g3b-emudhra.we-have-a-problem.com dv-g3b-aaa-emudhra.we-have-a-problem.com www.google.com; do
 for store in bundle directory dedicated; do
  if [ "$store" = bundle ]; then set -- -CAfile /etc/ssl/certs/ca-certificates.crt -no-CApath -no-CAstore; elif [ "$store" = directory ]; then set -- -CApath /etc/ssl/certs -no-CAfile -no-CAstore; else set -- -CApath /usr/local/share/security-ca/certs -no-CAfile -no-CAstore; fi
  rc=0
  timeout 20 openssl s_client -connect "$host:443" -servername "$host" -verify_return_error "$@" </dev/null >/tmp/audit-tls-output 2>&1 || rc=$?
  printf 'TLS %s %s status=%s\n' "$host" "$store" "$rc"
  grep -E 'Verification:|Verify return code:|Verification error:' /tmp/audit-tls-output || true
 done
done
