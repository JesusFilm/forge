"""Aggregate-only remote reproduction; private material stays inside Admin container.
Do not extract/run the embedded SQL through a raw-output client.
Read-only, exact runtime pinned; no automatic retries or mutations.
"""
import json,subprocess,shlex,pathlib,datetime,hashlib
sql="WITH source_bound AS MATERIALIZED (\n SELECT eligibility_decision_id FROM recommendation_cowatch_source_contribution\n WHERE generation_id='ba4d332f88695f36230308de1ed88820bdb9ddb5d14f0f4c89b7fba56d9c91b7' ORDER BY outcome_id LIMIT 6681\n), changed_bound AS MATERIALIZED (\n SELECT old.*,to_jsonb(successor) successor\n FROM source_bound s JOIN recommendation_eligibility_decision old ON old.id=s.eligibility_decision_id\n JOIN LATERAL (SELECT * FROM recommendation_eligibility_decision d WHERE d.source_key=old.source_key AND d.policy_version=old.policy_version AND d.revision>old.revision ORDER BY revision LIMIT 1) successor ON NOT old.is_current\n WHERE (SELECT count(*) FROM source_bound)<=6680 ORDER BY successor.decided_at LIMIT 65\n), changed AS MATERIALIZED (SELECT * FROM changed_bound WHERE (SELECT count(*) FROM changed_bound)<=64)\nSELECT to_jsonb(c) captured,\n json_build_object(\n 'sourceType','playback_outcome','outcomeId',o.id,'classifierVersion',o.classifier_version,\n 'outcomeRevision',o.revision,'outcomeInputDigest',o.input_digest,'qualifiedView',o.qualified_view,\n 'baseWeight',coalesce(o.view_quality_weight,0),'finalizedAt',e.finalized_at,\n 'late',EXISTS(SELECT 1 FROM recommendation_playback_fact f WHERE f.episode_id=e.id AND f.late),\n 'replayCount',e.replay_count,'transportReplayCount',e.transport_replay_count,\n 'transportReplayReceiptCount',(SELECT count(*) FROM (SELECT 1 FROM recommendation_playback_transport_replay_receipt WHERE episode_id=e.id LIMIT 257) bounded),\n 'conflictCount',e.conflict_count,'superseded',EXISTS(SELECT 1 FROM recommendation_outcome_revision newer WHERE newer.supersedes_id=o.id),\n 'promotionFence',fence.reason_code,\n 'directInfluenceAllowed',NOT EXISTS (\n SELECT 1 FROM recommendation_request owner_request WHERE owner_request.id=o.request_id AND owner_request.owner_release_id IS NOT NULL\n AND NOT EXISTS(SELECT 1 FROM recommendation_owner_release owner_release JOIN recommendation_promotion_pointer owner_pointer ON owner_pointer.id='recommendation-promotion-pointer'\n WHERE owner_release.id=owner_request.owner_release_id AND owner_release.pointer_generation=owner_request.owner_release_generation AND owner_release.revoked_at IS NULL\n AND owner_request.owner_release_generation>=owner_pointer.owner_influence_floor_generation AND owner_request.created_at>=owner_release.approved_at AND owner_request.created_at<owner_release.valid_until))\n ) current_input,\n (SELECT count(*) FROM source_bound) observed_sources,(SELECT count(*) FROM changed_bound) observed_successors\nFROM changed c JOIN recommendation_outcome_revision o ON o.id=c.outcome_id\nJOIN recommendation_playback_episode e ON e.id=o.episode_id\nLEFT JOIN recommendation_promotion_slate_fence fence ON fence.request_id=o.request_id;\n"
program='const sql='+json.dumps(sql)+';'+r'''
process.env.TZ='UTC';const{createRequire}=require('node:module');const{readFileSync}=require('node:fs');const path=require('node:path');const{createHash}=require('node:crypto');
(async()=>{
 if(process.env.RAILWAY_GIT_COMMIT_SHA!=='99554c8b0759ca4d88d02a0d63bf518e0a89b4cf')throw new Error('revision');
 let req,dir=process.cwd();for(let depth=0;depth<5&&!req;depth++){for(const p of[path.join(dir,'apps/admin/package.json'),path.join(dir,'package.json')])try{if(JSON.parse(readFileSync(p,'utf8')).name==='@forge/admin'){req=createRequire(p);break}}catch{} const next=path.dirname(dir);if(next===dir)break;dir=next}if(!req)throw new Error('module');
 const{Client}=req('pg');const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,application_name:'cowatch-digest-aggregate-readonly',options:'-c default_transaction_read_only=on -c statement_timeout=25000 -c lock_timeout=1000 -c timezone=UTC'});
 try{await c.connect();await c.query('BEGIN READ ONLY; SET LOCAL enable_seqscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL jit=off');const rs=await c.query(sql);const groups={};
 const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const measures=r=>({contributionOrdinal:r.contribution_ordinal,distinctSupport:r.distinct_support,identityConcentration:r.identity_concentration});
 const decision=r=>({state:r.state,reasonCodes:r.reason_codes,eligibleScopes:r.eligible_scopes,contributionWeight:r.contribution_weight});
 for(const row of rs.rows){const old=row.captured,s=old.successor,input=row.current_input;if(input.finalizedAt!==null)input.finalizedAt=new Date(input.finalizedAt).toISOString();
 const near=Math.abs(new Date(s.decided_at+'Z')-new Date('2026-09-30T03:07:39.005Z'))<=60000;
 const key=near?(new Date(s.decided_at+'Z')<=new Date('2026-09-30T03:07:39.005Z')?'within_60s_at_or_before_invalidation':'within_60s_after_invalidation'):'later';const g=groups[key]??={compared:0,currentFormatMatchesSuccessor:0,currentFormatWithOldMeasuresMatchesCaptured:0,legacyWithoutDirectInfluenceMatchesCaptured:0,legacyWithoutDirectInfluenceMatchesSuccessor:0,neitherCapturedFormatMatches:0};g.compared++;
 const current={...input,measures:measures(s),decision:decision(s)};const oldMeasures={...input,measures:measures(old),decision:decision(old)};
 const legacyOld={...oldMeasures};delete legacyOld.directInfluenceAllowed;const legacyNew={...current};delete legacyNew.directInfluenceAllowed;
 const om=digest(oldMeasures)===old.input_digest,lm=digest(legacyOld)===old.input_digest;
 g.currentFormatMatchesSuccessor+=+(digest(current)===s.input_digest);g.currentFormatWithOldMeasuresMatchesCaptured+=+om;g.legacyWithoutDirectInfluenceMatchesCaptured+=+lm;g.legacyWithoutDirectInfluenceMatchesSuccessor+=+(digest(legacyNew)===s.input_digest);g.neitherCapturedFormatMatches+=+(!om&&!lm);
 }
 await c.query('ROLLBACK');console.log(JSON.stringify({probe:'cowatch_digest_aggregate',readOnly:true,runtimeCommit:process.env.RAILWAY_GIT_COMMIT_SHA,observedAt:new Date().toISOString(),observedSources:rs.rows[0]?.observed_sources??null,observedSuccessors:rs.rows[0]?.observed_successors??null,groups}));
 }finally{await c.end();}
})().catch(e=>{console.log(JSON.stringify({probe:'cowatch_digest_failure',sqlstate:/^[0-9A-Z]{5}$/.test(e.code)?e.code:null}));process.exitCode=1});
'''
cli='/home/nisal/.cache/pnpm/dlx/fn4qp76b3sbipnjiogg4ezmrim/1a0eeba5094-254fda/node_modules/.bin/railway'
r=subprocess.run([cli,'ssh','--project','98952497-a4d9-4714-8fe8-0cdbff3147c9','--environment','production','--service','@forge/admin','--','node -e '+shlex.quote(program)],capture_output=True,text=True,timeout=40)
records=[]
for line in r.stdout.splitlines():
 try:x=json.loads(line)
 except:continue
 if x.get('probe') in ['cowatch_digest_aggregate','cowatch_digest_failure']:records.append(x)
out={'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'transportExitCode':r.returncode,'rawOutputRetained':False,'records':records}
p=pathlib.Path(__file__).with_name('g6-digest-reconstruction-timing.json');p.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
