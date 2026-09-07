import {chromium} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/shorts-worker/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
const host=()=>({loadAverage:os.loadavg(),cpuCount:os.cpus().length,cpu:os.cpus().reduce((sum,cpu)=>({idle:sum.idle+cpu.times.idle,total:sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0}),freeMemory:os.freemem()});
const dir='/home/tataihono/.cache/forge-studio-460-runtime';
const fixture=JSON.parse(await readFile(dir+'/browser/fixture.json','utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const results=[];
try {
for(let round=0;round<6;round++)for(const version of round%2?['changed','baseline']:['baseline','changed']){
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',r=>{const u=new URL(r.request().url());return ['studio460.localhost','127.0.0.1','localhost'].includes(u.hostname)||['blob:','data:'].includes(u.protocol)?r.continue():r.abort()});
await context.request.get('http://studio460.localhost:34668/local-fixture-login',{maxRedirects:0});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})});
const hostBefore=host();const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
const start=performance.now();const response=await page.goto(`http://studio460.localhost:${version==='baseline'?34680:34666}/dashboard/shorts/${fixture.projectId}`,{timeout:60000});
await page.getByRole('button',{name:'Save',exact:true}).waitFor({timeout:15000}).catch(async e=>{console.log(JSON.stringify({version,url:page.url(),body:await page.locator('body').innerText(),errors}));throw e});
const readyMs=performance.now()-start;
await page.waitForTimeout(1000);
const metrics=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation')[0].toJSON(),paint:performance.getEntriesByType('paint').map(e=>e.toJSON()),longTasks:window.__longTasks,networkResources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,kind:e.initiatorType,transfer:e.transferSize,encoded:e.encodedBodySize,duration:e.duration})),resources:performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script'||e.name.includes('.js')).map(e=>({path:new URL(e.name).pathname,transfer:e.transferSize,encoded:e.encodedBodySize,duration:e.duration}))}));
const browserMetrics=await cdp.send('Performance.getMetrics');
results.push({hostBefore,hostAfter:host(),browserMetrics,round,version,status:response.status(),readyMs,errors,...metrics});
console.log(JSON.stringify({round,version,readyMs,errors}));await context.close();
}
}finally{await writeFile(dir+'/performance-manager-idle.json',JSON.stringify({base:'4109b02c',results},null,2));await browser.close()}
