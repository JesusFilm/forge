#!/bin/sh
# CA-store-only image maintenance. Preserve database binaries and startup.
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates
sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf
update-ca-certificates --fresh
for certificate in emSign_ECC_Root_CA_-_G3 Comodo_AAA_Services_root; do
  printf '%s\n' '# Distrusted security root; marker prevents lower-image certificate data from restoring trust.' > "/usr/share/ca-certificates/mozilla/$certificate.crt"
  test ! -e "/etc/ssl/certs/$certificate.pem"
done
ca_directory=/usr/local/share/security-ca/certs
rm -rf "$ca_directory"
mkdir -p "$ca_directory"
awk -v ca_directory="$ca_directory" '/-----BEGIN CERTIFICATE-----/ { n++; f=sprintf("%s/root-%03d.pem", ca_directory, n) } f != "" { print > f } /-----END CERTIFICATE-----/ { close(f); f="" }' /etc/ssl/certs/ca-certificates.crt
openssl rehash "$ca_directory"
rm -rf /var/lib/apt/lists/*
