FROM ghcr.io/railwayapp-templates/postgres-ssl@sha256:8dbbfcb7fafacc22c01dc0c425c38793b5d0449163a3d178d3e3767d43e6f3ee
COPY update-security-ca.sh /usr/local/bin/audit-update-security-ca
RUN sh /usr/local/bin/audit-update-security-ca
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
