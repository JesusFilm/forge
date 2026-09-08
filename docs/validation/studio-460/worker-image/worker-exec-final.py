import pathlib,subprocess,sys
b=pathlib.Path('/home/tataihono/.cache/forge-studio-460-image-runtime')
pid=int((b/'worker-container.pid').read_text())
parent=next(line.split()[1] for line in pathlib.Path(f'/proc/{pid}/status').read_text().splitlines() if line.startswith('PPid:'))
if sys.argv[1]=='http':
 command=['nsenter',f'--user=/proc/{parent}/ns/user',f'--net=/proc/{pid}/ns/net','/home/tataihono/.local/bin/node',str(b/'worker-http-smoke.mjs')]
else:
 code=(b/'worker-module-smoke.mjs').read_text()
 command=['nsenter',f'--user=/proc/{parent}/ns/user',str(b/'buildkit/bin/buildkit-runc'),'--root',str(b/'run/worker-runtime-runc'),'--rootless=true','exec','studio460-worker-image3','/usr/local/bin/node','--input-type=module','-e',code]
subprocess.run(command,check=True,timeout=150)
