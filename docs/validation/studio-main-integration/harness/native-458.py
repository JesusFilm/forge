import os,sys,subprocess,socket,json,time
from pathlib import Path
b=Path('/home/tataihono/.local/share/forge/studio-462-main-integration')
subprocess.run(['ip','link','set','lo','up'],check=True)
for port in [5432,6379]:
 with socket.socket() as s:s.settimeout(.2);assert s.connect_ex(('127.0.0.1',port))!=0
assert not any((Path.cwd()/app/name).exists() for app in ['apps/admin','apps/web','apps/manager','apps/auth','apps/mastra'] for name in ['.env','.env.local'])
e={k:os.environ[k] for k in ['PATH','HOME'] if k in os.environ}
e.update(TMPDIR=str(b/'tmp'),CI='1',DATABASE_URL='postgresql://tataihono@127.0.0.1:55458/forge_studio_462_merge_test',REDIS_URL='redis://127.0.0.1:54630',NEXT_TELEMETRY_DISABLED='1',DD_TRACE_ENABLED='false',DD_INSTRUMENTATION_TELEMETRY_ENABLED='false',OTEL_SDK_DISABLED='true',ADMIN_SESSION_SECRET='studio462-owned-fixture-at-least-32-characters',AUTH_ISSUER_URL='http://127.0.0.1:55469',AUTH_ADMIN_CLIENT_ID='studio462-fixture',STUDIO_PRODUCTION_ENABLED='true',STUDIO_PUBLICATION_ENABLED='true')
e.update(WATCH_SEARCH_DB_TEST='1')
pg=Path('/usr/lib/postgresql/18/bin')
assert not (b/'pgdata/postmaster.pid').exists()
with socket.socket() as sock:sock.bind(('127.0.0.1',55458))
subprocess.run([str(pg/'pg_ctl'),'-D',str(b/'pgdata'),'-l',str(b/'logs/postgres.log'),'-o',f'-h127.0.0.1 -p55458 -k{b}/tmp','-w','start'],check=True,env=e,stdout=subprocess.DEVNULL)
e['STUDIO_TEST_DATABASE_URL']='postgresql://tataihono@127.0.0.1:55458/forge_studio_458_test'
subprocess.run([str(pg/'createdb'),'-h','127.0.0.1','-p','55458','-U','tataihono','forge_studio_458_test'],check=True,env=e)
try:
 name=sys.argv[1];start=time.monotonic()
 with (b/'logs'/f'{name}.log').open('w') as f:r=subprocess.run(sys.argv[2:],env=e,stdout=f,stderr=subprocess.STDOUT)
 (b/'evidence'/f'{name}.json').write_text(json.dumps({'args':sys.argv[2:],'exit':r.returncode,'seconds':time.monotonic()-start},indent=2)+'\n')
 print(name,r.returncode,flush=True)
finally:
 subprocess.run([str(pg/'pg_ctl'),'-D',str(b/'pgdata'),'-m','fast','-w','stop'],check=True,env=e,stdout=subprocess.DEVNULL)
sys.exit(r.returncode)
