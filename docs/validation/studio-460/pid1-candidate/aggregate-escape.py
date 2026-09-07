import os,resource,ctypes,json,threading,time,signal
libc=ctypes.CDLL(None,use_errno=True)
# This runs as the supervisor identity under the same inherited 128 hard limit.
# Reserve threads first; children in a descendant user namespace must count too.
threads=[];stop=threading.Event()
for i in range(24):
 t=threading.Thread(target=stop.wait);t.start();threads.append(t)
r,w=os.pipe();pid=os.fork()
if pid==0:
 os.close(r)
 try:
  if libc.unshare(0x10000000):raise OSError(ctypes.get_errno(),'unshare')
  open('/proc/self/setgroups','w').write('deny')
  open('/proc/self/uid_map','w').write('1000 1000 1')
  open('/proc/self/gid_map','w').write('1000 1000 1')
  kids=[]
  try:
   while len(kids)<140:
    try:p=os.fork()
    except OSError as e:
     os.write(w,json.dumps({'children':len(kids),'errno':e.errno,'limit':resource.getrlimit(resource.RLIMIT_NPROC)}).encode());break
    if p==0:signal.pause();os._exit(0)
    kids.append(p)
   else:os.write(w,b'ESCAPED')
  finally:
   for p in kids:os.kill(p,9)
   for p in kids:os.waitpid(p,0)
 except Exception as e:os.write(w,str(e).encode())
 os._exit(0)
os.close(w)
try:
 report=os.read(r,4096).decode();os.waitpid(pid,0);print(report,flush=True)
 data=json.loads(report);assert data['errno']==11;assert data['children']<104
finally:
 stop.set()
 for t in threads:t.join()
