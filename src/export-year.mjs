import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook,SpreadsheetFile } from '@oai/artifact-tool';
import { addCombinedDetail } from './cli.mjs';
import {batchRoot} from './batch-path.mjs';
const root=batchRoot;
for(const slug of process.argv.slice(2).length?process.argv.slice(2):['sayu','dinah','lucypyre']) {
  const dir=path.join(root,slug),data=JSON.parse(await fs.readFile(path.join(dir,'prepared.json'),'utf8'));
  if(!data.complete) throw Error(`${slug}: ${data.failures.length} missing streams; finish collection before export`);
  const wb=Workbook.create(),sum=wb.worksheets.add('365天汇总');sum.showGridLines=false;
  const header=['序号','开始时间 (UTC+8)','直播页面 URL','Stream ID','Duration (分钟)','Watch time (分钟)','平均观众','峰值观众','关注变化','游戏','状态'];
  const rows=data.records.map((d,i)=>[i+1,d.startMs/86400000+25569+8/24,d.sourceUrl,d.streamId,d.listing.durationMinutes,d.summary.hoursWatched==null?null:d.summary.hoursWatched*60,d.summary.avgViewers,d.summary.peakViewers,d.summary.followersGained,[...new Set(d.games.map(g=>g.name))].join(', '),d.chartUnavailable?'已结束；网站无 CCV 序列':d.live?'直播中：快照':'已结束']);
  sum.getRange('D:D').format.numberFormat='@';
  sum.getRange(`A1:K${rows.length+1}`).values=[header,...rows];
  sum.getRange('A1:K1').format={fill:'#1E3A5F',font:{bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:32};
  sum.getRange('A:K').format.columnWidth=18;sum.getRange('B:B').format.columnWidth=24;sum.getRange('C:C').format.columnWidth=55;sum.getRange('D:D').format.columnWidth=22;sum.getRange('J:J').format.columnWidth=55;
  sum.getRange(`B2:B${rows.length+1}`).format.numberFormat='yyyy-mm-dd hh:mm';sum.getRange(`E2:F${rows.length+1}`).format.numberFormat='0.0';
  sum.getRange(`J2:K${rows.length+1}`).format.wrapText=true;
  for(const [i,row] of rows.entries()) sum.getRange(`A${i+2}:K${i+2}`).format.rowHeight=Math.max(32,Math.ceil(String(row[9]).length/45)*16);
  sum.getRange('M1:N4').values=[['窗口起点 UTC',data.window.start],['窗口终点 UTC',data.window.end],['历史列表内场次数',data.expected],['已读取详情场次数',data.collected]];sum.getRange('M:N').format.columnWidth=30;
  const previews=[];
  for(const [index,d] of data.records.entries()) {
    const s=addCombinedDetail(wb,d,index+1);s.freezePanes.unfreeze();
    s.getRange('A:T').format.columnWidth=18;s.getRange('A:B').format.columnWidth=25;s.getRange('D:D').format.columnWidth=32;s.getRange('E:E').format.columnWidth=32;s.getRange('G:G').format.columnWidth=48;
    const values=s.getUsedRange().values;
    const find=t=>values.findIndex(row=>row[0]===t)+1;
    const main=find('Local time (UTC+8)'),ccv=find('时间 (UTC+8)'),seg=find('标记');
    const title=find('Time (UTC+8)');
    if(title) for(let r=title+1;r<=title+Math.max(1,d.titleChanges.length);r++) {s.getRange(`B${r}:J${r}`).merge();s.getRange(`B${r}:J${r}`).format.wrapText=true;s.getRange(`A${r}:J${r}`).format.rowHeight=38;}
    const timeline=find('STARTED');
    if(timeline) {s.getRange(`B${timeline}`).values=[[d.summary.started]];s.getRange(`D${timeline}`).values=[[d.summary.ended]];}
    if(main) {
      s.getRange(`B${main+1}:B${main+d.viewerPoints.length}`).values=d.viewerPoints.map(p=>[p.x/86400000+25569]);
      s.getRange(`B${main+1}:B${main+d.viewerPoints.length}`).format.numberFormat='yyyy-mm-dd hh:mm:ss';
      s.getRange(`D${main+1}:D${main+d.viewerPoints.length}`).values=d.followerPoints.map(p=>[p.y]);
      s.getRange(`A${main}:M${main}`).format.wrapText=true;s.getRange(`A${main}:M${main}`).format.rowHeight=34;
    }
    const games=find('Game');
    if(games) for(let i=0;i<d.games.length;i++) if(!d.games[i].duration)s.getRange(`E${games+1+i}`).values=[[null]];
    if(seg) {
      for(const [i,m] of d.contentMarkers.entries()) {
        const end=d.contentMarkers[i+1]?.ms??d.endMs;
        s.getRange(`D${seg+1+i}`).values=[[(end-m.ms)/60000]];
        s.getRange(`C${seg+1+i}`).values=[[new Date(end+8*3600000).toISOString().slice(11,16)]];
      }
    }
    if(ccv) s.getRange(`A${ccv}:D${ccv}`).format.rowHeight=32;
    // Verify every exported CCV category against the saved chart markers.
    for(const [i,p] of d.viewerPoints.entries()) {
      const marker=d.contentMarkers.filter(m=>m.ms<=p.x).at(-1);
      if(marker && s.getRange(`D${ccv+1+i}`).values[0][0]!==marker.label) throw Error(`${d.streamId}: category mismatch`);
    }
    previews.push({name:s.name,range:ccv?`A${ccv-1}:D${Math.min(ccv+5,ccv+d.viewerPoints.length)}`:'A30:J47'});
    if(index%25===0) console.log(`${slug}: built ${index+1}/${data.records.length}`);
  }
  wb.recalculate();
  const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!',options:{useRegex:true,maxResults:30}});
  await fs.writeFile(path.join(dir,'formula-check.ndjson'),errors.ndjson);
  if(!errors.ndjson.includes('0 entries')) throw Error(errors.ndjson);
  for(const p of [{name:'365天汇总',range:'A1:K10'},...previews]) {
    const image=await wb.render({sheetName:p.name,range:p.range,scale:1,format:'png'});
    await fs.writeFile(path.join(dir,`${p.name}.png`),new Uint8Array(await image.arrayBuffer()));
  }
  const file=await SpreadsheetFile.exportXlsx(wb),filename=path.join(root,`${slug}_twitchtracker_365d.xlsx`);await file.save(filename);console.log(filename);
}
