# 🏀 Arcade Shot Machine：NBA 投篮热区时光机

一个街机风格、可交互的 NBA 半场投篮图：

- **热区 HEAT**：按六边形分箱显示某球员一整个赛季的投篮分布。颜色表示每次出手得分（PPS），大小表示出手次数。也可以切换成「落点」视图，逐个显示命中/未中。按 ▶ 会把整季热区按比赛一场场“长”出来；在时间轴上双击某场的柱子，直接进入那场比赛的时光机回放。
- **时光机 REPLAY**：按比赛时间逐帧回放一场比赛。篮球从出手位置飞向篮筐，记分牌、连击数和热度条随之更新。时间轴上画了累计得分曲线、每次出手的刻度，以及得分爆发区间（橙色带）。可以拖动或点击跳转，空格键播放/暂停，←/→ 逐次出手，「🔥 下一段爆发」直接跳到下一个高潮。
- **街机特效**：
  - 连中 2 球 → `HEATING UP!`
  - **连中 3 记三分（中间没有打铁）→ 全屏火焰边框 `ON FIRE!!`**，同时有震屏和慢动作；着火期间每个进球都会让火继续烧，一次打铁就 `COOLED OFF`
  - 3 分钟内得到 ≥10 分 → `BURST!`，时间轴上标为橙色带
  - WebAudio 合成的 8-bit 音效（右下角 🔊 可以关掉）、CRT 扫描线、像素字体

## 有没有免费的 API？

| 来源 | 价格 / 鉴权 | 投篮坐标 | 说明 |
|---|---|---|---|
| **[nba_api](https://github.com/swar/nba_api)** → stats.nba.com | 免费，无需 key | ✅ `shotchartdetail` 的 `LOC_X/LOC_Y`（1996-97 赛季起） | 本项目使用的就是它。属于非官方接口：有限流，需要浏览器风格的请求头（nba_api 已经帮你处理），**很多云服务器 / CI 的 IP 会被屏蔽或请求超时**，建议在自己电脑上跑，或者先缓存下来。 |
| nba_api `live` 模块 → cdn.nba.com | 免费，无需 key | 比赛中的 play-by-play 带坐标 | 适合做直播，但历史数据只覆盖近几个赛季。 |
| `playbyplayv3`（同样经 nba_api） | 免费 | 有 `xLegacy/yLegacy` | 本项目用它补上**罚球**（shot chart 里没有罚球），让回放里的得分完整。 |
| balldontlie 等第三方 API | 有免费档，需要注册 key | 据我所知免费档没有投篮坐标 | 只做比分或基础数据的话够用。 |
| Kaggle / GitHub 上的历年投篮数据集 | 免费下载 | ✅（基本都是 shotchartdetail 导出的） | 不怕被屏蔽，适合离线分析或批量出图。 |

结论：**nba_api 足够把这个项目做完**，而且完全免费。唯一的麻烦是 stats.nba.com 会屏蔽某些网络，所以后端把每次请求都缓存到了 `data/cache/`。

## 运行

```bash
pip install -r requirements.txt
uvicorn backend.server:app --reload
# 打开 http://localhost:8000
```

默认加载 **Stephen Curry 2015-16 常规赛**，并自动选中他这个赛季得分最高的一场进入回放。左上角可以搜索任何球员（球员名单是 nba_api 内置的离线数据），也可以切换赛季和常规赛/季后赛。

预先下载数据（可选，之后完全离线可用）：

```bash
python -m scripts.fetch_data "Stephen Curry" 2015-16 --free-throws
```

### 离线演示模式

如果连不上 stats.nba.com（或者直接用 `file://` 打开页面），前端会自动切到 **DEMO** 模式。DEMO 模式用的是程序生成的**合成数据**，挂在虚构球员「Splash Bot」名下。页面右上角会一直显示 `DEMO · 合成数据`，不会把这些数据当成真实比赛。点击 DEMO 按钮可以切换回真实数据。也可以用 `?demo=1` 强制进入演示模式。

URL 会同步当前状态（`?player=201939&season=2015-16&game=...&mode=replay`），复制链接就能分享某一场回放。

## 结构

```
backend/nba_data.py   nba_api 封装：shotchartdetail / playergamelog / playbyplayv3，归一化 + 磁盘缓存
backend/server.py     FastAPI：/api/players /api/shots /api/games /api/freethrows /api/game + 静态文件
static/court.js       半场几何（NBA shot chart 坐标：0.1 英尺，篮筐在原点）与 Canvas 绘制
static/app.js         状态、回放引擎（预计算每个事件后的比分/连击状态，拖动即查表）、热区分箱、时间轴
static/effects.js     ON FIRE 火焰粒子边框、进球粒子、横幅、震屏、8-bit 音效
static/demo.js        离线合成数据生成器（带固定随机种子）
scripts/fetch_data.py 预下载并缓存数据
tests/                后端归一化逻辑的离线测试（pytest）
```

坐标约定：`LOC_X ∈ [-250, 250]`，`LOC_Y` 从底线 `-47.5` 到中线 `422.5`。三分线由底角 22 英尺和弧顶 23.75 英尺组成。

## 测试

```bash
python -m pytest -q
```
