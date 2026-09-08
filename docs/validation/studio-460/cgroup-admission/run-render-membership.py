from pathlib import Path
import json,subprocess,sys
b=Path('/home/tataihono/.cache/forge-studio-460-image-runtime')
scenario,run=sys.argv[1:];assert scenario in ['own','unrelated','overlaid']
name='studio460-render-'+scenario+run
bundle=b/('render-'+scenario+run);bundle.mkdir()
c=json.loads((b/'oci-bundle/config.json').read_text())
c['root']['path']=str(b/'membership-oci-bundle/rootfs')
path='/user.slice/user-1000.slice/user@1000.service/app.slice/'+name
c['linux']['cgroupsPath']=path
c['linux']['resources']={'cpu':{'quota':200000,'period':100000},'memory':{'limit':2147483648,'swap':2147483648},'pids':{'limit':128}}
for m in c['mounts']:
 if m['destination']=='/sys/fs/cgroup':m['source']='/sys/fs/cgroup'+path+('.scope' if scenario!='own' else '')
if scenario=='overlaid':c['mounts'].append({'destination':'/sys/fs/cgroup/cgroup.procs','source':'/sys/fs/cgroup'+path+'/cgroup.procs','type':'none','options':['bind','ro','nosuid','nodev','noexec']})
(bundle/'config.json').write_text(json.dumps(c,indent=2)+'\n')
command=['systemd-run','--user','--scope','--unit='+name,'--property=CPUQuota=200%','--property=MemoryMax=2G','--property=MemorySwapMax=0','--property=TasksMax=128','timeout','--signal=TERM','--kill-after=3s','1200','unshare','--user','--map-auto','--map-root-user','--mount','--fork',str(b/'buildkit/bin/buildkit-runc'),'--root',str(b/'run/render-membership-runc'),'--rootless=true','run','--pid-file',str(bundle/'container.pid'),'--bundle',str(bundle),name]
result=subprocess.run(command);sys.exit(result.returncode)
