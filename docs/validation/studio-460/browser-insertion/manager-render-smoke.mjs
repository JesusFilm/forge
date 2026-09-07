import {chromium} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/shorts-worker/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='/home/tataihono/.cache/forge-studio-460-runtime/browser';
const fixture=JSON.parse(await readFile(dir+'/fixture.json','utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const evidence={errors:[],blockedHosts:[],steps:[]};let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['studio460.localhost','127.0.0.1','localhost'].includes(url.hostname)||['blob:','data:'].includes(url.protocol))return route.continue();evidence.blockedHosts.push(url.hostname);return route.abort()});
 await context.request.get('http://studio460.localhost:34668/local-fixture-login',{maxRedirects:0});
 page=await context.newPage();page.on('pageerror',error=>evidence.errors.push(error.message));
 const start=performance.now();await page.goto(`http://studio460.localhost:34666/dashboard/shorts/${fixture.projectId}`);
 await page.getByRole('button',{name:'Save',exact:true}).waitFor({timeout:45000});
 evidence.editorReadyMs=performance.now()-start;
 await page.getByRole('button',{name:'Add text card',exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('status').filter({hasText:/Saved/}).waitFor();
 await page.getByRole('button',{name:'Render and publish',exact:true}).click();
 await page.getByRole('button',{name:'Render saved revision',exact:true}).waitFor();
 const enqueue=page.waitForResponse(response=>response.url().endsWith('/api/studio/command')&&response.request().postDataJSON()?.action==='request');
 await page.getByRole('button',{name:'Render saved revision',exact:true}).click();
 const receipt=await(await enqueue).json();evidence.attemptId=receipt.result?.attemptId;assert.ok(evidence.attemptId);
 await page.waitForFunction(async ({projectId,attemptId})=>{const response=await fetch('/api/studio/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'render-state',input:projectId})});const data=await response.json();return data.result?.attempts.some(attempt=>attempt.id===attemptId&&attempt.status==='SUCCEEDED')},{projectId:fixture.projectId,attemptId:evidence.attemptId},{timeout:120000,polling:1000});
 const project=await page.evaluate(async projectId=>{const response=await fetch('/api/studio/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'read',input:projectId})});return (await response.json()).result},fixture.projectId);
 assert.ok(project.document.items.some(item=>item.kind==='text'));assert.ok(project.document.tracks.some(track=>track.kind==='visual'));evidence.revision=project.revision;
 await page.getByRole('status').filter({hasText:'Render: SUCCEEDED'}).waitFor();
 evidence.steps.push('Production Manager browser edit/save/enqueue, real signed worker dispatch, contained Chromium render and independent codec verification, canonical retained SUCCEEDED');
 evidence.performance=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation').map(entry=>entry.toJSON()),resources:performance.getEntriesByType('resource').map(entry=>({name:new URL(entry.name).pathname,duration:entry.duration,transferSize:entry.transferSize,encodedBodySize:entry.encodedBodySize}))}));
 await page.screenshot({path:dir+'/manager-render-success.png'});
 assert.equal(evidence.errors.length,0);
}catch(error){evidence.failure=error.message;if(page){evidence.body=await page.locator('body').innerText();await page.screenshot({path:dir+'/manager-render-failure.png'})}process.exitCode=1}
finally{await writeFile(dir+'/manager-render-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({steps:evidence.steps,failure:evidence.failure,errors:evidence.errors}));await browser.close()}
