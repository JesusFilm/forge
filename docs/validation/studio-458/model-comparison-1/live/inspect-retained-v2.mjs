import {chromium} from '/home/tataihono/.codex/worktrees/8b33/forge/apps/shorts-worker/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const base='/tmp/forge-studio-458-prep/model-capability-comparison/binding/live-adapter/live';
const proposal=JSON.parse(await readFile(base+'/../../verified-bound-proposal.body','utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'}),page=await context.newPage(),errors=[],out=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
try{
 await context.request.get('http://studio458.localhost:3589/local-fixture-login',{maxRedirects:0});
 for(const planned of proposal.runOrder.filter(p=>p.slot<4)){
  const evidence=JSON.parse(await readFile(base+'/hosted-'+planned.slot+'-evidence.json','utf8'));
  const events=evidence.out[0].events.trim().split('\n').map(JSON.parse),admitted=events.find(e=>e.event?.type==='admitted').event;
  const c=proposal.cases.find(c=>c.case===planned.case);
  await page.goto('http://studio458.localhost:3588/dashboard/shorts/'+c.project.projectId,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Generate scripts',exact:true}).click();
  await page.getByRole('checkbox',{name:new RegExp(c.project.projectId)}).waitFor();
  await page.getByRole('button',{name:'Load retained generation attempts',exact:true}).click();
  await page.locator('select option[value="'+admitted.attemptId+'"]').waitFor({state:'attached'});
  const pending=page.waitForResponse(async r=>r.url().endsWith('/api/studio/command')&&r.request().postDataJSON()?.action==='generation-read');
  await page.getByLabel('Attempt',{exact:true}).selectOption(admitted.attemptId);
  const response=await pending,bytes=await response.text();await writeFile(base+'/retained-'+planned.slot+'.body',bytes);
  const data=JSON.parse(bytes).result;if(!data)throw new Error('Retained read failed');
  if(data.previews.length){
   const button=page.getByRole('button',{name:'Preview proposed composition',exact:true});await button.scrollIntoViewIfNeeded();await button.click();
   const section=page.getByRole('region',{name:'Proposed composition preview'});await section.scrollIntoViewIfNeeded();await page.waitForTimeout(1500);
   await section.screenshot({path:base+'/preview-'+planned.slot+'.png'});
   await writeFile(base+'/retained-'+planned.slot+'-ui.txt',await page.locator('body').innerText());
  }
  out.push({slot:planned.slot,attemptId:admitted.attemptId,status:data.status,proposalCount:data.proposalCount,previewCount:data.previews.length,http:response.status()});
 }
}catch(e){await page.screenshot({path:base+'/preview-inspection-failure.png',fullPage:true});throw e;}finally{await writeFile(base+'/preview-inspection.json',JSON.stringify({out,pageErrors:errors,applied:false,newGenerationRequests:0},null,2));await browser.close();}
