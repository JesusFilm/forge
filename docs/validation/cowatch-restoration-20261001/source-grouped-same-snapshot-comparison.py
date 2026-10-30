"""Read-only aggregate reproduction; private source rows stay in Admin container.
Runtime pinned; unchanged five-second statement/one-second lock bounds.
Never add --execute or import a publisher into this helper.
"""
import pathlib,json,subprocess,shlex,datetime,hashlib,argparse
root=pathlib.Path(__file__).resolve().parents[3];base=root/'docs/validation/cowatch-restoration-20261001';now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',required=True,help='New receipt path; existing files are never overwritten')
out=pathlib.Path(parser.parse_args().output).expanduser().resolve()
if out.exists() or not out.parent.is_dir():
 raise SystemExit('Output must not exist and its parent directory must already exist')

queries=[(base/f).read_text().replace('EXPLAIN (FORMAT JSON, COSTS true, SETTINGS true)','',1).replace('2026-09-30T19:38:04.000Z',now) for f in ['preflight-source-set-based-explain.sql','preflight-source-grouped-explain.sql']]
scope={'version':'episode-event-window-v1','windowStart':'2026-09-23T12:00:00.000Z','windowEnd':'2026-09-30T12:00:00.000Z','evaluationAsOf':'2026-09-30T19:00:00.000Z'}
program='const config='+json.dumps({'queries':queries,'now':now,'scope':scope})+';'+r'''
process.env.TZ='UTC';const{Client}=require('pg');const{buildCowatchGraph,COWATCH_DURABLE_LINEAGE_VERSION}=require('./src/services/recommendations/cowatch/graph.ts');
(async()=>{if(process.env.RAILWAY_GIT_COMMIT_SHA!=='99554c8b0759ca4d88d02a0d63bf518e0a89b4cf')throw Error('runtime');const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,application_name:'cowatch-same-snapshot-equivalence-readonly',options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c transaction_timeout=30000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000 -c timezone=UTC'});
try{await c.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query('SET LOCAL jit=off');const results=[],durations=[];
for(const sql of config.queries){const t=performance.now();const rows=(await c.query(sql)).rows;if(rows.length>50000)throw Error('source_overflow');results.push(rows);durations.push(performance.now()-t)}
const [oldRows,newRows]=results,byId=new Map(oldRows.map(row=>[row.outcomeId,row]));let changedRows=0;const fields={};
for(const row of newRows){const old=byId.get(row.outcomeId);let changed=false;if(!old){changed=true;fields.missingOriginal=(fields.missingOriginal??0)+1}else for(const key of new Set([...Object.keys(old),...Object.keys(row)])){if(JSON.stringify(old[key])!==JSON.stringify(row[key])){changed=true;fields[key]=(fields[key]??0)+1}}changedRows+=+changed}
const now=new Date(config.now),scope={...config.scope,windowStart:new Date(config.scope.windowStart),windowEnd:new Date(config.scope.windowEnd),evaluationAsOf:new Date(config.scope.evaluationAsOf)};
const graphs=results.map(rows=>buildCowatchGraph(rows.map(row=>({...row,viewerKey:row.profileId==null?`session:${row.sessionDigest}`:`profile:${row.profileId}:${row.privacyGeneration}`,qualityWeight:row.qualityWeight??0})),now,scope,COWATCH_DURABLE_LINEAGE_VERSION));
await c.query('ROLLBACK');console.log(JSON.stringify({status:'compared',readOnly:true,sourceMs:durations,rawRowCounts:results.map(x=>x.length),changedRows,changedFieldCounts:fields,orderEqual:oldRows.length===newRows.length&&oldRows.every((r,i)=>r.outcomeId===newRows[i].outcomeId),graphGenerations:graphs.map(g=>g.generation),graphCounts:graphs.map(g=>({sourceCount:g.sources.length,attemptedPairCount:g.attemptedPairCount,contributionCount:g.contributions.length,edgeCount:g.edges.length})),runtimeCommit:process.env.RAILWAY_GIT_COMMIT_SHA}));
}finally{await c.end()}})().catch(e=>{console.log(JSON.stringify({status:'failed',sqlstate:/^[0-9A-Z]{5}$/.test(e.code)?e.code:null,diagnosticsRedacted:true}));process.exitCode=1});
'''
cli='/home/nisal/.cache/pnpm/dlx/fn4qp76b3sbipnjiogg4ezmrim/1a0eeba5094-254fda/node_modules/.bin/railway';receipt={'declaredAt':now,'scope':scope,'readOnly':True,'isolation':'repeatable read','statementTimeoutMs':5000,'transactionTimeoutMs':30000,'queryLabels':['first optimized retained matches','grouped retained ownership and identity'],'lockTimeoutMs':1000,'jit':False,'sourceSqlSha256':[hashlib.sha256(s.encode()).hexdigest() for s in queries],'publicationPerformed':False}
try:
 r=subprocess.run([cli,'ssh','--project','98952497-a4d9-4714-8fe8-0cdbff3147c9','--environment','production','--service','@forge/admin','--','cd /app/apps/admin && timeout --signal=TERM --kill-after=2s 45s env NODE_OPTIONS=--max-old-space-size=512 node --import tsx -e '+shlex.quote(program)],capture_output=True,text=True,timeout=55)
 records=[]
 for line in r.stdout.splitlines():
  try:v=json.loads(line)
  except:continue
  if v.get('status') in ['compared','failed']:records.append(v)
 receipt.update(transportExitCode=r.returncode,records=records,rawTransportOutputRetained=False)
except subprocess.TimeoutExpired:receipt.update(status='transport_timeout')
with out.open('x') as output_file:output_file.write(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
