import os,sys,json,subprocess,ctypes,resource
spec=json.load(open(sys.argv[1])); root=spec['root']
def run(*args): subprocess.run(args,check=True)
run('mount','--make-rprivate','/')
run('mount','-t','tmpfs','-o','size=32m','tmpfs',root)
for source,target in spec['mounts']:
 dest=root+target
 os.makedirs(os.path.dirname(dest),exist_ok=True)
 if os.path.isdir(source):os.makedirs(dest,exist_ok=True)
 else:open(dest,'a').close()
 run('mount','--rbind',source,dest)
 run('mount','-o','remount,bind,ro',dest)
for name in ['proc','dev','work','old','tmp']:os.makedirs(root+'/'+name,exist_ok=True)
run('mount','-t','proc','proc',root+'/proc')
run('mount','-t','tmpfs','-o','size=8m','tmpfs',root+'/dev')
for name in ['null','zero','full','random','urandom','tty']:
 dest=root+'/dev/'+name;open(dest,'a').close();run('mount','--bind','/dev/'+name,dest)
run('mount','-t','tmpfs','-o','size=256m','tmpfs',root+'/work')
run('mount','-t','tmpfs','-o','size=8m','tmpfs',root+'/tmp')
os.symlink('usr/bin',root+'/bin')
os.chdir(root)
libc=ctypes.CDLL(None,use_errno=True)
if libc.syscall(155,b'.',b'old')!=0:raise OSError(ctypes.get_errno(),'pivot_root')
os.chdir('/')
if libc.umount2(b'/old',2)!=0:raise OSError(ctypes.get_errno(),'umount old')
os.rmdir('/old')
resource.setrlimit(resource.RLIMIT_NPROC,(128,128))
if libc.prctl(38,1,0,0,0):raise OSError(ctypes.get_errno(),'no_new_privs')
os.execve('/usr/bin/unshare',['unshare','-U','--map-user=1000','--map-group=1000','/runtime/node','/opt/studio-render/main.mjs'],spec['env'])
