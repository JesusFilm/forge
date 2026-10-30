FROM ghcr.io/railwayapp-templates/postgres-ssl@sha256:8dcde23134ad2ca318bc4caad004b0a15f820be52ce16e8f05c4fd6fd9232976
COPY update-security-ca.sh /usr/local/bin/audit-update-security-ca
RUN sh /usr/local/bin/audit-update-security-ca
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
