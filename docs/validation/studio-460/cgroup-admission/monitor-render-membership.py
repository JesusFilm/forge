from pathlib import Path
import json,time
b=Path('/home/tataihono/.cache/forge-studio-460-image-runtime')
pid=int((b/'render-own1/container.pid').read_text())
expected='/user.slice/user-1000.slice/user@1000.service/app.slice/studio460-render-own1'
cg=Path('/sys/fs/cgroup'+expected)
fields=['cpu.max','memory.max','memory.swap.max','pids.max','pids.current','pids.events','memory.current','memory.peak','memory.events','cpu.stat','cgroup.procs','cgroup.threads']
def snap():return {name:(cg/name).read_text() for name in fields}
result={'pid':pid,'expected':expected,'before':snap(),'ancestors':{},'observed':{},'violations':[],'observedThreads':{}}
for parent in [cg,*cg.parents]:
 if not str(parent).startswith('/sys/fs/cgroup'):break
 result['ancestors'][str(parent)]={name:(parent/name).read_text() for name in ['cpu.max','memory.max','memory.swap.max','pids.max'] if (parent/name).exists()}
start=time.monotonic()
while time.monotonic()-start<80:
 for entry in Path(f'/proc/{pid}/root/proc').iterdir():
  if not entry.name.isdigit():continue
  try:
   member=(entry/'cgroup').read_text().strip()
   command=(entry/'comm').read_text().strip()
   status='\n'.join(s for s in (entry/'status').read_text().splitlines() if s.startswith(('Pid:','NSpid:','Uid:','Gid:','Cap','NoNewPrivs:','Threads:')))
   for task in (entry/'task').iterdir():
    try:
     tm=(task/'cgroup').read_text().strip()
     result['observedThreads'][entry.name+':'+task.name]=tm
     if tm!='0::'+expected and not tm.startswith('0::'+expected+'/'):result['violations'].append({'thread':task.name,'member':tm})
    except FileNotFoundError:pass
   key=entry.name+':'+command
   result['observed'][key]={'membership':member,'status':status}
   if member!='0::'+expected and not member.startswith('0::'+expected+'/'):result['violations'].append({'pid':entry.name,'member':member})
  except FileNotFoundError:pass
 if (b/'render-membership-monitor-stop').exists():break
 time.sleep(.05)
result['elapsedSeconds']=time.monotonic()-start;result['after']=snap()
(b/'evidence/render-membership-observed.json').write_text(json.dumps(result,indent=2)+'\n')
assert not result['violations'],result['violations']
print('observed',len(result['observed']),'namespace processes; no sampled membership violations')
