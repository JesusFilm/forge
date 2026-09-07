import {chromium} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/shorts-worker/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='/home/tataihono/.cache/forge-studio-460-runtime/browser';
const fixture=JSON.parse(await readFile(dir+'/fixture.json','utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const evidence={scope:'Owned local Mux protocol fixture, not actual provider acceptance',errors:[],steps:[]};let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(['studio460.localhost','127.0.0.1','localhost'].includes(url.hostname)||['blob:','data:'].includes(url.protocol))return route.continue();return route.abort()});
 await context.request.get('http://studio460.localhost:34668/local-fixture-login',{maxRedirects:0});
 page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
 await page.goto(`http://studio460.localhost:34666/dashboard/shorts/${fixture.projectId}`);
 await page.getByRole('button',{name:'Render and publish',exact:true}).click({timeout:45000});
 await page.getByRole('button',{name:'Review rendered video',exact:true}).waitFor({timeout:90000});
 await page.getByRole('button',{name:'Review rendered video',exact:true}).click();
 await page.waitForFunction(()=>{const v=document.querySelector('[role=dialog] video');return v?.readyState>=2},{},{timeout:45000});
 evidence.review=await page.locator('[role=dialog] video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight}));
 assert.equal(evidence.review.width,320);assert.equal(evidence.review.height,180);
 await page.getByRole('checkbox',{name:'I reviewed this rendered revision.'}).check();
 await page.getByRole('button',{name:'Approve this render',exact:true}).click();
 await page.getByRole('button',{name:'Approved',exact:true}).waitFor();
 await page.getByRole('button',{name:'Publish to Watch',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Published on Watch'}).waitFor({timeout:60000});
 evidence.watchHref=await page.getByRole('link',{name:'Open on Watch'}).getAttribute('href');
 evidence.state=await page.evaluate(async id=>(await(await fetch('/api/studio/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'render-state',input:id})})).json()).result,fixture.projectId);
 evidence.steps.push('Actual browser retained video review, trusted interactive approval, fresh readiness and canonical atomic publication with local signed-only provider fixture');
 await page.screenshot({path:dir+'/publication-success.png'});assert.equal(evidence.errors.length,0);
}catch(e){evidence.failure=e.message;if(page){evidence.body=await page.locator('body').innerText();await page.screenshot({path:dir+'/publication-failure.png'})}process.exitCode=1}
finally{await writeFile(dir+'/publication-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({steps:evidence.steps,failure:evidence.failure,errors:evidence.errors}));await browser.close()}
