set -eu
mkdir -p /tmp/data
/opt/typesense-server --data-dir=/tmp/data --api-key=audit-local-empty-fixture --api-address=127.0.0.1 --api-port=18108 --peering-address=127.0.0.1 --peering-port=18107 > /tmp/server.log 2>&1 &
server=$!
trap 'kill -TERM "$server" 2>/dev/null || true; wait "$server" || true' EXIT
request() {
 exec 3<>/dev/tcp/127.0.0.1/18108 || return 1
 printf 'GET %s HTTP/1.1\r\nHost: localhost\r\nX-TYPESENSE-API-KEY: audit-local-empty-fixture\r\nConnection: close\r\n\r\n' "$1" >&3
 cat <&3
 exec 3>&-
}
for ((i=0;i<60;i++));do
 if response=$(request /health 2>/dev/null) && [[ "$response" == *'200 OK'* ]] && [[ "$response" == *'"ok":true'* ]];then
  printf 'HEALTH_RESPONSE\n%s\n' "$response"
  collections=$(request /collections)
  printf 'EMPTY_COLLECTIONS_RESPONSE\n%s\n' "$collections"
  [[ "$collections" == *'200 OK'* ]] && [[ "$collections" == *'[]'* ]]
  exit 0
 fi
 kill -0 "$server" || { cat /tmp/server.log; exit 1; }
 sleep 1
done
cat /tmp/server.log
exit 1
