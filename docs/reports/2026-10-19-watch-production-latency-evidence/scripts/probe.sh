#!/usr/bin/env bash
# Bounded passive probe: N sequential GETs, spaced, recording timing + cache headers.
# Usage: probe.sh <url> <count> <spacing_s> <outfile>
url=$1; n=$2; gap=$3; out=$4
for i in $(seq 1 "$n"); do
  start=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
  hdr=$(mktemp)
  m=$(curl -s -o /dev/null -D "$hdr" --max-time 45 \
    -A "forge-feat745-probe/1.0 (read-only latency sample)" \
    -w '%{http_code} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download}' "$url")
  cache=$(grep -i '^x-nextjs-cache:' "$hdr" | tr -d '\r' | awk '{print $2}')
  rid=$(grep -i '^x-railway-request-id:' "$hdr" | tr -d '\r' | awk '{print $2}')
  edge=$(grep -i '^x-railway-edge:' "$hdr" | tr -d '\r' | awk '{print $2}')
  cf=$(grep -i '^cf-cache-status:' "$hdr" | tr -d '\r' | awk '{print $2}')
  age=$(grep -i '^age:' "$hdr" | tr -d '\r' | awk '{print $2}')
  echo "$start url=$url status=$m x-nextjs-cache=${cache:-none} cf=${cf:-none} age=${age:-none} edge=${edge:-none} railway_request_id=${rid:-none}" | tee -a "$out"
  rm -f "$hdr"
  [ "$i" -lt "$n" ] && sleep "$gap"
done
