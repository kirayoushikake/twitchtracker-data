import fs from 'node:fs/promises';
import path from 'node:path';
import { normalize,target } from './cli.mjs';
import {batchRoot} from './batch-path.mjs';
const root=process.argv[2] ? path.resolve(process.argv[2]) : batchRoot;
const window=JSON.parse(await fs.readFile(path.join(root,'window.json'),'utf8'));
const local=ms=>new Date(ms+8*3600000).toISOString().replace('T',' ').slice(0,19);
for(const slug of ['sayu','dinah','lucypyre']) {
  const dir=path.join(root,slug); let list;
  try{list=JSON.parse(await fs.readFile(path.join(dir,'listing.json'),'utf8'));}catch{continue;}
  const selected=list.rows.filter(r=>{const t=Date.parse(r.utc.replace(' ','T')+'Z');return t>=Date.parse(window.start)&&t<=Date.parse(window.end);});
  const records=[],failures=[],warnings=[];
  for(const row of selected) {
    try {
      const t=target(row.url),raw=JSON.parse(await fs.readFile(path.join(dir,`${t.id}.json`),'utf8'));
      if(new URL(raw.sourceUrl).pathname!==new URL(row.url).pathname) throw Error('cached page URL does not match listing');
      const d=normalize(raw,t),start=d.startMs;
      if(Math.abs(start-Date.parse(row.utc.replace(' ','T')+'Z'))>60000) throw Error('stream timestamp does not match listing');
      const live=/STREAMING NOW/.test(raw.bodyText);
      const rawEnd=raw.timestamps?.[1]||'';
      let end;
      if(/^\d{4}-\d{2}-\d{2} /.test(rawEnd)) end=Date.parse(rawEnd.replace(' ','T')+'Z');
      else if(/\d{2}:\d{2}/.test(rawEnd)) {
        const time=rawEnd.match(/\d{2}:\d{2}/)[0];
        end=Date.parse(`${local(start).slice(0,10)}T${time}:00+08:00`);
        while(end<(d.viewerPoints.at(-1)?.x??start)) end+=86400000;
      } else end=d.viewerPoints.at(-1)?.x??start+row.durationMinutes*60000;
      d.summary.started=local(start); d.summary.ended=live?'直播中（采集快照）':local(end);
      d.summary.duration=live ? d.summary.duration : String(row.durationMinutes);
      d.summary.streamDate=local(start).slice(0,10);
      d.startMs=start;d.endMs=end;d.live=live;
      if(d.chartUnavailable) warnings.push({id:t.id,issue:'source page has no CCV time series; overview retained'});
      d.contentMarkers=d.contentMarkers.filter(m=>Number.isFinite(m.ms)).sort((a,b)=>a.ms-b.ms);
      if(!d.plotLines.length && d.games.length !== 1) {d.contentMarkers=[{ms:start,time:local(start).slice(11,16),label:'未提供游戏时间标记'}];warnings.push({id:t.id,issue:'missing game markers'});}
      const followerQueues=new Map();
      for(const p of d.followerPoints) {if(!followerQueues.has(p.x)) followerQueues.set(p.x,[]);followerQueues.get(p.x).push(p);}
      d.followerPoints=d.viewerPoints.map(p=>followerQueues.get(p.x)?.shift()||{x:p.x,y:null});
      if(d.games.some(g=>g.avgViewers===null)) warnings.push({id:t.id,issue:'missing game-level statistics'});
      if(!d.titleChanges.length) warnings.push({id:t.id,issue:'no title changes captured'});
      d.listing=row;records.push(d);
    }catch(e){failures.push({url:row.url,error:e.message});}
  }
  records.sort((a,b)=>b.startMs-a.startMs);
  const result={channel:slug,window,expected:selected.length,collected:records.length,complete:failures.length===0,failures,warnings,records};
  await fs.writeFile(path.join(dir,'prepared.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({channel:slug,expected:selected.length,collected:records.length,failures:failures.length,warnings:warnings.length}));
}
