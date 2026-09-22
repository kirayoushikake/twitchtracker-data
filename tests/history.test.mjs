import test from 'node:test';
import assert from 'node:assert/strict';
import {readHistory, selectHistory, detailSheetName} from '../src/history.mjs';

test('reads all DataTables pages and keeps more than 40 window records',async()=>{
  const rows=Array.from({length:85},(_,i)=>({url:`https://twitchtracker.com/dinah/streams/${1000+i}`,utc:`2026-09-01 00:${String(i%60).padStart(2,'0')}:00`}));
  let length=20,drawn=false;
  const table={page:{len(n){length=n;return {draw(){drawn=true}}},info(){return {recordsTotal:rows.length}}}};
  const jq=()=>({DataTable:()=>table});jq.fn={dataTable:{isDataTable:()=>true}};
  globalThis.window={jQuery:jq};
  globalThis.document={querySelectorAll:()=>rows.slice(0,length===-1?rows.length:length).map(row=>({cells:[{getAttribute:()=>row.utc},{getAttribute:()=>60},null,null,null,null,{textContent:'title'}],querySelector:()=>({href:row.url}),querySelectorAll:()=>[]}))};
  try {
    const result=await readHistory({waitForFunction:async fn=>assert(fn()),evaluate:async fn=>fn()},'dinah');
    assert(drawn);assert.equal(length,-1);assert.equal(result.rows.length,85);
    assert.equal(selectHistory(result.rows,Date.parse('2026-09-01T00:00:00Z'),Date.parse('2026-09-02T00:00:00Z')).length,85);
    assert.equal(selectHistory(result.rows,Date.parse('2026-09-02T00:00:00Z'),Date.parse('2026-09-03T00:00:00Z')).length,0);
  } finally {delete globalThis.window;delete globalThis.document;}
});
test('incomplete history is rejected',async()=>{
  await assert.rejects(()=>readHistory({waitForFunction:async()=>{},evaluate:async()=>({total:85,rows:[]})},'dinah'),/incomplete history/);
});
test('sheet names retain year and use UTC+8 across the new year',()=>{
  assert.equal(detailSheetName(1,{startMs:Date.parse('2025-12-31T16:05:00Z')}),'01_2026-01-01_0005');
  assert.equal(detailSheetName(105,{viewerPoints:[{x:Date.parse('2025-09-22T07:00:00Z')}]}),'105_2025-09-22_1500');
  assert.throws(()=>detailSheetName(1,{}),/start time/);
});
