import{spawn}from'node:child_process';
spawn('/usr/bin/python3',['-c','import os,signal,time;os.setsid();pid=os.fork();signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'],{stdio:'ignore'});setInterval(()=>{},1000);
