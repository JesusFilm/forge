"""Task-local comparison dispatch guard; no provider network implementation."""
import hashlib,json,sqlite3,secrets,math
class Rejected(Exception):pass
class Violation(Rejected):pass
def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
class Guard:
 def __init__(self,path,p):
  self.p=p;self.db=sqlite3.connect(path,timeout=30,isolation_level=None)
  self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
  self.db.executescript('CREATE TABLE IF NOT EXISTS batch(id INTEGER PRIMARY KEY, digest TEXT NOT NULL, stopped INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS runs(slot INTEGER PRIMARY KEY,arm TEXT NOT NULL,case_id TEXT NOT NULL,attempt TEXT UNIQUE NOT NULL,admission TEXT NOT NULL);CREATE TABLE IF NOT EXISTS calls(slot INTEGER,ordinal INTEGER,owner TEXT,digest TEXT,state TEXT,result TEXT,reserved REAL NOT NULL,PRIMARY KEY(slot,ordinal));')
  self.db.execute('INSERT OR IGNORE INTO batch(id,digest) VALUES(1,?)',(digest(p),))
  if self.db.execute('SELECT digest FROM batch').fetchone()[0]!=digest(p):self.db.close();raise Rejected('Manifest changed')
 def close(self):self.db.close()
 def slot(self,s):
  if type(s)!=int or not 0<=s<6:raise Rejected('Unknown slot')
  return self.p['runOrder'][s]
 def case(self,s):return next(c for c in self.p['cases'] if c['case']==self.slot(s)['case'])
 def model(self,s):return next(m for m in self.p['models'] if m['arm']==self.slot(s)['arm'])
 def expected(self,s,attempt):
  c=self.case(s);f=self.p['frozenNativeInstructions']
  return {'slot':s,'arm':self.slot(s)['arm'],'case':c['case'],'attempt':attempt,'projectId':c['project']['projectId'],'revision':c['project']['revision'],'document':c['project']['document'],'message':c['message'],'packId':c['pack']['id'],'packDigest':digest(c['pack']),'agentVersionId':f['agentVersionId'],'blockVersionId':f['blockVersionId'],'effectiveDigest':f['digest']}
 def reserve(self,s,o,attempt,admission,raw):
  # Already consumed/owned claims cannot change the winner or stop its batch.
  if self.db.execute('SELECT 1 FROM calls WHERE slot=? AND ordinal=?',(s,o)).fetchone():raise Rejected('Claim already owned or consumed')
  try:return self._reserve(s,o,attempt,admission,raw)
  except Violation:
   # Validation raced with another process: ownership and stop are one transaction.
   self.db.execute('BEGIN IMMEDIATE')
   try:
    owned=self.db.execute('SELECT 1 FROM calls WHERE slot=? AND ordinal=?',(s,o)).fetchone()
    if not owned:self.db.execute('UPDATE batch SET stopped=1')
    self.db.execute('COMMIT')
   except Exception:self.db.execute('ROLLBACK');raise
   if owned:raise Rejected('Losing claimant cannot stop its winner')
   raise
 def _reserve(self,s,o,attempt,admission,raw):
  m=self.model(s);c=self.case(s);f=self.p['frozenNativeInstructions']
  if type(o)!=int or not 0<=o<4:raise Rejected('Four-request evaluation budget exhausted')
  if not isinstance(attempt,str) or not attempt or admission!=self.expected(s,attempt):raise Violation('Slot/arm/case/attempt/frozen admission mismatch')
  if len(raw)+4096>200000:raise Violation('Input allowance exceeded')
  try:b=json.loads(raw)
  except (ValueError,UnicodeError):raise Violation('Malformed request')
  if not isinstance(b,dict):raise Violation('Malformed request')
  if b.get('model')!=m['slug'] or b.get('max_tokens')!=4096 or b.get('provider')!=self.p['boundModelRouting'][m['arm']] or b.get('reasoning')!={'effort':'low'}:raise Violation('Model/routing/max-price mismatch')
  if set(b)-{'model','max_tokens','provider','reasoning','messages','tools','tool_choice','stream','stream_options','parallel_tool_calls'} or b.get('stream')!=True or b.get('stream_options')!={'include_usage':True}:raise Violation('Unapproved request options')
  messages=b.get('messages',[])
  if not isinstance(messages,list) or any(not isinstance(x,dict) for x in messages):raise Violation('Malformed message envelope')
  tools=b.get('tools',[])
  if not isinstance(tools,list) or any(not isinstance(t,dict) or not isinstance(t.get('function'),dict) for t in tools):raise Violation('Malformed tool envelope')
  if hashlib.sha256(json.dumps(tools,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()!=self.p['toolSchemaDigest']:raise Violation('Shipped tool definitions changed')
  if [x.get('content') for x in messages if x.get('role')=='system']!=[f['effective']] or [x.get('content') for x in messages if x.get('role')=='user']!=[c['message']]:raise Violation('Instruction/message bytes changed')
  for t in b.get('tools',[]):
   if t.get('type')!='function' or t.get('function',{}).get('name') not in {'readProject','proposeEdits','discoverAssets','readAsset','readPack','searchSources','captureSource','readSource','registerComponent','discoverPacks'}:raise Violation('Unapproved tool schema')
  reserved=(200000*m['promptUSDPerMillion']+4096*m['outputUSDPerMillion'])/1e6
  owner=secrets.token_hex(24);h=hashlib.sha256(raw).hexdigest();self.db.execute('BEGIN IMMEDIATE')
  try:
   if self.db.execute('SELECT stopped FROM batch').fetchone()[0]:raise Rejected('Batch stopped')
   row=self.db.execute('SELECT arm,case_id,attempt,admission FROM runs WHERE slot=?',(s,)).fetchone()
   identity=(self.slot(s)['arm'],c['case'],attempt,digest(admission))
   if row and row!=identity:raise Violation('Replacement/cross-arm admission')
   if self.db.execute("SELECT 1 FROM calls WHERE slot=? AND state!='COMPLETED'",(s,)).fetchone():raise Rejected('Unresolved/failed run cannot continue')
   n=self.db.execute('SELECT COUNT(*) FROM calls WHERE slot=?',(s,)).fetchone()[0];total,cost=self.db.execute('SELECT COUNT(*),COALESCE(SUM(reserved),0) FROM calls').fetchone()
   if n!=o or total>=24 or cost+reserved>9:raise Rejected('Consumed or cumulative budget exhausted')
   self.db.execute('INSERT OR IGNORE INTO runs VALUES(?,?,?,?,?)',(s,*identity))
   self.db.execute("INSERT INTO calls VALUES(?,?,?,?,'RUNNING',NULL,?)",(s,o,owner,h,reserved));self.db.execute('COMMIT')
  except Exception:self.db.execute('ROLLBACK');raise
  return {'slot':s,'ordinal':o,'owner':owner,'digest':h,'serializedBytes':len(raw),'conservativeInputBound':len(raw)+4096,'reservedUSD':reserved,'arm':m['arm'],'case':c['case'],'attempt':attempt}
 def finish(self,claim,state,result):
  if state not in ['COMPLETED','FAILED','AMBIGUOUS']:raise Rejected('Invalid state')
  if state=='COMPLETED' and (result.get('completeStream')!=True or result.get('http')!=200):raise Rejected('Incomplete stream cannot complete')
  self.db.execute('BEGIN IMMEDIATE')
  try:
   row=self.db.execute("SELECT reserved FROM calls WHERE slot=? AND ordinal=? AND owner=? AND digest=? AND state='RUNNING'",(claim['slot'],claim['ordinal'],claim['owner'],claim['digest'])).fetchone()
   if not row:raise Rejected('Only unresolved owner may finish')
   u=result.get('usage');cost=result.get('actualCostUSD');provider=result.get('provider')
   counts=isinstance(u,dict) and all(type(u.get(k)) is int and 0<=u[k]<=limit for k,limit in [('prompt_tokens',200000),('completion_tokens',4096)])
   identity=isinstance(provider,str) and provider.lower()=='openai' and result.get('model')==self.model(claim['slot'])['slug']
   bad=(cost is not None and (type(cost) not in (float,int) or not math.isfinite(cost) or cost<0 or cost>row[0])) or (state=='COMPLETED' and (not counts or not identity)) or (provider is not None and (not isinstance(provider,str) or provider.lower()!='openai')) or (result.get('model') is not None and result['model']!=self.model(claim['slot'])['slug']) or (u is not None and not counts)
   if bad:self.db.execute('UPDATE batch SET stopped=1');state='FAILED'
   self.db.execute('UPDATE calls SET state=?,result=? WHERE slot=? AND ordinal=?',(state,json.dumps(result),claim['slot'],claim['ordinal']));self.db.execute('COMMIT')
  except Exception:self.db.execute('ROLLBACK');raise
