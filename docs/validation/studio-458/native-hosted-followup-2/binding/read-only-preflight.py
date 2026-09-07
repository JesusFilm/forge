import json,pathlib,urllib.request,datetime
base=pathlib.Path('/tmp/forge-studio-458-prep');key=None
for line in (base/'private/manager.env').read_text().splitlines():
 if line.startswith('OPENROUTER_API_KEY='):key=line.split('=',1)[1].strip().strip('"').strip("'")
assert key
results={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requests':'GET only, no paid probes','secretValuesIncluded':False}
for name,url in [('key','https://openrouter.ai/api/v1/key'),('endpoints','https://openrouter.ai/api/v1/models/openai/gpt-5.4-mini/endpoints')]:
 request=urllib.request.Request(url,headers={'Authorization':'Bearer '+key},method='GET')
 with urllib.request.urlopen(request,timeout=30) as response:data=json.load(response);status=response.status
 if name=='key':
  d=data['data'];results[name]={'http':status,'is_free_tier':d.get('is_free_tier'),'limit':d.get('limit'),'limit_remaining':d.get('limit_remaining'),'is_management_key':d.get('is_management_key')}
 else:
  endpoints=[e for e in data['data']['endpoints'] if e['tag']=='openai']
  assert endpoints
  results[name]={'http':status,'model':data['data']['id'],'openai':[{'tag':e['tag'],'pricing':e['pricing'],'context_length':e.get('context_length'),'max_completion_tokens':e.get('max_completion_tokens'),'supported_parameters':e.get('supported_parameters')} for e in endpoints]}
  assert all(float(e['pricing']['prompt'])<=.75/1e6 and float(e['pricing']['completion'])<=4.5/1e6 for e in endpoints)
results['rateCheckPassed']=True
out=pathlib.Path('/tmp/forge-studio-458-prep/creative-followup-2/binding/read-only-preflight.json');out.write_text(json.dumps(results,indent=2));print('Read-only key/route/rates verified; sanitized evidence written; no paid request')
