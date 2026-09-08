from pathlib import Path
import json,time
b=Path('/home/tataihono/.cache/forge-studio-460-image-runtime')
parent='/user.slice/user-1000.slice/user@1000.service/app.slice/studio460-build-membership.scope'
cg=Path('/sys/fs/cgroup'+parent)
fields=['cpu.max','memory.max','memory.swap.max','pids.max','pids.current','memory.current','memory.peak','memory.events','cpu.stat','cgroup.procs']
def snap():return {k:(cg/k).read_text() for k in fields}
result={'parent':parent,'before':snap(),'observed':{},'violations':[]}
start=time.monotonic()
while time.monotonic()-start<3000:
 for state in (b/'run/runc').glob('*/state.json'):
  try:
   data=json.loads(state.read_text());pid=data['init_process_pid']
   actual=Path(f'/proc/{pid}/cgroup').read_text().strip()
   if data['id'] not in result['observed']:
    result['observed'][data['id']]={'pid':pid,'membership':actual,'cgroupPaths':data.get('cgroup_paths'),'parentSnapshot':snap()}
   if not actual.startswith('0::'+parent+'/'):result['violations'].append({'id':data['id'],'membership':actual})
  except (FileNotFoundError,json.JSONDecodeError):pass
 if (b/'builder-full-monitor-stop').exists():break
 time.sleep(.05)
result['after']=snap();result['elapsedSeconds']=time.monotonic()-start
(b/'evidence/builder-membership-observed.json').write_text(json.dumps(result,indent=2)+'\n')
print('observed executors',len(result['observed']),'violations',result['violations'])
assert result['observed'] and not result['violations']
