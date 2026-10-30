set -eu
bindir="$1"
mkdir -p /tmp/data /tmp/socket
"$bindir/postgres" --version
"$bindir/initdb" -D /tmp/data -U audit --no-locale --encoding=UTF8 --auth=trust > /tmp/initdb.log
"$bindir/pg_ctl" -D /tmp/data -o "-c listen_addresses='' -c unix_socket_directories=/tmp/socket -c ssl=off" -l /tmp/server.log -w start
trap '"$bindir/pg_ctl" -D /tmp/data -m fast -w stop' EXIT
"$bindir/psql" -h /tmp/socket -U audit -d postgres -v ON_ERROR_STOP=1 -Atc 'SELECT version(); SELECT 1;'
