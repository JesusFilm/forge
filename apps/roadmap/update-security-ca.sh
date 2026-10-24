#!/bin/sh
# Remove both affected trust anchors before downloads and after CA-package updates.
set -eu
filter_ca() {
  if [ -f /etc/ca-certificates.conf ]; then
    sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf
    # update-ca-certificates --fresh alone preserves named PEM links to disabled roots.
    rm -f /usr/share/ca-certificates/mozilla/emSign_ECC_Root_CA_-_G3.crt \
      /usr/share/ca-certificates/mozilla/Comodo_AAA_Services_root.crt \
      /etc/ssl/certs/emSign_ECC_Root_CA_-_G3.pem \
      /etc/ssl/certs/Comodo_AAA_Services_root.pem
    update-ca-certificates --fresh
    find -L /etc/ssl/certs -type l -delete
  else
    # Slim images without CA tooling must not carry an unfiltered fallback bundle.
    test ! -f /etc/ssl/certs/ca-certificates.crt
  fi
}
filter_ca
printf '%s\n' 'PASS: base OS certificate policy applied before package downloads'
apt-get update
apt-get install -y --no-install-recommends ca-certificates openssl
filter_ca
ca_directory=/usr/local/share/security-ca/certs
mkdir -p "$ca_directory"
rm -f "$ca_directory"/*.pem "$ca_directory"/*.0
awk -v ca_directory="$ca_directory" '/-----BEGIN CERTIFICATE-----/ { n++; f=sprintf("%s/root-%03d.pem", ca_directory, n) } f != "" { print > f } /-----END CERTIFICATE-----/ { close(f); f="" }' /etc/ssl/certs/ca-certificates.crt
openssl rehash "$ca_directory"
