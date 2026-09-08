import os,sys,subprocess,socket,json,time
from pathlib import Path
b=Path('/home/tataihono/.local/share/forge/studio-462-main-integration')
subprocess.run(['ip','link','set','lo','up'],check=True)
for port in [5432,6379]:
 with socket.socket() as s:s.settimeout(.2);assert s.connect_ex(('127.0.0.1',port))!=0
assert not any((Path.cwd()/app/name).exists() for app in ['apps/admin','apps/web','apps/manager','apps/auth','apps/mastra'] for name in ['.env','.env.local'])
e={k:os.environ[k] for k in ['PATH','HOME'] if k in os.environ}
e.update(TMPDIR=str(b/'tmp'),CI='1',DATABASE_URL='postgresql://tataihono@127.0.0.1:55463/forge_studio_462_merge_test',REDIS_URL='redis://127.0.0.1:54630',NEXT_TELEMETRY_DISABLED='1',DD_TRACE_ENABLED='false',DD_INSTRUMENTATION_TELEMETRY_ENABLED='false',OTEL_SDK_DISABLED='true',ADMIN_SESSION_SECRET='studio462-owned-fixture-at-least-32-characters',AUTH_ISSUER_URL='http://127.0.0.1:55469',AUTH_ADMIN_CLIENT_ID='studio462-fixture',STUDIO_PRODUCTION_ENABLED='true',STUDIO_PUBLICATION_ENABLED='true')
e.pop('AUTH_ISSUER_URL',None)
e.pop('AUTH_ADMIN_CLIENT_ID',None)
name=sys.argv[1];start=time.monotonic()
with (b/'logs'/f'{name}.log').open('w') as f:r=subprocess.run(sys.argv[2:],env=e,stdout=f,stderr=subprocess.STDOUT)
(b/'evidence'/f'{name}.json').write_text(json.dumps({'args':sys.argv[2:],'exit':r.returncode,'seconds':time.monotonic()-start,'namespace':os.readlink('/proc/self/ns/net')},indent=2)+'\n')
print(name,r.returncode,flush=True)
sys.exit(r.returncode)
