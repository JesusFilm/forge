import {chromium} from '/home/tataihono/.codex/worktrees/8b33/forge/apps/shorts-worker/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const proposal=JSON.parse(await readFile('/tmp/forge-studio-458-prep/model-capability-comparison/binding/verified-bound-proposal.body','utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'}),page=await context.newPage(),errors=[],out=[];
await page.addInitScript(()=>{const original=window.fetch;window.hostedEvents=[];window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/api/studio/generation'))response.clone().text().then(events=>window.hostedEvents.push({http:response.status,events}));return response;};});
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
const button=n=>page.getByRole('button',{name:n,exact:true});
try{
 await context.request.get('http://studio458.localhost:3589/local-fixture-login',{maxRedirects:0});
 const slot=Number(process.argv[2]);if(!Number.isInteger(slot)||slot<0||slot>5)throw new Error('Exact slot required');
 for(const planned of proposal.runOrder.filter(p=>p.slot===slot)){
  const c=proposal.cases.find(c=>c.case===planned.case);
  await page.goto('http://studio458.localhost:3588/dashboard/shorts/'+c.project.projectId,{waitUntil:'domcontentloaded'});
  await button('Generate scripts').click();
  await page.locator('textarea').fill(c.message);
  await page.getByLabel('Explicitly generate these',{exact:false}).check();
  await writeFile('/tmp/forge-studio-458-prep/model-capability-comparison/binding/live-adapter/live/pre-click-'+slot+'.txt',await page.locator('body').innerText());
  await page.screenshot({path:'/tmp/forge-studio-458-prep/model-capability-comparison/binding/live-adapter/live/pre-click-'+slot+'.png',fullPage:true});
  await page.getByRole('checkbox',{name:new RegExp(c.project.projectId)}).waitFor();
  await button('Generate script, composition and source preview').click();
  await page.waitForFunction(()=>window.hostedEvents.length>0,{},{timeout:600000});
  const captured=await page.evaluate(()=>window.hostedEvents.at(-1));const events=captured.events;out.push({slot:planned.slot,arm:planned.arm,case:c.case,projectId:c.project.projectId,...captured});
  await writeFile('/tmp/forge-studio-458-prep/model-capability-comparison/binding/live-adapter/live/hosted-'+slot+'-events.body',events);
  if(!events.includes('batch-finished'))throw new Error('Hosted batch incomplete; inspect retained events');
  await page.screenshot({path:'/tmp/forge-studio-458-prep/model-capability-comparison/binding/live-adapter/live/hosted-'+planned.slot+'-'+c.case+'.png',fullPage:true});
  await button('Close generation').click();
  await page.locator('a[href="/dashboard/shorts"]').first().click();
 }
 if(errors.length)throw new Error(errors.join(';'));
 console.log(JSON.stringify({nativeRuns:out.length,pageErrors:errors,slot,eventsRetained:true}));
}finally{await writeFile('/tmp/forge-studio-458-prep/model-capability-comparison/binding/live-adapter/live/hosted-'+process.argv[2]+'-evidence.json',JSON.stringify({out,pageErrors:errors},null,2));await browser.close();}
