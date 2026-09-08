import os, subprocess, socket, json, time, hashlib
from pathlib import Path
base=Path('/home/tataihono/.local/share/forge/studio-462-main-integration')
repo=Path.cwd()
pg=Path('/usr/lib/postgresql/18/bin')
url='postgresql://tataihono@127.0.0.1:55463/forge_studio_462_merge_test'
env={k:os.environ[k] for k in ['PATH','HOME'] if k in os.environ}
env.update(TMPDIR=str(base/'tmp'),DATABASE_URL=url,CI='1',NEXT_TELEMETRY_DISABLED='1',DD_TRACE_ENABLED='false',OTEL_SDK_DISABLED='true',REDIS_URL='redis://127.0.0.1:54629',ADMIN_SESSION_SECRET='studio462-local-fixture-secret-at-least-32',AUTH_ISSUER_URL='http://127.0.0.1:55469',AUTH_ADMIN_CLIENT_ID='studio462-fixture')
results=[]
def run(name,args,allowed=(0,)):
 start=time.monotonic()
 with (base/'logs'/f'{name}.log').open('w') as f:
  r=subprocess.run(args,env=env,stdout=f,stderr=subprocess.STDOUT)
 results.append(dict(name=name,exit=r.returncode,seconds=round(time.monotonic()-start,3)))
 (base/'evidence/results.json').write_text(json.dumps(results,indent=2)+'\n')
 print(name,r.returncode,flush=True)
 if r.returncode not in allowed: raise RuntimeError(name)
try:
 subprocess.run(['ip','link','set','lo','up'],check=True)
 for port in [5432,6379]:
  with socket.socket() as s:
   s.settimeout(.2)
   assert s.connect_ex(('127.0.0.1',port))!=0, f'default port {port} reachable'
 with socket.socket() as s:s.bind(('127.0.0.1',55463))
 assert not (base/'pgdata').exists(), 'fresh cluster required'
 for name in ['.env','.env.local']:
  assert not (repo/'apps/admin'/name).exists(), 'no dotenv overlays allowed'
 (base/'evidence/preflight.json').write_text(json.dumps(dict(uid=os.getuid(),networkNamespace=os.readlink('/proc/self/ns/net'),portsDenied=[5432,6379],ownedPortAvailable=55463,database=url,freshCluster=True,telemetryDisabled=True),indent=2)+'\n')
 run('initdb',[str(pg/'initdb'),'-D',str(base/'pgdata'),'-U','tataihono','--auth=trust','--no-locale'])
 run('pg-start',[str(pg/'pg_ctl'),'-D',str(base/'pgdata'),'-l',str(base/'logs/postgres.log'),'-o',f'-h 127.0.0.1 -p 55463 -k {base}/tmp','-w','start'])
 run('createdb',[str(pg/'createdb'),'-h','127.0.0.1','-p','55463','-U','tataihono','forge_studio_462_merge_test'])
 run('migration-replay',['pnpm','--filter','@forge/admin','exec','prisma','migrate','deploy'])
 run('migration-status',['pnpm','--filter','@forge/admin','exec','prisma','migrate','status'])
 run('migration-schema-diff',['pnpm','--filter','@forge/admin','exec','prisma','migrate','diff','--from-url',url,'--to-schema-datamodel','prisma/schema.prisma','--script'])
 run('prisma-generate',['pnpm','--filter','@forge/admin','db:generate'])
 run('schema-print',['pnpm','--filter','@forge/admin','schema:print'])
 run('graphql-generate',['pnpm','--filter','@forge/admin-graphql','generate'])
 sql="SELECT migration_name,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back,checksum FROM _prisma_migrations ORDER BY migration_name; SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND (table_name LIKE 'studio_%' OR table_name LIKE 'content_pack%') ORDER BY table_name,ordinal_position; SELECT conrelid::regclass,conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid::regclass::text LIKE 'studio_%' ORDER BY 1,2;"
 run('database-inventory',[str(pg/'psql'),url,'-X','-v','ON_ERROR_STOP=1','-P','pager=off','-c',sql])



 run('main-createdb',[str(pg/'createdb'),'-h','127.0.0.1','-p','55463','-U','tataihono','forge_studio_462_main_upgrade'])
 env['DATABASE_URL']='postgresql://tataihono@127.0.0.1:55463/forge_studio_462_main_upgrade'
 run('main-ledger-replay',['pnpm','--filter','@forge/admin','exec','prisma','migrate','deploy','--schema',str(base/'main-prisma/schema.prisma')])
 run('main-to-merged-upgrade',['pnpm','--filter','@forge/admin','exec','prisma','migrate','deploy'])
 run('upgrade-status',['pnpm','--filter','@forge/admin','exec','prisma','migrate','status'])
 run('upgrade-ledger',[str(pg/'psql'),env['DATABASE_URL'],'-X','-v','ON_ERROR_STOP=1','-P','pager=off','-c','SELECT migration_name,finished_at IS NOT NULL,rolled_back_at IS NOT NULL,checksum FROM _prisma_migrations ORDER BY migration_name'])

finally:
 if (base/'pgdata/postmaster.pid').exists():
  run('pg-stop',[str(pg/'pg_ctl'),'-D',str(base/'pgdata'),'-m','fast','-w','stop'])
