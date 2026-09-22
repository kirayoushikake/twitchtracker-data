import fs from 'node:fs/promises';
import path from 'node:path';
import {workbookFull} from './cli.mjs';
const data=JSON.parse(await fs.readFile('output/year-2026-09-22/dinah/prepared.json','utf8'));
const submitted=data.records.find(r=>r.streamId==='316084001897');
if(!submitted) throw Error('Missing example source; collect the Dinah batch first');
const records=data.records.filter(r=>r.startMs<=submitted.startMs && r.startMs>=submitted.startMs-30*86400000);
console.log(await workbookFull(submitted,records,path.resolve('output/examples'),true,30));
