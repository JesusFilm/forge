import {createRequire} from 'node:module';
import {writeFileSync,readFileSync,renameSync,openSync,closeSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {loadavg,freemem,tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require('../../node_modules/.pnpm/@playwright+test@1.61.1/node_modules/@playwright/test');
const base='.tmp/studio461/integration',next='apps/manager/.next',dataset=()=>execFileSync('psql',['postgresql://tataihono@127.0.0.1:55461/forge_studio_461_test','-Atc',"select md5((select json_agg(x order by id)::text from studio_project x)||(select json_agg(x order by id)::text from studio_plan_slot x)||(select json_agg(x order by id)::text from studio_schedule_authorization x)||(select json_agg(x order by id)::text from studio_calendar x))"],{encoding:'utf8'}).trim();
const host=()=>({at:new Date().toISOString(),load:loadavg(),freeMemory:freemem(),cpu:readFileSync('/proc/stat','utf8').split('\n')[0]});
const result={datasetBefore:dataset(),samples:[],viewport:{width:1440,height:1000},design:'Three AB/BA alternating rounds; same origin and backend; restarted variant process warmed by login each route; browser cold/warm; CPU profiler active identically; 1s post-ready observation'};
if(tmpdir()!=='/home/tataihono/.studio461-tmp')throw Error('Task-owned short disk TMPDIR required');
result.tempDirectory=tmpdir();result.tempFilesystem=execFileSync('df',['-h',tmpdir()],{encoding:'utf8'});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--enable-automation','--disk-cache-dir=/home/tataihono/.studio461-tmp/http-cache']});result.version=browser.version();result.browserArguments=await (await browser.newBrowserCDPSession()).send('Browser.getBrowserCommandLine');let child,active;
const persist=()=>writeFileSync(base+'/schedule-loading.json',JSON.stringify(result,null,2));
async function stop(){if(child){process.kill(-child.pid,'SIGTERM');await new Promise(r=>child.once('exit',r));child=null;}if(active){renameSync(next,next+'-studio461-schedule-'+active);active=null;}}
try{
for(let round=0;round<3;round++)for(const variant of round%2?['feature','baseline']:['baseline','feature']){
 renameSync(next+'-studio461-schedule-'+variant,next);active=variant;
 const log=openSync(base+`/schedule-server-${round}-${variant}.log`,'w');child=spawn('node',['.tmp/studio461/runtime.mjs','start-native-manager','manager'],{detached:true,stdio:['ignore',log,log]});closeSync(log);
 let ready=false;for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:3461/dashboard/shorts',{redirect:'manual'});ready=true;break}catch{await new Promise(r=>setTimeout(r,100));}}if(!ready)throw Error('Server unavailable');
 for(const route of ['/calendar']){
  const context=await browser.newContext({viewport:result.viewport});await context.addInitScript(()=>{window.__loading={cls:0,longTasks:[],lcp:0};for(const type of ['layout-shift','longtask','largest-contentful-paint'])new PerformanceObserver(list=>{for(const e of list.getEntries()){if(type==='layout-shift'&&!e.hadRecentInput)window.__loading.cls+=e.value;if(type==='longtask')window.__loading.longTasks.push(e.toJSON());if(type==='largest-contentful-paint')window.__loading.lcp=e.startTime}}).observe({type,buffered:true})});
  const page=await context.newPage();await page.goto('http://127.0.0.1:3463/login');await page.getByRole('link',{name:'Planning calendar',exact:true}).waitFor();await page.waitForTimeout(1000);const cdp=await context.newCDPSession(page);await cdp.send('Network.clearBrowserCache');await cdp.send('Performance.enable');await cdp.send('Profiler.enable');
  for(const cache of ['cold','warm']){
   const before=host(),cpuBefore=await cdp.send('Performance.getMetrics');await cdp.send('Profiler.start');
   await page.goto('http://127.0.0.1:3461/dashboard/shorts'+route,{waitUntil:'load'});await page.locator('.calendar-day').nth(13).waitFor();await page.getByRole('button',{name:'Calendar settings',exact:true}).waitFor();
   const atReady=await page.evaluate(()=>({controls:performance.now(),nav:performance.getEntriesByType('navigation').map(e=>e.toJSON()),resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),observed:window.__loading}));
   await page.waitForTimeout(1000);const after=await page.evaluate(()=>({end:performance.now(),resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),observed:window.__loading}));const cpuAfter=await cdp.send('Performance.getMetrics'),profile=await cdp.send('Profiler.stop');const profileName=`schedule-cpu-${round}-${variant}-${'calendar'}-${cache}.json`;writeFileSync(base+'/'+profileName,JSON.stringify(profile));
   result.samples.push({round,variant,route,cache,before,afterHost:host(),...atReady,after,cpuBefore,cpuAfter,profile:profileName});persist();
  }await context.close();
 }await stop();
}
result.datasetAfter=dataset();if(result.datasetBefore!==result.datasetAfter)throw Error('Dataset changed during comparison');
}catch(e){result.error=String(e);throw e}finally{await stop();renameSync(next+'-studio461-schedule-feature',next);result.finishedAt=new Date().toISOString();persist();await browser.close();}
