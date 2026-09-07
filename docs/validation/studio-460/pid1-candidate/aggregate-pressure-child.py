import os,resource,ctypes,threading,signal,json,errno
libc=ctypes.CDLL(None,use_errno=True)
status={k:v.strip() for k,v in (line.split(':',1) for line in open('/proc/self/status') if ':' in line) if k in ['Uid','Gid','CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs']}
denied={}
for name,fn in [('uid',lambda:os.setuid(0)),('hard-limit',lambda:resource.setrlimit(resource.RLIMIT_NPROC,(129,129)))]:
 try:fn();denied[name]=False
 except (OSError,ValueError):denied[name]=True
for name,n,args in [('userns',272,(0x10000000,)),('clone-userns',56,(0x10000000|17,0,0,0,0)),('clone3',435,(0,0))]:
 result=libc.syscall(n,*args);denied[name]={'result':result,'errno':ctypes.get_errno()}
threads=[];stop=threading.Event();kids=[]
try:
 for i in range(24):
  t=threading.Thread(target=stop.wait);t.start();threads.append(t)
 while len(kids)<140:
  try:p=os.fork()
  except OSError as e:
   result={'realUid':os.getuid(),'effectiveUid':os.geteuid(),'status':status,'limit':resource.getrlimit(resource.RLIMIT_NPROC),'pthreadCount':len(threads),'forkChildren':len(kids),'forkErrno':e.errno,'denied':denied};print(json.dumps(result),flush=True);break
  if p==0:os.setsid();signal.pause();os._exit(0)
  kids.append(p)
 else:raise Exception('fork bound escaped')
finally:
 for p in kids:os.kill(p,9)
 for p in kids:os.waitpid(p,0)
 stop.set()
 for t in threads:t.join()
