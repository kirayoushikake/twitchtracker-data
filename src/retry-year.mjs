import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {rawPage} from './cli.mjs';
import {batchRoot} from './batch-path.mjs';
const root=batchRoot;
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
try {
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('twitchtracker.com'));
 for(const slug of process.argv.slice(2).length ? process.argv.slice(2) : ['sayu','dinah','lucypyre']) {
  const dir=path.join(root,slug),data=JSON.parse(await fs.readFile(path.join(dir,'prepared.json'),'utf8'));
  for(const item of data.failures) {
   try {
    await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>window.Highcharts?.charts?.some(c=>c?.renderTo?.id==='chart-stream'&&c.series?.some(s=>/Concur.*Viewers/i.test(s.name)&&s.points?.length)) || (document.readyState==='complete' && !document.querySelector('#chart-stream') && /STREAM SUMMARY/.test(document.body.innerText)),null,{timeout:60000});
    const raw=await rawPage(page,true);
    if(new URL(raw.sourceUrl).pathname!==new URL(item.url).pathname) throw Error('wrong page');
    await fs.writeFile(path.join(dir,`${item.url.split('/').at(-1)}.json`),JSON.stringify(raw));console.log(`Recovered ${item.url}${raw.chartUnavailable?' (source has no chart)':''}`);
   }catch(e){console.log(`Still unavailable ${item.url}: ${e.message.split('\n')[0]}`);}
  }
 }
}finally{await browser.close();}
