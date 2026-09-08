#!/usr/bin/python3
# Task-local builder adapter: preserve OCI sandbox; constrain only cgroup placement.
import sys,os,json,pathlib,hashlib
b=pathlib.Path('/home/tataihono/.cache/forge-studio-460-image-runtime')
args=sys.argv[1:]
if 'run' in args:
 index=args.index('--bundle');bundle=pathlib.Path(args[index+1]).resolve()
 assert bundle.parent==b/'cache/runc-native/executor',bundle
 config=bundle/'config.json';spec=json.loads(config.read_text())
 parent=next(s[3:] for s in pathlib.Path('/proc/self/cgroup').read_text().splitlines() if s.startswith('0::'))
 assert parent.endswith('/studio460-build-membership.scope'),parent
 cg=pathlib.Path('/sys/fs/cgroup'+parent)
 expected={'memory.max':'2147483648','memory.swap.max':'0','pids.max':'512','cpu.max':'200000 100000'}
 assert all((cg/k).read_text().strip()==v for k,v in expected.items())
 assert spec['linux'].get('cgroupsPath','')=='',spec['linux'].get('cgroupsPath')
 assert spec['linux'].get('resources') is None
 before=json.dumps(spec,sort_keys=True)
 target=parent+'/'+bundle.name
 spec['linux']['cgroupsPath']=target
 config.write_text(json.dumps(spec)+'\n')
 audit={'id':bundle.name,'driverMembership':parent,'newCgroupsPath':target,'oldCgroupsPath':'','parentLimits':expected,'originalSpecSha256':hashlib.sha256(before.encode()).hexdigest(),'newSpecSha256':hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest(),'changedFields':['linux.cgroupsPath']}
 (b/'evidence'/('builder-config-'+bundle.name+'.json')).write_text(json.dumps(audit,indent=2)+'\n')
os.execv(str(b/'buildkit/bin/buildkit-runc'),[str(b/'buildkit/bin/buildkit-runc'),'--root',str(b/'run/runc'),*args])
