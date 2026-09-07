import {chromium} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/shorts-worker/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const dir='/home/tataihono/.cache/forge-studio-460-runtime/browser';
const pub=JSON.parse(await readFile(dir+'/publication-smoke.json','utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const e={errors:[],responses:[],blocked:[]};let page;
try{
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('**/*',r=>{const u=new URL(r.request().url());if(['127.0.0.1','studio460.localhost','localhost'].includes(u.hostname)||['blob:','data:'].includes(u.protocol))return r.continue();e.blocked.push(u.hostname+u.pathname);return r.abort()});
page=await context.newPage();page.on('pageerror',err=>e.errors.push(err.message));page.on('response',r=>{if(r.url().includes('/api/studio/playback/'))e.responses.push({url:r.url(),status:r.status(),cache:r.headers()['cache-control']})});
await page.goto(pub.watchHref,{timeout:60000});await page.getByRole('button',{name:'Watch now',exact:true}).click({timeout:45000});
await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.currentTime>1},null,{timeout:45000});
e.body=await page.locator('body').innerText();e.videos=await page.locator('video').evaluateAll(vs=>vs.map(v=>({src:v.currentSrc,readyState:v.readyState,currentTime:v.currentTime,error:v.error?.message})));
await page.screenshot({path:dir+'/watch-playback.png'});
}catch(err){e.failure=err.message}
finally{await writeFile(dir+'/watch-playback.json',JSON.stringify(e,null,2));console.log(JSON.stringify(e));await browser.close()}
