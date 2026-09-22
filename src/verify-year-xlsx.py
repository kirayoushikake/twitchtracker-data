"""Read-only validation of saved annual XLSX files against prepared source records."""
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(os.environ.get('TWITCHTRACKER_BATCH_DIR', Path(__file__).resolve().parents[1] / 'output/year-2026-09-22'))
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
reports = []
for slug in ('sayu', 'dinah', 'lucypyre'):
    data = json.loads((ROOT / slug / 'prepared.json').read_text(encoding='utf-8'))
    filename = ROOT / f'{slug}_twitchtracker_365d.xlsx'
    with zipfile.ZipFile(filename) as archive:
        book = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = book.findall('s:sheets/s:sheet', NS)
        assert len(sheets) == data['expected'] + 1, slug
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(x.itertext()) for x in ET.fromstring(archive.read('xl/sharedStrings.xml'))]

        def cells(sheet_number):
            xml = ET.fromstring(archive.read(f'xl/worksheets/sheet{sheet_number}.xml'))
            assert not xml.findall('.//s:pane', NS), (slug, sheet_number, 'frozen pane')
            result = {}
            for cell in xml.findall('.//s:sheetData/s:row/s:c', NS):
                assert cell.get('t') != 'e', (slug, sheet_number, cell.attrib)
                val = cell.find('s:v', NS)
                text = val.text if val is not None else ''
                if cell.get('t') == 's':
                    text = shared[int(text)]
                elif cell.get('t') == 'inlineStr':
                    text = ''.join(cell.find('s:is', NS).itertext())
                result[cell.get('r')] = text
            return result

        summary = cells(1)
        for i, record in enumerate(data['records'], 1):
            assert summary[f'D{i+1}'] == record['streamId']
            assert summary[f'C{i+1}'] == record['sourceUrl']
            stamp=datetime.fromtimestamp(record['startMs']/1000, timezone(timedelta(hours=8)))
            assert sheets[i].get('name') == f'{i:02d}_{stamp:%Y-%m-%d_%H%M}'
            detail = cells(i+1)
            assert record['sourceUrl'] in detail.values()
            if record['chartUnavailable']:
                assert any('网站未提供' in str(v) for v in detail.values())
                continue
            row = next(int(k[1:]) for k, v in detail.items() if k.startswith('A') and v == '时间 (UTC+8)')
            for offset, point in enumerate(record['viewerPoints'], 1):
                assert float(detail[f'C{row+offset}']) == point['y'], (slug, record['streamId'], offset)
                markers = [m for m in record['contentMarkers'] if m['ms'] <= point['x']]
                if markers:
                    assert detail[f'D{row+offset}'] == markers[-1]['label']
        charts = [x for x in archive.namelist() if '/charts/chart' in x and x.endswith('.xml')]
        assert len(charts) == sum(not r['chartUnavailable'] for r in data['records']) * 2
        reports.append({'channel': slug, 'sheets': len(sheets), 'charts': len(charts), 'bytes': filename.stat().st_size, 'passed': True})
(ROOT / 'xlsx-verification.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(reports, ensure_ascii=False, indent=2))
