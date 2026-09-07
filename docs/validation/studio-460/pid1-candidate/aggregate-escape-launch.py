import os,resource,ctypes
resource.setrlimit(resource.RLIMIT_NPROC,(128,128));libc=ctypes.CDLL(None,use_errno=True)
assert libc.prctl(38,1,0,0,0)==0
os.execvp('unshare',['unshare','-U','--map-user=1000','--map-group=1000','python3','/tmp/forge-studio-460-prep/aggregate-escape.py'])
