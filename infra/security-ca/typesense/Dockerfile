FROM docker.io/typesense/typesense@sha256:610f2d34b1f93d00762869da2c67736775e5798d19a2c8b91b014b8a0cc1e110
COPY update-security-ca.sh /usr/local/bin/audit-update-security-ca
RUN sh /usr/local/bin/audit-update-security-ca
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
