"""One release-specific aggregate check; default prepares without dispatch."""
import argparse
import datetime
import hashlib
import json
import pathlib
import shlex
import subprocess

SQL = """
WITH recent AS MATERIALIZED (
 SELECT locale FROM recommendation_request
 WHERE created_at >= CURRENT_TIMESTAMP - interval '24 hours'
 AND created_at <= CURRENT_TIMESTAMP
 ORDER BY created_at DESC, id DESC LIMIT 20001
), latest_retention AS (
 SELECT status, roots_deleted, started_at, completed_at, oldest_expired_at_after,
 reason_code FROM recommendation_retention_run
 WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1
)
SELECT jsonb_build_object(
 'measuredAt',clock_timestamp(), 'readOnly',current_setting('transaction_read_only'),
 'lockWaiters',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
 AND pid<>pg_backend_pid() AND wait_event_type='Lock'),
 'longTransactions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
 AND pid<>pg_backend_pid() AND xact_start < CURRENT_TIMESTAMP-interval '30 seconds'),
 'residentWalBytes',(SELECT coalesce(sum(size),0) FROM pg_ls_waldir()),
 'replicationSlots',(SELECT count(*) FROM pg_replication_slots),
 'slotRetainedWalBytes',(SELECT coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)),0) FROM pg_replication_slots),
 'recentRequests',(SELECT count(*) FROM recent),
 'recentEnglishRequests',(SELECT count(*) FROM recent WHERE locale='en'),
 'requestCapReached',(SELECT count(*)>20000 FROM recent),
 'graphGenerations',(SELECT count(*) FROM (SELECT id FROM recommendation_cowatch_generation LIMIT 1001) bounded),
 'ownerReleases',(SELECT count(*) FROM (SELECT id FROM recommendation_owner_release LIMIT 1001) bounded),
 'graphAllocatedBytes',(SELECT sum(pg_total_relation_size(name::regclass)) FROM unnest(ARRAY[
 'recommendation_cowatch_generation','recommendation_cowatch_source_contribution',
 'recommendation_cowatch_contribution','recommendation_cowatch_edge']) name),
 'ownerAllocatedBytes',pg_total_relation_size('recommendation_owner_release'),
 'latestRetention',(SELECT to_jsonb(latest_retention) FROM latest_retention),
 'oldestExpiredRequest',(SELECT expires_at FROM recommendation_request WHERE expires_at<=CURRENT_TIMESTAMP ORDER BY expires_at,id LIMIT 1)
);
"""

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute-production-read', action='store_true')
    parser.add_argument('--include-database-bytes', action='store_true')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    sql = SQL
    if args.include_database_bytes:
        sql = sql.replace("'measuredAt',clock_timestamp()", "'databaseBytes',pg_database_size(current_database()), 'walInsertLsn',pg_current_wal_lsn(), 'tempBytesCumulative',(SELECT temp_bytes FROM pg_stat_database WHERE datname=current_database()), 'measuredAt',clock_timestamp()")
    out = pathlib.Path(args.output)
    if out.exists():
        raise SystemExit('Refused existing receipt path')
    report = {'purpose': 'one bounded release-specific aggregate operational admission',
              'sqlSha256': hashlib.sha256(sql.encode()).hexdigest(),
              'productionExecuted': False, 'dataMutations': 0,
              'sourcePopulationQueries': 0, 'rawOutputRetained': False}
    if args.execute_production_read:
        remote = "PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000 -c timezone=UTC' psql -X -U \"$PGUSER\" -d \"$PGDATABASE\" -Atq -v ON_ERROR_STOP=1 -c " + shlex.quote(sql) + " && df -B1 --output=size,used,avail,pcent \"$PGDATA\""
        try:
            report['productionExecuted'] = True
            result = subprocess.run(['/home/nisal/.cache/pnpm/dlx/fn4qp76b3sbipnjiogg4ezmrim/1a0eeba5094-254fda/node_modules/.bin/railway','ssh','--project','98952497-a4d9-4714-8fe8-0cdbff3147c9','--environment','production','--service','2a2edd87-6748-4029-a94a-b8e1a0227ba4','--',remote], capture_output=True,text=True,timeout=30)
            assert result.returncode == 0 and len(result.stdout) < 16384
            lines = result.stdout.splitlines()
            health = next(json.loads(line) for line in lines if line.startswith('{'))
            assert health['readOnly'] == 'on'
            filesystem = next(line.split() for line in reversed(lines) if len(line.split())==4 and all(x.isdigit() for x in line.split()[:3]) and line.split()[3].endswith('%'))
            report.update(status='observed',health=health,filesystem=dict(zip(['totalBytes','usedBytes','availableBytes','usePercent'],[int(x) for x in filesystem[:3]]+[filesystem[3]])))
        except Exception as error:
            report.update(status='refused',errorClass=type(error).__name__)
    else:
        report['status'] = 'prepared_without_dispatch'
    report['recordedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with out.open('x') as handle:
        json.dump(report, handle, indent=2)
        handle.write('\n')
    print(json.dumps(report))

if __name__ == '__main__':
    main()
