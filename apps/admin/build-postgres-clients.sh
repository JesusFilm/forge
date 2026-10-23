#!/bin/sh
set -eu
apt-get update
apt-get install -y --no-install-recommends build-essential bison flex curl bzip2 libssl-dev zlib1g-dev libreadline-dev liblz4-dev libzstd-dev libicu-dev
cd /tmp
curl --fail --show-error --location https://ftp.postgresql.org/pub/source/v18.6/postgresql-18.6.tar.bz2 -o postgresql.tar.bz2
printf '%s  %s\n' 555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f postgresql.tar.bz2 | sha256sum --check -
tar -xjf postgresql.tar.bz2
cd postgresql-18.6
./configure --prefix=/opt/forge-postgres --with-ssl=openssl --with-lz4 --with-zstd
make -j4
make -C src/bin install
make -C src/include install
make -C src/interfaces install
