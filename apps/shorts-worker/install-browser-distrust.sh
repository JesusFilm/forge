#!/bin/sh
set -eu
# Chromium has an independent trust store. Mark both known signed forms of the
# compromised intermediate as prohibited; this never adds a trusted authority.
distrust_directory=/usr/local/share/devotional-worker/distrust
for entry in 'emsign-g3b.pem:42C4ACCD12C4F59597925E1A08A7A90102608543809308D50EC427E118BA1493' 'aaa-g3b.pem:45A883F349AEDFD5F3A649B5498FFB121712BA8B448F3F2A91DBC5A766FCDDBE'; do
  certificate=${entry%%:*}
  expected=${entry#*:}
  actual=$(openssl x509 -in "$distrust_directory/$certificate" -outform DER | sha256sum | cut -d ' ' -f 1 | tr '[:lower:]' '[:upper:]')
  test "$actual" = "$expected"
done
for browser_home in /root /home/node; do
  for database in "$browser_home/.pki/nssdb" "$browser_home/.local/share/pki/nssdb"; do
    mkdir -p "$database"
    if [ ! -f "$database/cert9.db" ]; then
      certutil -N --empty-password -d "sql:$database"
    fi
    for certificate in emsign-g3b.pem aaa-g3b.pem; do
      certutil -A -d "sql:$database" -n "compromised-$certificate" -t 'p,p,p' -i "$distrust_directory/$certificate"
    done
  done
done
chown -R node:node /home/node/.pki /home/node/.local/share/pki
