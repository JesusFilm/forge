FROM ghcr.io/railwayapp-templates/postgres-ssl@sha256:0a458a815f2d12e6aad17d8abca4f956a60ca50adf12ac50ad4ce314015459af
COPY update-security-ca.sh /usr/local/bin/audit-update-security-ca
RUN sh /usr/local/bin/audit-update-security-ca
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
