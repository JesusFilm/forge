#!/bin/sh
set -eu
apt-get update
apt-get install -y --no-install-recommends ca-certificates libnss3-tools
sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf
update-ca-certificates --fresh
# Remove the packaged copies too: regenerating the inherited directory must
# never restore these excluded trust anchors from /usr/share.
rm -f /usr/share/ca-certificates/mozilla/emSign_ECC_Root_CA_-_G3.crt \
    /usr/share/ca-certificates/mozilla/Comodo_AAA_Services_root.crt \
    /etc/ssl/certs/emSign_ECC_Root_CA_-_G3.pem \
    /etc/ssl/certs/Comodo_AAA_Services_root.pem
openssl rehash /etc/ssl/certs
ca_directory=/usr/local/share/security-ca/certs
mkdir -p "$ca_directory"
awk -v ca_directory="$ca_directory" '/-----BEGIN CERTIFICATE-----/ { n++; f=sprintf("%s/root-%03d.pem", ca_directory, n) } f != "" { print > f } /-----END CERTIFICATE-----/ { close(f); f="" }' /etc/ssl/certs/ca-certificates.crt
openssl rehash "$ca_directory"
# Chromium has an independent trust store. Mark both known signed forms of the
# compromised intermediate as prohibited; this never adds a trusted authority.
distrust_directory=/usr/local/share/analytics-watcher/distrust
for entry in 'emsign-g3b.pem:42C4ACCD12C4F59597925E1A08A7A90102608543809308D50EC427E118BA1493' 'aaa-g3b.pem:45A883F349AEDFD5F3A649B5498FFB121712BA8B448F3F2A91DBC5A766FCDDBE'; do
  certificate=${entry%%:*}
  expected=${entry#*:}
  actual=$(openssl x509 -in "$distrust_directory/$certificate" -outform DER | sha256sum | cut -d ' ' -f 1 | tr '[:lower:]' '[:upper:]')
  test "$actual" = "$expected"
done
for browser_home in /root /home/pwuser; do
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
chown -R pwuser:pwuser /home/pwuser/.pki /home/pwuser/.local/share/pki
rm -rf /var/lib/apt/lists/*
