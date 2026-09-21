import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const REDS = new Set(["#e74c3c", "rgb(231,76,60)", "rgb(231, 76, 60)"]);
const clean = (v) => String(v ?? "").trim();
const num = (v) => {
  const s = clean(v).replace(/,/g, "");
  if (/^[-+]?\d+(\.\d+)?k$/i.test(s)) return parseFloat(s) * 1000;
  if (/^[-+]?\d+(\.\d+)?m$/i.test(s)) return parseFloat(s) * 1e6;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const lines = (t) =>
  String(t || "")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
const before = (a, l) => {
  const i = a.findIndex((x) => x.toLowerCase() === l.toLowerCase());
  return i > 0 ? a[i - 1] : null;
};
const localLabel = (ms) =>
  new Date(ms + 8 * 3600000).toISOString().slice(11, 16);
const dateLabel = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const durationHours = (value) => {
  const h = String(value || "").match(/(\d+)h/),
    m = String(value || "").match(/(\d+)m/);
  return (h ? Number(h[1]) : 0) + (m ? Number(m[1]) : 0) / 60;
};
const contentAt = (markers, ms) => {
  let label = markers?.[0]?.label || "未标注内容";
  for (const marker of markers || []) {
    if (marker.ms <= ms) label = marker.label;
    else break;
  }
  return label;
};
function target(url) {
  const u = new URL(url);
  const m = u.pathname.match(/^\/([^/]+)\/streams\/(\d+)\/?$/i);
  if (!m || !/twitchtracker\.com$/i.test(u.hostname))
    throw Error("URL 必须是 https://twitchtracker.com/<channel>/streams/<id>");
  return { url: u.href, slug: m[1].toLowerCase(), id: m[2] };
}
function parseTimed(text) {
  const a = lines(text),
    o = [];
  for (let i = 0; i < a.length - 1; i++)
    if (/^\d{2}:\d{2}$/.test(a[i])) o.push({ time: a[i], title: a[i + 1] });
  return o;
}
function parseGames(raw) {
  const names = [
    ...new Set((raw.gameLinks || []).map((x) => x.text).filter(Boolean)),
  ];
  const a = lines(raw.gameSectionText),
    out = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i],
      start = a.indexOf(name);
    if (start < 0) continue;
    const next = i + 1 < names.length ? a.indexOf(names[i + 1], start + 1) : -1;
    const chunk = a.slice(start, next >= 0 ? next : a.length);
    const metric = (label) => num(before(chunk, label));
    out.push({
      name,
      avgViewers: metric("Avg viewers"),
      peakViewers: metric("Peak viewers"),
      duration: before(chunk, "Duration"),
      followersGained: metric("Followers gained"),
      followersPerHour: metric("Followers per hour"),
      hoursWatched: metric("Hours watched"),
      url: raw.gameLinks.find((x) => x.text === name)?.href || "",
    });
  }
  return out;
}
function normalize(raw, t) {
  const a = lines(raw.bodyText),
    v = raw.series?.find((x) => /Concur.*Viewers/i.test(x.name))?.points || [],
    f = (
      raw.series?.find((x) => /Followers Gain/i.test(x.name))?.points || []
    ).map((p) => ({
      ...p,
      y: REDS.has(clean(p.color).toLowerCase().replace(/\s+/g, ""))
        ? -Math.abs(p.y || 0)
        : p.y || 0,
    }));
  if (!v.length) throw Error("没有读取到 Concur. Viewers series");
  const summary = {
    rank: num(a[a.findIndex((x) => x === "RANK") + 1]),
    duration: before(a, "Stream duration"),
    avgViewers: num(before(a, "Avg viewers")),
    peakViewers: num(before(a, "Peak viewers")),
    hoursWatched: num(before(a, "Hours watched")),
    followersGained: num(before(a, "Followers gained")),
    followersPerHour: num(before(a, "Followers per hour")),
    streamDate: (a.find((x) => /^STREAM ON /i.test(x)) || "").replace(
      /^STREAM ON /i,
      "",
    ),
    started: raw.timestamps?.[0] || "",
    ended: raw.timestamps?.[1] || "",
  };
  const parsedTitles = parseTimed(raw.titleChangesSection).filter((x) => x.title && !/^\d{2}:\d{2}$/.test(x.title) && x.title !== "Start");
  const titles = parsedTitles.length
    ? parsedTitles
    : [];
  const marker = [];
  let previousMinute = -1;
  for (const x of titles) {
    const [hh, mm] = x.time.split(":").map(Number);
    const minute = hh * 60 + mm;
    const dayOffset = minute < previousMinute ? 1 : 0;
    const base = marker.length ? marker.at(-1).ms + dayOffset * 86400000 : Date.parse(`${dateLabel(v[0].x)}T${x.time}:00+08:00`);
    const ms = marker.length ? Date.parse(`${dateLabel(base)}T${x.time}:00+08:00`) : base;
    marker.push({ ms, time: x.time, label: x.title });
    previousMinute = minute;
  }
  const plotMarkers = (raw.plotLines || [])
    .filter((x) => x.label && x.label !== "Start" && Number.isFinite(Number(x.value)))
    .map((x) => ({ ms: Number(x.value), time: localLabel(Number(x.value)), label: x.label }));
  const parsedGames = raw.games?.length ? raw.games : parseGames(raw);
  const games = parsedGames.length
    ? parsedGames
    : plotMarkers.map((x) => ({ name: x.label, avgViewers: null, peakViewers: null, duration: "", followersGained: null, followersPerHour: null, hoursWatched: null, url: "" }));
  return {
    sourceUrl: t.url,
    channelSlug: t.slug,
    streamId: t.id,
    channelName: raw.channel?.name || t.slug,
    channelId: raw.channel?.id || "",
    channelCreatedAt: raw.channel?.created_at || "",
    pageTitle: raw.title || "",
    description: raw.description || "",
    summary,
    viewerPoints: v,
    followerPoints: f,
    plotLines: raw.plotLines || [],
    titleChanges: titles,
    currentTitle: titles.at(-1)?.title || "",
    games,
    clips: raw.clips || [],
    contentMarkers: plotMarkers.length
      ? plotMarkers
      : marker.length
        ? marker
      : [{ ms: v[0].x, time: localLabel(v[0].x), label: "未标注内容" }],
  };
}
async function rawPage(page) {
  return page.evaluate(() => {
    const clean = (x) => String(x || "").trim(),
      section = (h) => {
        const e = [...document.querySelectorAll("h4")].find(
          (x) => clean(x.innerText).toUpperCase() === h,
        );
        return (
          e?.closest("section")?.innerText ||
          e?.parentElement?.parentElement?.innerText ||
          e?.parentElement?.innerText ||
          ""
        );
      };
    const c = window.Highcharts?.charts?.find(
      (x) => x?.renderTo?.id === "chart-stream",
    );
    if (!c) throw Error("页面没有 chart-stream");
    const gs =
      document.querySelector("#stream-games") ||
      [...document.querySelectorAll("section")].find((x) =>
        /PLAYED GAMES/i.test(x.innerText),
      );
    return {
      sourceUrl: location.href,
      bodyText: document.body.innerText,
      title: document.title,
      description:
        document.querySelector('meta[name="description"]')?.content || "",
      channel: window.channel || {},
      timestamps: [...document.querySelectorAll(".stream-timestamp-dt")].map(
        (x) => clean(x.innerText),
      ),
      series: (c.series || []).map((s) => ({
        name: s.name,
        points: (s.points || []).map((p) => ({ x: p.x, y: p.y, color: p.color })),
      })),
      plotLines: (c.xAxis?.[0]?.plotLinesAndBands || []).map((b) => ({
        value: b.options?.value,
        label: b.options?.label?.text || b.label?.text?.textStr || "",
      })),
      titleChangesSection: section("STREAM TITLE CHANGES"),
      gameLinks: gs
        ? [...gs.querySelectorAll('a[href*="/games/"]')].map((a) => ({
            text: clean(a.innerText),
            href: a.href,
          }))
        : [],
      clips: [],
    };
  });
}
async function openBrowser(headed, cdpUrl) {
  if (cdpUrl) return { browser: await chromium.connectOverCDP(cdpUrl), remote: true };
  return { browser: await chromium.launch({ headless: !headed, channel: "msedge" }), remote: false };
}
async function closeBrowser(browser, remote) {
  if (remote) return;
  await browser.close();
}
async function getCapturePage(browser, remote) {
  if (remote) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (const page of pages) {
      const ready = await page.evaluate(() => Boolean(document.querySelector("#chart-stream") && window.Highcharts?.charts?.some((c) => c?.renderTo?.id === "chart-stream" && c.series?.length))).catch(() => false);
      if (ready) return page;
    }
    const ready = pages.find((p) => p.url().includes("/streams/") && p.url().includes("twitchtracker.com"));
    if (ready) return ready;
  }
  return browser.newPage();
}
async function capture(t, headed, cdpUrl) {
  const { browser, remote } = await openBrowser(headed, cdpUrl);
  try {
    const page = await getCapturePage(browser, remote);
    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
    /*
      locale: "en-US",
      timezoneId: "Asia/Singapore",
    */
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#chart-stream", {
      timeout: headed ? 180000 : 45000,
    });
    await page.waitForFunction(
      () =>
        window.Highcharts?.charts?.some(
          (c) => c?.renderTo?.id === "chart-stream" && c.series?.length >= 2,
        ),
      null,
      { timeout: headed ? 180000 : 45000 },
    );
    return normalize(await rawPage(page), t);
  } finally {
    await closeBrowser(browser, remote);
  }
}
async function captureWindow(t, headed, windowDays = 30, cdpUrl) {
  const { browser, remote } = await openBrowser(headed, cdpUrl);
  try {
    const page = await getCapturePage(browser, remote);
    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
    /*
      locale: "en-US",
      timezoneId: "Asia/Singapore",
    */
    const open = async (url) => {
      if (remote && page.url() === url && await page.locator("#chart-stream").count() && await page.evaluate(() => window.Highcharts?.charts?.some((c) => c?.renderTo?.id === "chart-stream" && c.series?.length >= 2)).catch(() => false)) return;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("#chart-stream", {
        timeout: headed ? 180000 : 45000,
      });
      await page.waitForFunction(
        () =>
          window.Highcharts?.charts?.some(
            (c) => c?.renderTo?.id === "chart-stream" && c.series?.length >= 2,
          ),
        null,
        { timeout: headed ? 180000 : 45000 },
      );
    };
    await open(t.url);
    const first = normalize(await rawPage(page), t);
    await page.goto(`https://twitchtracker.com/${t.slug}/streams`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const urls = await page.evaluate(
      (slug) =>
        [...document.querySelectorAll("a[href]")]
          .map((a) => a.href)
          .filter((x) =>
            new RegExp(
              `^https://twitchtracker\\.com/${slug}/streams/\\d+$`,
              "i",
            ).test(x),
          ),
      t.slug,
    );
    const uniq = [...new Set(urls)];
    const anchor = first.viewerPoints[0]?.x || Date.now();
    if (windowDays === 0) return [first];
    const cutoff = anchor - windowDays * 86400000;
    const out = [first];
    for (const url of uniq) {
      if (out.length >= 40) break;
      const tt = target(url);
      if (tt.id === t.id) continue;
      try {
        await open(url);
        const d = normalize(await rawPage(page), tt);
        if (
          (d.viewerPoints[0]?.x || 0) >= cutoff &&
          (d.viewerPoints[0]?.x || 0) <= anchor + 86400000
        )
          out.push(d);
      } catch (error) {
        console.error(`跳过历史场次 ${url}: ${error.message}`);
      }
    }
    return out.sort(
      (a, b) => (b.viewerPoints[0]?.x || 0) - (a.viewerPoints[0]?.x || 0),
    );
  } finally {
    await closeBrowser(browser, remote);
  }
}
async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
function detailRows(d) {
  const rows = [
    ["Field", "Value", "Source / note"],
    ["Channel", d.channelName, d.sourceUrl],
    ["Stream ID", d.streamId, d.sourceUrl],
    ["Stream date", d.summary.streamDate, "visible page"],
    ["Started", d.summary.started, "UTC+8"],
    ["Ended", d.summary.ended, "UTC+8"],
    ["Duration", d.summary.duration, "visible page"],
    ["Avg viewers", d.summary.avgViewers, "visible page"],
    ["Peak viewers", d.summary.peakViewers, "visible page"],
    ["Hours watched", d.summary.hoursWatched, "visible page"],
    ["Followers gained", d.summary.followersGained, "visible page"],
    ["Followers / hour", d.summary.followersPerHour, "visible page"],
    ["Current title", d.currentTitle, "title changes"],
  ];
  rows.push(["", "", ""], ["Time (UTC+8)", "CCV", "Followers Gain"]);
  for (let i = 0; i < d.viewerPoints.length; i++)
    rows.push([
      localLabel(d.viewerPoints[i].x),
      d.viewerPoints[i].y,
      d.followerPoints[i]?.y ?? null,
    ]);
  rows.push(
    ["", "", ""],
    ["Content marker time", "Content", "Basis"],
    ...d.contentMarkers.map((x) => [
      x.time,
      x.label,
      "title change / fallback",
    ]),
  );
  return rows;
}
function sheetName(i, d) {
  return `场次${String(i).padStart(2, "0")}_${dateLabel(d.viewerPoints[0]?.x || Date.now())}_${localLabel(d.viewerPoints[0]?.x || Date.now()).replace(":", "-")}`.slice(
    0,
    31,
  );
}
async function workbook(submitted, records, outDir, quick) {
  const wb = Workbook.create(),
    sum = wb.worksheets.add("30天汇总"),
    link = wb.worksheets.add("提交链接");
  for (const s of [sum, link]) s.showGridLines = false;
  const headers = [
    "序号",
    "Stream start time",
    "Stream URL",
    "Stream",
    "Watch time (mins)",
    "Avg viewers",
    "Peak viewers",
    "Followers gained",
    "Games",
    "状态",
  ];
  const rows = records.map((r, i) => [
    i + 1,
    r.summary.started,
    r.sourceUrl,
    r.streamId,
    r.summary.hoursWatched == null ? null : Number((r.summary.hoursWatched * 60).toFixed(1)),
    r.summary.avgViewers,
    r.summary.peakViewers,
    r.summary.followersGained,
    (r.games || []).map((x) => x.text || x.name).join(", "),
    "completed",
  ]);
  sum.getRange(`A1:J${rows.length + 1}`).values = [headers, ...rows];
  sum.getRange("A1:J1").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    wrapText: true,
  };
  sum.getRange(`A2:J${rows.length + 1}`).format = {
    font: { size: 10, color: "#203040" },
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
  };
  sum.getRange(`E2:E${rows.length + 1}`).format.numberFormat = "0.0";
  sum.getRange("A:J").format.columnWidth = 18;
  sum.getRange("B:B").format.columnWidth = 24;
  sum.getRange("C:C").format.columnWidth = 48;
  sum.getRange("I:I").format.columnWidth = 34;
  link.getRange(`A1:C${detailRows(submitted).length}`).values =
    detailRows(submitted);
  link.getRange("A1:C1").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
  };
  link.getRange("A:C").format.columnWidth = 28;
  link.getRange("B:B").format.columnWidth = 70;
  for (let i = 0; i < records.length; i++) {
    const d = records[i],
      s = wb.worksheets.add(sheetName(i + 1, d));
    s.showGridLines = false;
    const dr = detailRows(d);
    s.getRange(`A1:C${dr.length}`).values = dr;
    s.getRange("A1:C1").format = {
      fill: "#112B4C",
      font: { bold: true, color: "#FFFFFF", size: 14 },
    };
    s.getRange("A14:C14").format = {
      fill: "#1E3A5F",
      font: { bold: true, color: "#FFFFFF" },
    };
    s.getRange(`A${dr.length}:C${dr.length}`).format = {
      fill: "#1E3A5F",
      font: { bold: true, color: "#FFFFFF" },
    };
    s.getRange("A:C").format.columnWidth = 28;
    s.getRange("B:B").format.columnWidth = 70;
    s.freezePanes.freezeRows(1);
  }
  wb.recalculate();
  const err = await wb.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: "formula scan",
  });
  if (!err.ndjson.includes("0 entries")) throw Error(err.ndjson);
  await fs.mkdir(outDir, { recursive: true });
  const base = `${submitted.channelSlug}_twitchtracker_30d_${submitted.streamId}`;
  if (!quick) {
    for (const s of ["30天汇总", "提交链接"]) {
      const p = await wb.render({
        sheetName: s,
        autoCrop: "all",
        scale: 1,
        format: "png",
      });
      await fs.writeFile(
        path.join(outDir, `${base}_${s}.png`),
        new Uint8Array(await p.arrayBuffer()),
      );
    }
  }
  const x = await SpreadsheetFile.exportXlsx(wb);
  const out = path.join(outDir, `${base}.xlsx`);
  await x.save(out);
  await fs.writeFile(
    path.join(outDir, `${base}.json`),
    JSON.stringify({ submitted, records }, null, 2),
    "utf8",
  );
  return out;
}
function addFullDetail(wb, d, index) {
  const prefix = `${String(index).padStart(2, "0")}_${dateLabel(d.viewerPoints[0]?.x || Date.now()).slice(5)}_${localLabel(d.viewerPoints[0]?.x || Date.now()).replace(":", "")}`;
  const overview = wb.worksheets.add(`${prefix}_网页概览`.slice(0, 31)),
    chart = wb.worksheets.add(`${prefix}_图表数据`.slice(0, 31)),
    meta = wb.worksheets.add(`${prefix}_页面元数据`.slice(0, 31));
  for (const s of [overview, chart, meta]) {
    s.showGridLines = false;
    s.freezePanes.freezeRows(4);
  }
  const games = d.games?.length
    ? d.games
    : [
        {
          name: "未解析",
          avgViewers: d.summary.avgViewers,
          peakViewers: d.summary.peakViewers,
          duration: d.summary.duration,
          followersGained: d.summary.followersGained,
          followersPerHour: d.summary.followersPerHour,
          hoursWatched: d.summary.hoursWatched,
          url: "",
        },
      ];
  const title = (s, r, v) => {
    s.getRange(r).merge();
    s.getRange(r.split(":")[0]).values = [[v]];
    s.getRange(r).format = {
      fill: "#112B4C",
      font: { bold: true, color: "#FFFFFF", size: 16 },
      verticalAlignment: "center",
    };
  };
  const band = (s, r, v) => {
    s.getRange(r).merge();
    s.getRange(r.split(":")[0]).values = [[v]];
    s.getRange(r).format = {
      fill: "#1E3A5F",
      font: { bold: true, color: "#FFFFFF", size: 11 },
    };
  };
  title(overview, "A1:J1", `TwitchTracker · ${d.channelName} · Stream Summary`);
  overview.getRange("A2:J2").merge();
  overview.getRange("A2").values = [[d.sourceUrl]];
  overview.getRange("A2:J2").format = {
    font: { italic: true, color: "#6B7C93" },
  };
  overview.getRange("A4:H11").values = [
    ["CHANNEL", null, "RANK", null, "STREAM DATE", null, null, null],
    [
      d.channelName,
      null,
      d.summary.rank,
      null,
      d.summary.streamDate,
      null,
      null,
      null,
    ],
    ["", "", "", "", "", "", "", ""],
    [
      "STREAM DURATION",
      null,
      "AVG VIEWERS",
      null,
      "PEAK VIEWERS",
      null,
      null,
      null,
    ],
    [
      d.summary.duration,
      null,
      d.summary.avgViewers,
      null,
      d.summary.peakViewers,
      null,
      null,
      null,
    ],
    ["", "", "", "", "", "", "", ""],
    [
      "HOURS WATCHED",
      null,
      "FOLLOWERS GAINED",
      null,
      "FOLLOWERS / HOUR",
      null,
      null,
      null,
    ],
    [
      d.summary.hoursWatched,
      null,
      d.summary.followersGained,
      null,
      d.summary.followersPerHour,
      null,
      null,
      null,
    ],
  ];
  overview.getRange("A4:H4").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
  };
  overview.getRange("A7:H7").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
  };
  overview.getRange("A5:H11").format = {
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
    font: { color: "#203040" },
  };
  band(overview, "A14:J14", "STREAM TIMELINE · UTC+8");
  overview.getRange("A15:D16").values = [
    ["STARTED", d.summary.started, "ENDED", d.summary.ended],
    [
      "Duration (minutes)",
      Math.round(durationHours(d.summary.duration) * 60),
      "Timezone",
      "UTC+8",
    ],
  ];
  overview.getRange("A15:D16").format = {
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
  };
  band(overview, "A18:J18", "PLAYED GAMES");
  const gRows = [
    [
      "Game",
      "Avg viewers",
      "Peak viewers",
      "Duration",
      "Duration (h)",
      "Followers gained",
      "Followers / hour",
      "Hours watched",
      "Game URL",
    ],
    ...games.map((g) => [
      g.name,
      g.avgViewers,
      g.peakViewers,
      g.duration,
      durationHours(g.duration),
      g.followersGained,
      g.followersPerHour,
      g.hoursWatched,
      g.url,
    ]),
  ];
  overview.getRange(`A19:I${18 + gRows.length}`).values = gRows;
  overview.getRange("A19:I19").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  overview.getRange(`A20:I${18 + gRows.length}`).format = {
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
  };
  const titleRow = 21 + games.length;
  band(
    overview,
    `A${titleRow}:J${titleRow}`,
    d.titleChanges.length > 1 ? "STREAM TITLE CHANGES" : "STREAM TITLE",
  );
  overview.getRange(`A${titleRow + 1}:J${titleRow + 1}`).values = [
    ["Time (UTC+8)", "Title", null, null, null, null, null, null, null, null],
  ];
  overview.getRange(`A${titleRow + 1}:J${titleRow + 1}`).format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
  };
  const trs = d.titleChanges.length
    ? d.titleChanges
    : [
        {
          time: localLabel(d.viewerPoints[0]?.x || Date.now()),
          title: d.currentTitle,
        },
      ];
  overview.getRange(`A${titleRow + 2}:B${titleRow + 1 + trs.length}`).values =
    trs.map((x) => [x.time, x.title]);
  overview.getRange(`A${titleRow + 2}:B${titleRow + 1 + trs.length}`).format = {
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
    wrapText: true,
  };
  const clipRow = titleRow + 4 + trs.length;
  band(overview, `A${clipRow}:J${clipRow}`, "VIDEO & CLIPS");
  overview.getRange(`A${clipRow + 1}:D${clipRow + 2}`).values = [
    [
      "VOD",
      "Find VOD for this stream",
      "CLIPS",
      d.clips?.length ? `${d.clips.length} clips found` : "No clips found",
    ],
    [
      "Stream ID",
      d.streamId,
      "Channel",
      `https://twitchtracker.com/${d.channelSlug}`,
    ],
  ];
  overview.getRange(`A${clipRow + 1}:D${clipRow + 2}`).format = {
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
  };
  overview.getRange("A:J").format.columnWidth = 14;
  overview.getRange("A:A").format.columnWidth = 24;
  overview.getRange("B:B").format.columnWidth = 32;
  overview.getRange("I:I").format.columnWidth = 32;
  title(chart, "A1:T1", `Chart Data · ${d.channelName} · CCV & Followers Gain`);
  chart.getRange("A2:T2").merge();
  chart.getRange("A2").values = [[d.sourceUrl]];
  const end = 4 + d.viewerPoints.length;
  chart.getRange("A4:G4").values = [
    [
      "Local time (UTC+8)",
      "UTC time",
      "CCV count",
      "Followers Gain",
      "Content segment",
      "Minutes from start",
      "Source URL",
    ],
  ];
  chart.getRange(`A5:G${end}`).values = d.viewerPoints.map((p, i) => [
    localLabel(p.x),
    new Date(p.x),
    p.y,
    d.followerPoints[i]?.y ?? 0,
    contentAt(d.contentMarkers, p.x),
    (p.x - d.viewerPoints[0].x) / 60000,
    d.sourceUrl,
  ]);
  chart.getRange("A4:G4").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
  };
  chart.getRange(`A5:G${end}`).format = {
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
  };
  chart.getRange(`B5:B${end}`).format.numberFormat = "yyyy-mm-dd hh:mm";
  chart.getRange(`C5:D${end}`).format.numberFormat = "#,##0;[Red]-#,##0";
  chart.getRange("H4:I4").values = [["Local time (UTC+8)", "Followers Gain"]];
  chart.getRange(`H5:H${end}`).formulas = [["=A5"]];
  chart.getRange(`H5:H${end}`).fillDown();
  chart.getRange("I5").formulas = [["=D5"]];
  chart.getRange(`I5:I${end}`).fillDown();
  chart.getRange("K4:L4").values = [["Local time (UTC+8)", "CCV count"]];
  chart.getRange("K5").formulas = [["=A5"]];
  chart.getRange(`K5:K${end}`).fillDown();
  chart.getRange("L5").formulas = [["=C5"]];
  chart.getRange(`L5:L${end}`).fillDown();
  chart.getRange("H4:I4").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
  };
  chart.getRange("K4:L4").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
  };
  const vc = chart.charts.add("line", chart.getRange(`K4:L${end}`));
  vc.title = "Concurrent Viewers (CCV count)";
  vc.hasLegend = false;
  vc.setPosition("M4", "T20");
  const fc = chart.charts.add("bar", chart.getRange(`H4:I${end}`));
  fc.title = "Followers Gain (+/-)";
  fc.hasLegend = false;
  fc.setPosition("M22", "T38");
  const ccvTitle = end + 3;
  chart.getRange(`A${ccvTitle}:C${ccvTitle}`).merge();
  chart.getRange(`A${ccvTitle}`).values = [["CCV 数量表 · 随时间变化"]];
  chart.getRange(`A${ccvTitle}:C${ccvTitle}`).format = {
    fill: "#18BC9C",
    font: { bold: true, color: "#FFFFFF" },
  };
  chart.getRange(`A${ccvTitle + 1}:C${ccvTitle + 1}`).values = [
    ["时间 (UTC+8)", "CCV 数量", "直播内容"],
  ];
  chart.getRange(
    `A${ccvTitle + 2}:C${ccvTitle + 1 + d.viewerPoints.length}`,
  ).values = d.viewerPoints.map((p) => [
    localLabel(p.x),
    p.y,
    contentAt(d.contentMarkers, p.x),
  ]);
  chart.getRange(
    `A${ccvTitle + 1}:C${ccvTitle + 1 + d.viewerPoints.length}`,
  ).format = { borders: { preset: "inside", style: "thin", color: "#D7E1EA" } };
  const segTitle = ccvTitle + 4 + d.viewerPoints.length;
  chart.getRange(`A${segTitle}:G${segTitle}`).merge();
  chart.getRange(`A${segTitle}`).values = [
    ["直播内容划分 · 网页纵向标记/标题变化"],
  ];
  chart.getRange(`A${segTitle}:G${segTitle}`).format = {
    fill: "#E74C3C",
    font: { bold: true, color: "#FFFFFF" },
  };
  chart.getRange(`A${segTitle + 1}:G${segTitle + 1}`).values = [
    [
      "标记",
      "开始时间（UTC+8）",
      "结束时间（UTC+8）",
      "时长（分钟）",
      "直播内容",
      "依据",
      "说明",
    ],
  ];
  const endTime = (d.summary.ended.match(/\d{2}:\d{2}/) || [""])[0];
  chart.getRange(
    `A${segTitle + 2}:G${segTitle + 1 + d.contentMarkers.length}`,
  ).values = d.contentMarkers.map((m, i) => {
    const n = d.contentMarkers[i + 1],
      e = n ? localLabel(n.ms - 60000) : endTime;
    return [
      `内容 ${i + 1}`,
      m.time,
      e,
      null,
      m.label,
      "网页图表标记/标题变化",
      i ? "上一个标记后至下一标记" : "开播至下一标记",
    ];
  });
  chart.getRange("A:T").format.columnWidth = 14;
  chart.getRange("E:E").format.columnWidth = 30;
  chart.getRange("G:G").format.columnWidth = 42;
  title(meta, "A1:D1", "Page Metadata & Capture Notes");
  meta.getRange("A2:D2").merge();
  meta.getRange("A2").values = [[d.sourceUrl]];
  meta.getRange("A4:D4").values = [
    ["Field", "Value", "Type / note", "Source URL"],
  ];
  const mr = [
    ["Page title", d.pageTitle, "document.title", d.sourceUrl],
    ["Meta description", d.description, "meta[name=description]", d.sourceUrl],
    [
      "Channel name",
      d.channelName,
      "channel slug",
      `https://twitchtracker.com/${d.channelSlug}`,
    ],
    ["Channel ID", d.channelId, "Twitch channel id", d.sourceUrl],
    [
      "Channel created at",
      d.channelCreatedAt,
      "window.channel.created_at",
      d.sourceUrl,
    ],
    ["Stream ID", d.streamId, "URL path id", d.sourceUrl],
    ["Page timezone", "UTC+8", "visible timezone switch", d.sourceUrl],
    ["Stream date shown", d.summary.streamDate, "visible heading", d.sourceUrl],
    ["Started", d.summary.started, "visible timestamp; UTC+8", d.sourceUrl],
    ["Ended", d.summary.ended, "visible timestamp; UTC+8", d.sourceUrl],
    ...d.titleChanges.map((x, i) => [
      `Stream title change ${i + 1}`,
      `${x.time} · ${x.title}`,
      "visible page state",
      d.sourceUrl,
    ]),
    [
      "Clips",
      `${d.clips?.length || 0} clips found`,
      "visible page state",
      d.sourceUrl,
    ],
  ];
  meta.getRange(`A5:D${4 + mr.length}`).values = mr;
  meta.getRange("A4:D4").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
  };
  meta.getRange(`A5:D${4 + mr.length}`).format = {
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
    wrapText: true,
  };
  meta.getRange("A:A").format.columnWidth = 24;
  meta.getRange("B:B").format.columnWidth = 78;
  meta.getRange("C:C").format.columnWidth = 34;
  meta.getRange("D:D").format.columnWidth = 48;
  return { overview, chart, meta };
}

function addCombinedDetail(wb, d, index) {
  const base = `${String(index).padStart(2, "0")}_${dateLabel(d.viewerPoints[0]?.x || Date.now()).slice(5)}_${localLabel(d.viewerPoints[0]?.x || Date.now()).replace(":", "")}`;
  const s = wb.worksheets.add(base.slice(0, 31));
  s.showGridLines = false;
  const title = (row, end, text) => { s.getRange(`A${row}:${end}${row}`).merge(); s.getRange(`A${row}`).values = [[text]]; s.getRange(`A${row}:${end}${row}`).format = { fill: "#112B4C", font: { bold: true, color: "#FFFFFF", size: 15 } }; };
  const band = (row, end, text, color = "#1E3A5F") => { s.getRange(`A${row}:${end}${row}`).merge(); s.getRange(`A${row}`).values = [[text]]; s.getRange(`A${row}:${end}${row}`).format = { fill: color, font: { bold: true, color: "#FFFFFF" } }; };
  let r = 1;
  title(r, "J", `TwitchTracker · ${d.channelName} · Stream Summary`); r++;
  s.getRange(`A${r}:J${r}`).merge(); s.getRange(`A${r}`).values = [[d.sourceUrl]]; r += 2;
  const games = d.games?.length ? d.games : [{ name: "未解析", avgViewers: d.summary.avgViewers, peakViewers: d.summary.peakViewers, duration: d.summary.duration, followersGained: d.summary.followersGained, followersPerHour: d.summary.followersPerHour, hoursWatched: d.summary.hoursWatched, url: "" }];
  s.getRange(`A${r}:H${r + 7}`).values = [
    ["CHANNEL", null, "RANK", null, "STREAM DATE", null, null, null], [d.channelName, null, d.summary.rank, null, d.summary.streamDate, null, null, null], ["", "", "", "", "", "", "", ""],
    ["STREAM DURATION", null, "AVG VIEWERS", null, "PEAK VIEWERS", null, null, null], [d.summary.duration, null, d.summary.avgViewers, null, d.summary.peakViewers, null, null, null], ["", "", "", "", "", "", "", ""],
    ["HOURS WATCHED", null, "FOLLOWERS GAINED", null, "FOLLOWERS / HOUR", null, null, null], [d.summary.hoursWatched, null, d.summary.followersGained, null, d.summary.followersPerHour, null, null, null]
  ];
  s.getRange(`A${r}:H${r}`).format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" } }; s.getRange(`A${r + 3}:H${r + 3}`).format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" } }; s.getRange(`A${r}:H${r + 7}`).format.borders = { preset: "inside", style: "thin", color: "#D7E1EA" }; r += 9;
  band(r, "J", "STREAM TIMELINE · UTC+8"); r++;
  s.getRange(`A${r}:D${r + 1}`).values = [["STARTED", d.summary.started, "ENDED", d.summary.ended], ["Duration (minutes)", Number((durationHours(d.summary.duration) * 60).toFixed(1)), "Timezone", "UTC+8"]]; s.getRange(`B${r + 1}`).format.numberFormat = "0.0"; r += 3;
  band(r, "J", "PLAYED GAMES"); r++;
  const gr = [["Game", "Avg viewers", "Peak viewers", "Duration", "Duration (h)", "Followers gained", "Followers / hour", "Hours watched", "Game URL"], ...games.map(g => [g.name, g.avgViewers, g.peakViewers, g.duration, Number(durationHours(g.duration).toFixed(1)), g.followersGained, g.followersPerHour, g.hoursWatched, g.url])];
  s.getRange(`A${r}:I${r + gr.length - 1}`).values = gr; s.getRange(`A${r}:I${r}`).format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" } }; s.getRange(`E${r + 1}:E${r + gr.length - 1}`).format.numberFormat = "0.0"; r += gr.length + 1;
  band(r, "J", d.titleChanges.length > 1 ? "STREAM TITLE CHANGES" : "STREAM TITLE"); r++;
  const trs = d.titleChanges.length ? d.titleChanges : [{ time: localLabel(d.viewerPoints[0]?.x || Date.now()), title: d.currentTitle }]; s.getRange(`A${r}:B${r}`).values = [["Time (UTC+8)", "Title"]]; s.getRange(`A${r}:B${r}`).format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" } }; s.getRange(`A${r + 1}:B${r + trs.length}`).values = trs.map(x => [x.time, x.title]); r += trs.length + 3;
  band(r, "J", "VIDEO & CLIPS"); r++; s.getRange(`A${r}:D${r + 1}`).values = [["VOD", "Find VOD for this stream", "CLIPS", d.clips?.length ? `${d.clips.length} clips found` : "No clips found"], ["Stream ID", d.streamId, "Channel", `https://twitchtracker.com/${d.channelSlug}`]]; r += 4;
  band(r, "T", "CHART DATA · CCV & FOLLOWERS GAIN"); r += 2;
  const startChart = r; s.getRange(`A${r}:G${r}`).values = [["Local time (UTC+8)", "UTC time", "CCV count", "Followers Gain", "Content segment", "Minutes from start", "Source URL"]];
  const end = r + d.viewerPoints.length; s.getRange(`A${r + 1}:G${end}`).values = d.viewerPoints.map((p, i) => [localLabel(p.x), new Date(p.x), p.y, d.followerPoints[i]?.y ?? 0, contentAt(d.contentMarkers, p.x), Number(((p.x - d.viewerPoints[0].x) / 60000).toFixed(1)), d.sourceUrl]); s.getRange(`A${r}:G${r}`).format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" } }; s.getRange(`B${r + 1}:B${end}`).format.numberFormat = "yyyy-mm-dd hh:mm"; s.getRange(`F${r + 1}:F${end}`).format.numberFormat = "0.0";
  s.getRange(`I${r}:J${r}`).values = [["Local time (UTC+8)", "Followers Gain"]]; s.getRange(`I${r + 1}`).formulas = [[`=A${r + 1}`]]; s.getRange(`I${r + 1}:I${end}`).fillDown(); s.getRange(`J${r + 1}`).formulas = [[`=D${r + 1}`]]; s.getRange(`J${r + 1}:J${end}`).fillDown(); s.getRange(`L${r}:M${r}`).values = [["Local time (UTC+8)", "CCV count"]]; s.getRange(`L${r + 1}`).formulas = [[`=A${r + 1}`]]; s.getRange(`L${r + 1}:L${end}`).fillDown(); s.getRange(`M${r + 1}`).formulas = [[`=C${r + 1}`]]; s.getRange(`M${r + 1}:M${end}`).fillDown(); s.getRange(`I${r}:J${r}`).format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" } }; s.getRange(`L${r}:M${r}`).format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" } }; const vc = s.charts.add("line", s.getRange(`L${r}:M${end}`)); vc.title = "Concurrent Viewers (CCV count)"; vc.hasLegend = false; vc.setPosition(`O${r}`, `T${r + 16}`); const fc = s.charts.add("bar", s.getRange(`I${r}:J${end}`)); fc.title = "Followers Gain (+/-)"; fc.hasLegend = false; fc.setPosition(`O${r + 18}`, `T${r + 34}`);
  r = end + 3; band(r, "D", "CCV 数量表 · 随时间变化", "#18BC9C"); r++; s.getRange(`A${r}:D${r}`).values = [["时间 (UTC+8)", "Minutes from start", "CCV 数量", "直播内容"]]; s.getRange(`A${r + 1}:D${r + d.viewerPoints.length}`).values = d.viewerPoints.map(p => [localLabel(p.x), Number(((p.x - d.viewerPoints[0].x) / 60000).toFixed(1)), p.y, contentAt(d.contentMarkers, p.x)]); s.getRange(`B${r + 1}:B${r + d.viewerPoints.length}`).format.numberFormat = "0.0"; r += d.viewerPoints.length + 3;
  band(r, "G", "直播内容划分 · 网页纵向标记/标题变化", "#E74C3C"); r++; s.getRange(`A${r}:G${r}`).values = [["标记", "开始时间（UTC+8）", "结束时间（UTC+8）", "时长（分钟）", "直播内容", "依据", "说明"]]; const endTime = (d.summary.ended.match(/\d{2}:\d{2}/) || [""])[0]; s.getRange(`A${r + 1}:G${r + d.contentMarkers.length}`).values = d.contentMarkers.map((m, i) => { const n = d.contentMarkers[i + 1], mins = n ? (n.ms - m.ms) / 60000 : ((d.viewerPoints.at(-1).x - m.ms) / 60000); return [`内容 ${i + 1}`, m.time, n ? localLabel(n.ms) : endTime, Number(mins.toFixed(1)), m.label, "网页图表标记/标题变化", i ? "上一个标记后至下一标记" : "开播至下一标记"]; }); s.getRange(`D${r + 1}:D${r + d.contentMarkers.length}`).format.numberFormat = "0.0"; r += d.contentMarkers.length + 3;
  band(r, "D", "PAGE METADATA & CAPTURE NOTES"); r++; s.getRange(`A${r}:D${r}`).values = [["Field", "Value", "Type / note", "Source URL"]]; s.getRange(`A${r}:D${r}`).format = { fill: "#1E3A5F", font: { bold: true, color: "#FFFFFF" } }; const meta = [["Page title", d.pageTitle, "document.title", d.sourceUrl], ["Meta description", d.description, "meta[name=description]", d.sourceUrl], ["Channel name", d.channelName, "channel slug", `https://twitchtracker.com/${d.channelSlug}`], ["Channel ID", d.channelId, "Twitch channel id", d.sourceUrl], ["Channel created at", d.channelCreatedAt, "window.channel.created_at", d.sourceUrl], ["Stream ID", d.streamId, "URL path id", d.sourceUrl], ["Page timezone", "UTC+8", "visible timezone switch", d.sourceUrl], ["Stream date shown", d.summary.streamDate, "visible heading", d.sourceUrl], ["Started", d.summary.started, "visible timestamp; UTC+8", d.sourceUrl], ["Ended", d.summary.ended, "visible timestamp; UTC+8", d.sourceUrl], ...d.titleChanges.map((x, i) => [`Stream title change ${i + 1}`, `${x.time} · ${x.title}`, "visible page state", d.sourceUrl]), ["Clips", `${d.clips?.length || 0} clips found`, "visible page state", d.sourceUrl]]; s.getRange(`A${r + 1}:D${r + meta.length}`).values = meta; s.getRange(`A${r + 1}:D${r + meta.length}`).format = { borders: { preset: "inside", style: "thin", color: "#D7E1EA" }, wrapText: true };
  s.getRange("A:A").format.columnWidth = 24; s.getRange("B:B").format.columnWidth = 32; s.getRange("C:C").format.columnWidth = 34; s.getRange("D:D").format.columnWidth = 48; s.getRange("E:E").format.columnWidth = 30; s.getRange("G:G").format.columnWidth = 42; return s;
}

async function workbookFull(submitted, records, outDir, quick, windowDays) {
  const wb = Workbook.create(),
    sum = wb.worksheets.add(`${windowDays}天汇总`);
  sum.showGridLines = false;
  const headers = [
    "序号",
    "Stream start time",
    "Stream URL",
    "Stream",
    "Watch time (mins)",
    "Avg viewers",
    "Peak viewers",
    "Followers gained",
    "Games",
    "状态",
  ];
  const rows = records.map((r, i) => [
    i + 1,
    r.summary.started,
    r.sourceUrl,
    r.streamId,
    r.summary.hoursWatched == null ? null : Number((r.summary.hoursWatched * 60).toFixed(1)),
    r.summary.avgViewers,
    r.summary.peakViewers,
    r.summary.followersGained,
    (r.games || []).map((x) => x.text || x.name).join(", "),
    "completed",
  ]);
  sum.getRange(`A1:J${rows.length + 1}`).values = [headers, ...rows];
  sum.getRange("A1:J1").format = {
    fill: "#1E3A5F",
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    wrapText: true,
  };
  sum.getRange(`A2:J${rows.length + 1}`).format = {
    borders: { preset: "inside", style: "thin", color: "#D7E1EA" },
  };
  sum.getRange(`E2:E${rows.length + 1}`).format.numberFormat = "0.0";
  sum.freezePanes.freezeRows(1);
  sum.getRange("A:J").format.columnWidth = 18;
  sum.getRange("B:B").format.columnWidth = 24;
  sum.getRange("C:C").format.columnWidth = 48;
  sum.getRange("I:I").format.columnWidth = 34;
  for (let i = 0; i < records.length; i++) addCombinedDetail(wb, records[i], i + 1);
  wb.recalculate();
  const err = await wb.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: "formula scan",
  });
  if (!err.ndjson.includes("0 entries")) throw Error(err.ndjson);
  await fs.mkdir(outDir, { recursive: true });
  const base = `${submitted.channelSlug}_twitchtracker_${windowDays}d_${submitted.streamId}`;
  if (!quick) {
    for (const s of [
      `${windowDays}天汇总`,
      ...records.slice(0, 1).map((d, i) => `${String(i + 1).padStart(2, "0")}_${dateLabel(d.viewerPoints[0]?.x || Date.now()).slice(5)}_${localLabel(d.viewerPoints[0]?.x || Date.now()).replace(":", "")}`.slice(0, 31)),
    ]) {
      const p = await wb.render({
        sheetName: s,
        autoCrop: "all",
        scale: 1,
        format: "png",
      });
      await fs.writeFile(
        path.join(outDir, `${base}_${s}.png`),
        new Uint8Array(await p.arrayBuffer()),
      );
    }
  }
  const x = await SpreadsheetFile.exportXlsx(wb),
    out = path.join(outDir, `${base}.xlsx`);
  await x.save(out);
  await fs.writeFile(
    path.join(outDir, `${base}.json`),
    JSON.stringify({ submitted, records }, null, 2),
    "utf8",
  );
  return out;
}

function args(argv) {
  const o = { outDir: path.join(ROOT, "output"), headed: false, quick: false, days: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!o.url && !a.startsWith("-")) o.url = a;
    else if (a === "--out-dir") o.outDir = path.resolve(argv[++i]);
    else if (a === "--input-json") o.inputJson = path.resolve(argv[++i]);
    else if (a === "--headed") o.headed = true;
    else if (a === "--quick") o.quick = true;
    else if (a === "--days") o.days = Number(argv[++i]);
    else if (a === "--cdp-url") o.cdpUrl = argv[++i];
  }
  return o;
}
async function main() {
  const a = args(process.argv.slice(2));
  let submitted, records;
  if (a.inputJson) {
    a.days = 0;
    const raw = await readJson(a.inputJson);
    submitted = raw.viewerPoints ? raw : normalize(raw, target(raw.sourceUrl));
    records = [submitted];
  } else {
    const t = target(a.url);
    records = await captureWindow(t, a.headed, a.days, a.cdpUrl);
    submitted = records.find((x) => x.streamId === t.id) || records[0];
  }
  records = [submitted, ...records.filter((x) => x.streamId !== submitted.streamId)];
  const out = await workbookFull(submitted, records, a.outDir, a.quick, a.days);
  console.log(
    JSON.stringify(
      {
        ok: true,
        submitted: submitted.sourceUrl,
        records: records.length,
        xlsx: out,
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(`导出失败: ${e.message}`);
  process.exitCode = 1;
});
