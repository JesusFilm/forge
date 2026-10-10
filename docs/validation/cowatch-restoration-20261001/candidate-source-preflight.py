"""Read-only aggregate reproduction; private source rows stay in Admin container.
Runtime pinned; unchanged five-second statement/one-second lock bounds.
Never add --execute or import a publisher into this helper.
"""
import pathlib,json,subprocess,shlex,datetime,hashlib,argparse
root=pathlib.Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',required=True,help='New receipt path; existing files are never overwritten')
out=pathlib.Path(parser.parse_args().output).expanduser().resolve()
if out.exists() or not out.parent.is_dir():
 raise SystemExit('Output must not exist and its parent directory must already exist')

now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
sql=(root/'docs/validation/cowatch-restoration-20261001/preflight-source-set-based-explain.sql').read_text().replace('EXPLAIN (FORMAT JSON, COSTS true, SETTINGS true)','',1).replace('2026-09-30T19:38:04.000Z',now)
scope={'version':'episode-event-window-v1','windowStart':'2026-09-23T12:00:00.000Z','windowEnd':'2026-09-30T12:00:00.000Z','evaluationAsOf':'2026-09-30T19:00:00.000Z'}
program='const config='+json.dumps({'sql':sql,'now':now,'scope':scope})+';'+r'''
process.env.TZ='UTC';const{Client}=require('pg');
const{buildCowatchGraph,COWATCH_DURABLE_LINEAGE_VERSION,CowatchWorkOverflowError}=require('./src/services/recommendations/cowatch/graph.ts');
(async()=>{if(process.env.RAILWAY_GIT_COMMIT_SHA!=='99554c8b0759ca4d88d02a0d63bf518e0a89b4cf')throw Error('runtime');
 const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,application_name:'cowatch-candidate-readonly-preflight',options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000 -c timezone=UTC'});
 try{await c.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query('SET LOCAL jit=off');const started=performance.now();const r=await c.query(config.sql);const sourceMs=performance.now()-started;
 const now=new Date(config.now),scope={...config.scope,windowStart:new Date(config.scope.windowStart),windowEnd:new Date(config.scope.windowEnd),evaluationAsOf:new Date(config.scope.evaluationAsOf)};
 if(r.rows.length>50000){await c.query('ROLLBACK');console.log(JSON.stringify({status:'source_overflow',rawSourceCount:r.rows.length,sourceMs}));return}
 const graph=buildCowatchGraph(r.rows.map(row=>({...row,viewerKey:row.profileId==null?`session:${row.sessionDigest}`:`profile:${row.profileId}:${row.privacyGeneration}`,qualityWeight:row.qualityWeight??0})),now,scope,COWATCH_DURABLE_LINEAGE_VERSION);
 const width=rows=>{let total=0,maximum=0;for(const row of rows){const bytes=Buffer.byteLength(JSON.stringify(row));total+=bytes;maximum=Math.max(maximum,bytes)}return{total,maximum}};
 await c.query('ROLLBACK');console.log(JSON.stringify({status:'ready',readOnly:true,sourceMs,totalMs:performance.now()-started,generation:graph.generation,rawSourceCount:r.rows.length,sourceCount:graph.qualifiedOutcomes,attemptedPairCount:graph.attemptedPairCount,contributionCount:graph.contributions.length,edgeCount:graph.edges.length,supportedEdgeCount:graph.edges.filter(x=>x.eligible).length,publicationRowCount:1+graph.sources.length+graph.contributions.length+graph.edges.length,graphRowJsonBytes:{sources:width(graph.sources),contributions:width(graph.contributions),edges:width(graph.edges)},runtimeCommit:process.env.RAILWAY_GIT_COMMIT_SHA}));
 }finally{await c.end()}
})().catch(e=>{console.log(JSON.stringify({status:'failed',sqlstate:/^[0-9A-Z]{5}$/.test(e.code)?e.code:null,reason:e instanceof CowatchWorkOverflowError?'work_overflow':'read_failed',diagnosticsRedacted:true}));process.exitCode=1});
'''
cli='/home/nisal/.cache/pnpm/dlx/fn4qp76b3sbipnjiogg4ezmrim/1a0eeba5094-254fda/node_modules/.bin/railway'
receipt={'declaredAt':now,'scope':scope,'provenance':'Candidate source SQL with unchanged deployed graph builder; no unpublished publisher/service imported','sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'statementTimeoutMs':5000,'jit':False,'lockTimeoutMs':1000,'readOnly':True,'publicationPerformed':False,'automaticRetryPermitted':False}
try:
 r=subprocess.run([cli,'ssh','--project','98952497-a4d9-4714-8fe8-0cdbff3147c9','--environment','production','--service','@forge/admin','--','cd /app/apps/admin && timeout --signal=TERM --kill-after=2s 45s env NODE_OPTIONS=--max-old-space-size=512 node --import tsx -e '+shlex.quote(program)],capture_output=True,text=True,timeout=55)
 records=[]
 for line in r.stdout.splitlines():
  try:v=json.loads(line)
  except:continue
  if v.get('status') in ['ready','failed','source_overflow']:records.append(v)
 receipt.update(transportExitCode=r.returncode,records=records,rawTransportOutputRetained=False)
except subprocess.TimeoutExpired:receipt.update(status='transport_timeout',automaticRetryPermitted=False)
with out.open('x') as output_file:output_file.write(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
