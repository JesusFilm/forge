FROM ghcr.io/railwayapp-templates/postgres-ssl@sha256:fcc6686a3f4f1962fe4ed77a15884553b7bd611ae1cea3204687968c5c09d517
COPY update-security-ca.sh /usr/local/bin/audit-update-security-ca
RUN sh /usr/local/bin/audit-update-security-ca
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
