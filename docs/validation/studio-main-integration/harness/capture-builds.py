from pathlib import Path
import json,hashlib
out={}
for app in ['admin','web']:
 root=Path('apps')/app/'.next'
 record={'manifests':{},'staticJavaScript':[]}
 for name in ['BUILD_ID','app-path-routes-manifest.json','build-manifest.json','prerender-manifest.json','routes-manifest.json','server/app-paths-manifest.json']:
  p=root/name
  data=p.read_bytes()
  record['manifests'][name]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'contents':json.loads(data) if name.endswith('.json') else data.decode().strip()}
 for p in sorted((root/'static').rglob('*.js')):
  data=p.read_bytes()
  record['staticJavaScript'].append({'path':str(p.relative_to(root)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 record['totalStaticJsBytes']=sum(x['bytes'] for x in record['staticJavaScript'])
 record['qualification']='Output inventory, not per-route transferred bytes, hydration or deployed loading proof. Admin build uses declared local font CSS response fixture; Web uses declared local configuration.'
 out[app]=record
Path('../evidence/build-manifests.json').write_text(json.dumps(out,indent=2)+'\n')
print({k:{'staticJsFiles':len(v['staticJavaScript']),'totalBytes':v['totalStaticJsBytes']} for k,v in out.items()})
