import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { normalize, rawPage, target } from './cli.mjs';
import { readHistory, selectHistory } from './history.mjs';

import {batchRoot} from './batch-path.mjs';
const out = batchRoot;
await fs.mkdir(out,{recursive:true});
const configPath = path.join(out,'window.json');
let window;
try { window=JSON.parse(await fs.readFile(configPath,'utf8')); }
catch { const end=Date.now(); window={days:365,end:new Date(end).toISOString(),start:new Date(end-365*86400000).toISOString()}; await fs.writeFile(configPath,JSON.stringify(window,null,2)); }
const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
try {
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('twitchtracker.com')) || await browser.contexts()[0].newPage();
  for(const slug of process.argv.slice(2).length?process.argv.slice(2):['sayu','dinah','lucypyre']) {
    const dir=path.join(out,slug); await fs.mkdir(dir,{recursive:true});
    await page.goto(`https://twitchtracker.com/${slug}/streams`,{waitUntil:'domcontentloaded',timeout:60000});
    const listing=await readHistory(page,slug);
    const rows=selectHistory(listing.rows,Date.parse(window.start),Date.parse(window.end));
    await fs.writeFile(path.join(dir,'listing.json'),JSON.stringify({window,...listing,selected:rows.length},null,2));
    console.log(`${slug}: ${rows.length} streams in window / ${listing.total} historical rows`);
    const records=[], failures=[];
    for(const [i,row] of rows.entries()) {
      const t=target(row.url), cache=path.join(dir,`${t.id}.json`);
      try {
        let raw;
        try {raw=JSON.parse(await fs.readFile(cache,'utf8'));} catch {
          await page.goto(row.url,{waitUntil:'domcontentloaded',timeout:60000});
          await page.waitForFunction(()=>window.Highcharts?.charts?.some(c=>c?.renderTo?.id==='chart-stream'&&c.series?.some(s=>/Concur.*Viewers/i.test(s.name)&&s.points?.length)) || (document.readyState==='complete' && !document.querySelector('#chart-stream') && /STREAM SUMMARY/.test(document.body.innerText)),null,{timeout:45000});
          raw=await rawPage(page,true);
          if(new URL(raw.sourceUrl).pathname!==new URL(row.url).pathname) throw Error('wrong page');
          await fs.writeFile(cache,JSON.stringify(raw));
          await page.waitForTimeout(1000);
        }
        const d=normalize(raw,t);
        d.listing=row;
        records.push(d);
        console.log(`${slug} ${i+1}/${rows.length} ${t.id} points=${d.viewerPoints.length}`);
      } catch(e) { failures.push({url:row.url,error:e.message});console.log(`FAILED ${row.url}: ${e.message.split('\n')[0]}`); }
      await fs.writeFile(path.join(dir,'collection.json'),JSON.stringify({window,channel:slug,expected:rows.length,collected:records.length,failures,complete:records.length===rows.length,records},null,2));
      if(failures.length>=3 && records.length===0) break;
    }
  }
} finally {await browser.close();}
