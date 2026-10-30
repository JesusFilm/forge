FROM ghcr.io/railwayapp-templates/postgres-ssl@sha256:87184beace8ec657a760401a466a13c5b689066b31b77993103b4771933a9d31
COPY update-security-ca.sh /usr/local/bin/audit-update-security-ca
RUN sh /usr/local/bin/audit-update-security-ca
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
