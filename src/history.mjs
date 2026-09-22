// DataTables resolves the real stream links while drawing its rows.
export async function readHistory(page, slug) {
  await page.waitForFunction(() => window.jQuery?.fn?.dataTable?.isDataTable('#streams'), null, {timeout:60000});
  const listing = await page.evaluate(() => {
    const table = window.jQuery('#streams').DataTable();
    table.page.len(-1).draw();
    return {total:table.page.info().recordsTotal, rows:[...document.querySelectorAll('#streams tbody tr')].filter(tr=>tr.cells.length>1).map(tr=>({
      url:tr.querySelector('a')?.href,
      utc:tr.cells[0]?.getAttribute('data-order'),
      durationMinutes:Number(tr.cells[1]?.getAttribute('data-order')),
      title:tr.cells[6]?.textContent.trim(),
      games:[...tr.querySelectorAll('td.games img')].map(i=>i.getAttribute('data-original-title')||i.title||i.alt)
    }))};
  });
  if(listing.total!==listing.rows.length) throw Error(`${slug}: incomplete history list`);
  for(const row of listing.rows) {
    const url=new URL(row.url);
    if(url.hostname!=='twitchtracker.com' || !new RegExp(`^/${slug}/streams/\\d+$`,'i').test(url.pathname)) throw Error(`${slug}: unresolved stream URL`);
    if(!Number.isFinite(Date.parse(row.utc.replace(' ','T')+'Z'))) throw Error(`${slug}: invalid history timestamp`);
  }
  return listing;
}

export function selectHistory(rows, start, end) {
  return rows.filter(row=>{
    const time=Date.parse(row.utc.replace(' ','T')+'Z');
    return time>=start && time<=end;
  });
}

export function detailSheetName(index, record) {
  const ms=record.startMs ?? record.viewerPoints?.[0]?.x;
  if(!Number.isFinite(ms)) throw Error('Cannot name worksheet without stream start time');
  const local=new Date(ms+8*3600000).toISOString();
  return `${String(index).padStart(2,'0')}_${local.slice(0,10)}_${local.slice(11,16).replace(':','')}`;
}
