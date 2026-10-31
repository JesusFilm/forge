#!/bin/sh
# Nixpacks' bundled Node package can lag the supported security release.
set -eu
case "$(uname -m)" in
  x86_64) arch=x64; checksum=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 ;;
  aarch64|arm64) arch=arm64; checksum=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e ;;
  *) echo 'Unsupported Node distribution architecture' >&2; exit 1 ;;
esac
apt-get update
apt-get install -y --no-install-recommends ca-certificates
sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf
update-ca-certificates --fresh
archive="node-v24.22.1-linux-$arch.tar.xz"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --silent --show-error --location --cacert /etc/ssl/certs/ca-certificates.crt "https://nodejs.org/dist/v24.22.1/$archive" -o "$work/$archive"
printf '%s  %s\n' "$checksum" "$work/$archive" | sha256sum --check --strict
mkdir -p /opt/forge-node
tar -xJf "$work/$archive" --strip-components=1 -C /opt/forge-node
export PATH="/opt/forge-node/bin:$PATH"
node -e 'if (process.version !== "v24.22.1") process.exit(1)'
corepack enable
corepack prepare pnpm@9.12.3 --activate
