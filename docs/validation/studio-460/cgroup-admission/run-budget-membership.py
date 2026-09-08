from pathlib import Path
import json,base64,subprocess,sys,os
b=Path('/home/tataihono/.cache/forge-studio-460-image-runtime')
r=Path('/home/tataihono/.cache/forge-studio-460-image-worktree')
scenario,run=sys.argv[1:]
assert scenario in ['own','unrelated','overlaid']
name='studio460-budget-'+scenario+run
bundle=b/('budget-'+scenario+run);bundle.mkdir()
c=json.loads((b/'worker-oci-bundle/config.json').read_text())
c['root']['path']=str(b/'worker-oci-bundle/rootfs')
code=(r/'apps/studio-render/test/budget-membership.test.mjs').read_text()
url='data:text/javascript;base64,'+base64.b64encode((r/'apps/studio-render/src/budget.mjs').read_bytes()).decode()
code=code.replace('../src/budget.mjs',url)
c['process']['args']=['/usr/local/bin/node','--input-type=module','-e',code]
c['process']['env']=['PATH=/usr/local/bin:/usr/bin:/bin','STUDIO_CGROUP_MEMBERSHIP_CASE='+scenario]
c['process']['cwd']='/'
path='/user.slice/user-1000.slice/user@1000.service/app.slice/'+name
c['linux']['cgroupsPath']=path
for m in c['mounts']:
 if m['destination']=='/sys/fs/cgroup':m['source']='/sys/fs/cgroup'+path+('.scope' if scenario!='own' else '')
if scenario=='overlaid': c['mounts'].append({'destination':'/sys/fs/cgroup/cgroup.procs','source':'/sys/fs/cgroup'+path+'/cgroup.procs','type':'none','options':['bind','ro','nosuid','nodev','noexec']})
(bundle/'config.json').write_text(json.dumps(c,indent=2)+'\n')
command=['systemd-run','--user','--scope','--unit='+name,'--property=CPUQuota=200%','--property=MemoryMax=2G','--property=MemorySwapMax=0','--property=TasksMax=128','unshare','--user','--map-auto','--map-root-user','--mount','--fork',str(b/'buildkit/bin/buildkit-runc'),'--root',str(b/'run/budget-runc'),'--rootless=true','run','--bundle',str(bundle),name]
result=subprocess.run(command,timeout=90)
sys.exit(result.returncode)
