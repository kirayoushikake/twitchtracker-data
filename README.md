# TwitchTracker Data

输入一个 TwitchTracker 单场直播 URL，采集该场详情和主播指定时间窗口内的单场记录，生成一个 Excel 工作簿。默认窗口为 30 天，也支持 0、90、180 天。

## 输出结构

1. `30天汇总`：按直播开始时间倒序排列，序号与详情 sheet 对齐。
2. `场次NN_MM-DD_HHmm`：每场详情一个 sheet，内部依次纵向包含网页概览、图表数据、页面元数据；不冻结网格。

详情 sheet 保留页面摘要、CCV/Followers Gain 原始点、标题变化、Played Games、内容分段和来源 URL。采集失败的场次不会伪造数据，会在汇总表标记状态及错误原因。

## 使用

```powershell
Set-Location 'E:\a办公\2026.9.21直播分析工作流重建\twitchtracker-data'
.\run.ps1 'https://twitchtracker.com/dinah/streams/316084001897'
.\run.ps1 'https://twitchtracker.com/dinah/streams/316084001897' -Days 0
.\run.ps1 'https://twitchtracker.com/dinah/streams/316084001897' -Days 90
.\run.ps1 'https://twitchtracker.com/dinah/streams/316084001897' -Days 180

如果 Edge 已登录 TwitchTracker，可先完全退出 Edge，再用远程调试端口启动（登录资料仍保存在原用户目录）：

```powershell
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Microsoft\Edge\User Data" --profile-directory=Default
.\run.ps1 'https://twitchtracker.com/dinah/streams/316084001897' -Days 30 -CdpUrl 'http://127.0.0.1:9222'
```
```

如果 Cloudflare 阻止自动化，可在普通 Edge 单场页面 Console 执行旧项目的 `twitchtracker-page-capture.js`，再使用：

```powershell
.\run.ps1 -InputJson 'C:\Users\<用户>\Downloads\dinah_twitchtracker_stream_316084001897_capture.json'
```

`-Days 0` 只采集提交链接；其它窗口会尝试打开主播历史列表并按开播时间筛选。输入 JSON 只代表一个场次，因此自动按 0 天输出。工作簿中的 CCV 数值、Minutes from start、内容分段时长均保留真实值并按一位小数显示。
