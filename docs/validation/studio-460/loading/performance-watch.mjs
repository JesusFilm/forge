import {chromium} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/shorts-worker/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const dir='/home/tataihono/.cache/forge-studio-460-runtime';

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const results=[];
try {
for(let round=0;round<6;round++)for(const version of round%2?['changed','baseline']:['baseline','changed']){
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',r=>{const u=new URL(r.request().url());return ['studio460.localhost','127.0.0.1','localhost'].includes(u.hostname)||['blob:','data:'].includes(u.protocol)?r.continue():r.abort()});

const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})});
const start=performance.now();const response=await page.goto(`http://127.0.0.1:${version==='baseline'?34681:34667}/watch/studio460-core-performance.html`,{timeout:60000});
await page.getByRole('button',{name:'Watch now',exact:true}).waitFor({timeout:15000}).catch(async e=>{console.log(JSON.stringify({version,url:page.url(),body:await page.locator('body').innerText(),errors}));throw e});
const readyMs=performance.now()-start;
await page.waitForTimeout(1000);
const metrics=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation')[0].toJSON(),paint:performance.getEntriesByType('paint').map(e=>e.toJSON()),longTasks:window.__longTasks,resources:performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script'||e.name.includes('.js')).map(e=>({path:new URL(e.name).pathname,transfer:e.transferSize,encoded:e.encodedBodySize,duration:e.duration}))}));
results.push({round,version,status:response.status(),readyMs,errors,...metrics});
console.log(JSON.stringify({round,version,readyMs,errors}));await context.close();
}
}finally{await writeFile(dir+'/performance-watch.json',JSON.stringify({base:'4109b02c',results},null,2));await browser.close()}
