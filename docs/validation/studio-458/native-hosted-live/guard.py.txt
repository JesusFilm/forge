"""Task-local verification guard, not a second application execution ledger."""
import hashlib,json,sqlite3,secrets
class Rejected(Exception): pass
class Guard:
 def __init__(self,path,proposal):
  self.path=path; self.proposal=proposal
  self.db=sqlite3.connect(path,timeout=30,isolation_level=None)
  self.db.execute('PRAGMA journal_mode=WAL'); self.db.execute('PRAGMA synchronous=FULL')
  self.db.executescript('CREATE TABLE IF NOT EXISTS batch(id INTEGER PRIMARY KEY, proposal TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(slot INTEGER PRIMARY KEY, attempt TEXT UNIQUE NOT NULL); CREATE TABLE IF NOT EXISTS calls(slot INTEGER NOT NULL, ordinal INTEGER NOT NULL, digest TEXT NOT NULL, owner TEXT NOT NULL, state TEXT NOT NULL, result TEXT, PRIMARY KEY(slot,ordinal));')
  digest=hashlib.sha256(json.dumps(proposal,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
  self.db.execute('INSERT OR IGNORE INTO batch VALUES(1,?)',(digest,))
  if self.db.execute('SELECT proposal FROM batch WHERE id=1').fetchone()[0]!=digest: raise Rejected('Batch proposal changed')
 def close(self): self.db.close()
 def reserve(self,slot,ordinal,attempt,admission,raw):
  if type(slot)!=int or slot not in [0,1] or type(ordinal)!=int or not 0<=ordinal<5: raise Rejected('Run/request allowance exhausted')
  case=self.proposal['cases'][slot]; frozen=self.proposal['frozenNativeInstructions']
  expected={'projectId':case['project']['projectId'],'revision':case['project']['revision'],'document':case['project']['document'],'message':case['message'],'agentVersionId':frozen['agentVersionId'],'blockVersionId':frozen['blockVersionId'],'effectiveDigest':frozen['digest']}
  if admission!=expected or not attempt: raise Rejected('Frozen admission changed')
  if len(raw)+4096>self.proposal['settings']['conservativeInputAllowancePerRequest']: raise Rejected('Serialized input and framing exceed allowance')
  body=json.loads(raw)
  if body.get('model')!='openai/gpt-5.4-mini' or body.get('max_tokens')!=4096 or body.get('provider')!=self.proposal['provider'] or body.get('reasoning')!={'effort':'low'}: raise Rejected('Model/output/routing settings changed')
  if set(body)-{'model','max_tokens','provider','reasoning','messages','tools','tool_choice','stream','stream_options','parallel_tool_calls'}: raise Rejected('Unapproved request option')
  messages=body.get('messages',[])
  systems=[m.get('content') for m in messages if m.get('role')=='system']
  users=[m.get('content') for m in messages if m.get('role')=='user']
  if systems!=[frozen['effective']] or users!=[case['message']]: raise Rejected('Effective instruction or user bytes changed')
  allowed={'readProject','proposeEdits','discoverAssets','readAsset','readPack','searchSources','captureSource','readSource','registerComponent','discoverPacks'}
  for tool in body.get('tools',[]):
   if tool.get('type')!='function' or tool.get('function',{}).get('name') not in allowed: raise Rejected('Unapproved tool')
  digest=hashlib.sha256(raw).hexdigest();owner=secrets.token_hex(24)
  self.db.execute('BEGIN IMMEDIATE')
  try:
   row=self.db.execute('SELECT attempt FROM runs WHERE slot=?',(slot,)).fetchone()
   if row and row[0]!=attempt: raise Rejected('Replacement admission forbidden')
   if self.db.execute("SELECT 1 FROM calls WHERE slot=? AND state!='COMPLETED'",(slot,)).fetchone(): raise Rejected('Unresolved/failed dispatch; no replay or continuation')
   count=self.db.execute('SELECT COUNT(*) FROM calls WHERE slot=?',(slot,)).fetchone()[0]
   if ordinal!=count or count>=5 or self.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0]>=10: raise Rejected('Dispatch already consumed or allowance exhausted')
   self.db.execute('INSERT OR IGNORE INTO runs VALUES(?,?)',(slot,attempt))
   self.db.execute("INSERT INTO calls VALUES(?,?,?,?,'RUNNING',NULL)",(slot,ordinal,digest,owner))
   self.db.execute('COMMIT')
  except Exception:
   self.db.execute('ROLLBACK');raise
  return {'slot':slot,'ordinal':ordinal,'digest':digest,'owner':owner,'serializedBytes':len(raw),'conservativeInputBound':len(raw)+4096}
 def finish(self,claim,state,result):
  if state not in ['COMPLETED','AMBIGUOUS','FAILED']: raise Rejected('Invalid outcome')
  changed=self.db.execute("UPDATE calls SET state=?,result=? WHERE slot=? AND ordinal=? AND owner=? AND digest=? AND state='RUNNING'",(state,json.dumps(result),claim['slot'],claim['ordinal'],claim['owner'],claim['digest'])).rowcount
  if changed!=1: raise Rejected('Only unresolved dispatch owner can record result')
