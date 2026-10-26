#!/bin/sh
set -eu
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
# Official 7.1 maintenance release, verified against the FFmpeg release signing
# key FCF986EA15E6E293A5644F10B4322F04D67658D8 before recording this checksum.
curl --fail --silent --show-error --location --retry 3 \
  https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz -o ffmpeg.tar.xz
printf '%s  %s\n' de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f ffmpeg.tar.xz \
  | sha256sum --check --status
tar -xf ffmpeg.tar.xz
cd ffmpeg-7.1.5
# The CLI option is not inherited by nested HLS playlist/key/segment requests
# in this release. Enforce peer verification at the native protocol default,
# covering those requests too. Manager also requires MP3 encoding for audio cleanup.
grep '"tls_verify"' libavformat/tls.h | grep -F '.i64 = 0' >/dev/null
sed -i '/"tls_verify"/s/\.i64 = 0/.i64 = 1/' libavformat/tls.h
grep '"tls_verify"' libavformat/tls.h | grep -F '.i64 = 1' >/dev/null
./configure --prefix=/opt/security-ffmpeg \
  --disable-shared --enable-static --disable-doc --disable-debug --disable-ffplay \
  --disable-autodetect --enable-gnutls --enable-gpl --enable-libx264 --enable-libmp3lame --enable-zlib
make -j2
make install
