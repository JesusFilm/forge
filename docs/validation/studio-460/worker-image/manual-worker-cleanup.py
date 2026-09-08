from pathlib import Path
import json,subprocess,time
b=Path.cwd(); records=[]
for number,pid,parent in [(1,101590,101571),(2,108997,108983),(3,142339,142327)]:
 name=f'studio460-worker-image{number}';expected='/user.slice/user-1000.slice/user@1000.service/app.slice/'+name;cg=Path('/sys/fs/cgroup'+expected)
 assert Path(f'/proc/{pid}/cgroup').read_text().strip()=='0::'+expected
 prefix=['nsenter',f'--user=/proc/{parent}/ns/user',str(b/'buildkit/bin/buildkit-runc'),'--root',str(b/'run/worker-runtime-runc'),'--rootless=true']
 def command(args):
  r=subprocess.run(prefix+args,capture_output=True,text=True,timeout=8);return {'code':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
 record={'name':name,'pid':pid,'beforeMembers':(cg/'cgroup.procs').read_text(),'beforeThreads':(cg/'cgroup.threads').read_text(),'runcState':command(['state',name]),'signal':command(['kill',name,'TERM'])}
 end=time.monotonic()+5
 while Path(f'/proc/{pid}').exists() and time.monotonic()<end:time.sleep(.1)
 if (cg/'cgroup.procs').exists() and (cg/'cgroup.procs').read_text().strip():
  (cg/'cgroup.kill').write_text('1');record['forcedOwnedCgroupKill']=True
  time.sleep(.5)
 record['pidExistsAfter']=Path(f'/proc/{pid}').exists();record['cgroupExistsAfter']=cg.exists();record['membersAfter']=(cg/'cgroup.procs').read_text() if cg.exists() else None
 records.append(record)
(b/'evidence/worker-manual-cleanup.json').write_text(json.dumps(records,indent=2)+'\n')
assert all(not d['pidExistsAfter'] and not d['membersAfter'] for d in records),records
print('Three exact owned worker instances stopped; no original PID or remaining leaf member. Manual cleanup only.')
