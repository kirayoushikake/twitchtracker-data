import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {batchRoot} from './batch-path.mjs';
const root=batchRoot,report=[];
for(const slug of process.argv.slice(2).length ? process.argv.slice(2) : ['sayu','dinah','lucypyre']) {
  const data=JSON.parse(await fs.readFile(path.join(root,slug,'prepared.json'),'utf8'));
  assert.equal(data.collected,data.expected,`${slug}: missing records`);
  assert.equal(new Set(data.records.map(d=>d.streamId)).size,data.expected,`${slug}: duplicate records`);
  let count=0;
  for(const d of data.records) {
    assert.equal(d.channelSlug,slug);
    assert(d.startMs>=Date.parse(data.window.start)&&d.startMs<=Date.parse(data.window.end));
    assert(d.endMs>=(d.viewerPoints.at(-1)?.x??d.startMs));
    assert(d.viewerPoints.length>0 || d.chartUnavailable);
    // The website can include its start-at-zero point at the first sample timestamp.
    // Preserve both source points in source order rather than dropping real values.
    assert(d.viewerPoints.every((p,i)=>Number.isFinite(p.y)&&p.y>=0&&(!i||p.x>=d.viewerPoints[i-1].x)));
    assert(d.contentMarkers.every((m,i)=>m.ms>=d.startMs&&m.ms<=d.endMs&&(!i||m.ms>=d.contentMarkers[i-1].ms)));
    assert(!d.contentMarkers.some(m=>m.label==='Start'||/^\d{2}:\d{2}$/.test(m.label)));
    count+=d.viewerPoints.length;
  }
  report.push({channel:slug,streams:data.collected,ccvPoints:count,withoutCCV:data.records.filter(d=>d.chartUnavailable).map(d=>d.streamId),oldest:data.records.at(-1).summary.started,newest:data.records[0].summary.started,live:data.records.filter(d=>d.live).length,warnings:data.warnings});
}
await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
