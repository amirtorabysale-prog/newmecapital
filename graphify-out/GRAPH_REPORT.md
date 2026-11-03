# Graph Report - newcapital  (2026-11-03)

## Corpus Check
- 72 files · ~91,667 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 828 nodes · 2008 edges · 43 communities (40 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b2677825`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- panel.js
- createBot
- ref_node_fs
- fit.js
- سندِ پیشرفت — بات سیگنال NewMe Capital
- strategy.test.js
- package.json
- master-audit.js
- exchanges/index.js
- بات سیگنال — NewMe Capital
- deploy
- src/index.js
- app.js
- engine.js
- strategies.js
- render.js
- pullback.js
- rsi3-report.js
- createWebServer
- کجا هستیم
- rsi3.js
- backtest-rsi3.js
- event-study.js
- backtest-pullback.js
- trend-robust.js
- Primitive
- scan-once.js
- trend-risk.js
- server.js
- bot.js
- آزمونِ سطحِ استراتژی (روزانه)
- backtest.js
- بک‌تستِ پولبکِ اشباع در جهتِ روند
- بک‌تستِ پولبکِ اشباع در جهتِ روند — ماشه‌ی 4h
- ممیزیِ استراتژیِ فعلیِ بات — واچ‌لیست
- history.js
- مطالعه‌ی رویداد — کدام سیگنال اطلاعات دارد؟
- پایداریِ خانواده‌ی C — «بالای EMA بمان» (روزانه، فقط خرید)
- پژوهشِ استراتژی — وضعیتِ ۳ نوامبر ۲۰۲۶
- ریسک و اندازه‌ی معامله — EMA50 ِ روزانه، استاپِ فاجعه ۳ATR
- research/README.md
- بک‌تستِ اشباعِ سه‌تایم‌فریمی
- ref_node_assert

## God Nodes (most connected - your core abstractions)
1. `createBot()` - 38 edges
2. `esc()` - 29 edges
3. `price()` - 25 edges
4. `atr()` - 24 edges
5. `b()` - 24 edges
6. `utc()` - 22 edges
7. `rsi()` - 22 edges
8. `action()` - 20 edges
9. `home` - 18 edges
10. `draw()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `prep()` --calls--> `aggregate()`  [EXTRACTED]
  scripts/research/engine.js → src/strategy/rsi3.js
- `prepare()` --calls--> `aggregate()`  [EXTRACTED]
  scripts/research/event-study.js → src/strategy/rsi3.js
- `block()` --calls--> `pbStats()`  [EXTRACTED]
  scripts/research/trend-robust.js → src/strategy/pullback.js
- `run()` --calls--> `backtestPullback()`  [EXTRACTED]
  scripts/backtest-pullback.js → src/strategy/pullback.js
- `run()` --calls--> `pbStats()`  [EXTRACTED]
  scripts/backtest-pullback.js → src/strategy/pullback.js

## Import Cycles
- None detected.

## Communities (43 total, 3 thin omitted)

### Community 0 - "panel.js"
Cohesion: 0.09
Nodes (65): decimalsFor(), pct(), price(), utc(), adminAlert(), channelAnalysis(), channelSignal(), coinReport() (+57 more)

### Community 1 - "createBot"
Cohesion: 0.09
Nodes (50): applyEdits(), hasEdits(), validatePlan(), setupKey(), createBot(), action(), alertButtons(), analyzeItem() (+42 more)

### Community 2 - "ref_node_fs"
Cohesion: 0.29
Nodes (11): ref_node_fs, ref_node_path, writeJson(), load(), path(), dataDir(), load(), save() (+3 more)

### Community 3 - "fit.js"
Cohesion: 0.08
Nodes (54): prep(), context(), analyzeLong(), buildPlan(), findLtfDivergence(), mirrorCandles(), findDivergence(), rsiNear() (+46 more)

### Community 4 - "سندِ پیشرفت — بات سیگنال NewMe Capital"
Cohesion: 0.13
Nodes (15): استراتژی, این بات چه می‌کند, تصمیم‌های باز (با مالک), راه‌اندازی روی Railway — خلاصه, رفع‌شده در ۲۸ اکتبر, سندِ پیشرفت — بات سیگنال NewMe Capital, مسیرِ کار, نتیجه‌ی بک‌تست (+7 more)

### Community 5 - "strategy.test.js"
Cohesion: 0.13
Nodes (19): config_default, ref_node_os, ref_node_test, fakeApi(), lbankBody(), quiet, setup(), candlesFrom() (+11 more)

### Community 6 - "package.json"
Cohesion: 0.11
Nodes (17): dependencies, @resvg/resvg-js, description, engines, node, name, private, scripts (+9 more)

### Community 7 - "master-audit.js"
Cohesion: 0.12
Nodes (16): netR(), all, args, cfg, cost, dirs, every, groups (+8 more)

### Community 8 - "exchanges/index.js"
Cohesion: 0.18
Nodes (12): ADAPTERS, closedOnly(), fetchCandles(), fetchFrom(), TF_BITGET, TF_LBANK, TF_MEXC, TF_MS (+4 more)

### Community 9 - "بات سیگنال — NewMe Capital"
Cohesion: 0.22
Nodes (8): Railway, استراتژی, بات سیگنال — NewMe Capital, بعد از هشدار, بک‌تست — آیا استراتژی جواب می‌دهد؟, داده, راه‌اندازی, پنل

### Community 10 - "deploy"
Cohesion: 0.33
Nodes (5): deploy, restartPolicyMaxRetries, restartPolicyType, startCommand, $schema

### Community 11 - "src/index.js"
Cohesion: 0.17
Nodes (9): loadEnv(), bot, cfg, env, problems, web, createApi(), TelegramError (+1 more)

### Community 12 - "app.js"
Cohesion: 0.06
Nodes (83): api(), applyFix(), bands, buildControls(), C, candleS, cfgFrom(), changedPaths() (+75 more)

### Community 13 - "engine.js"
Cohesion: 0.17
Nodes (11): buyHold(), COST, crossRank(), FAMILIES, run(), runSymbol(), DAY, EXTRA_UNIVERSE (+3 more)

### Community 14 - "strategies.js"
Cohesion: 0.15
Nodes (18): byYear(), fmt(), pct(), PF_HEAD, pfRow(), STAT_HEAD, statRow(), bhIS (+10 more)

### Community 15 - "render.js"
Cohesion: 0.10
Nodes (49): axisTag(), buildChartSvg(), C, checkFonts(), esc(), FONT_DIR, FONT_FILES, label() (+41 more)

### Community 16 - "pullback.js"
Cohesion: 0.29
Nodes (8): isRuns, run(), backtestPullback(), plan(), pbStats(), PULLBACK_DEFAULTS, simulatePullback(), H4

### Community 17 - "rsi3-report.js"
Cohesion: 0.44
Nodes (8): buildHtml(), equitySvg(), esc(), fmtR(), iso(), px(), tradeSvg(), stats()

### Community 18 - "createWebServer"
Cohesion: 0.53
Nodes (6): createWebServer(), candles(), handle(), init(), readBody(), verifyInitData()

### Community 19 - "کجا هستیم"
Cohesion: 0.67
Nodes (3): رسمِ آزاد و ❌ ِ قابلِ فهم — ۲۹ اکتبر, چرا استاد چارت‌های بات را قبول نمی‌کرد (اسکنِ ۲۸ اکتبر، ۸ ارز), کجا هستیم

### Community 22 - "rsi3.js"
Cohesion: 0.31
Nodes (11): aggregate(), backtestRsi3(), bucketsBefore(), buildZones(), countFunnel(), H1, liveRsi(), M5 (+3 more)

### Community 23 - "backtest-rsi3.js"
Cohesion: 0.11
Nodes (17): all, args, cacheDir, cfg, days, fetch5m(), fmt(), getJson() (+9 more)

### Community 24 - "event-study.js"
Cohesion: 0.09
Nodes (19): cfg, dEX, dIS, dOOS, DOW, f2(), hEX, hIS (+11 more)

### Community 25 - "backtest-pullback.js"
Cohesion: 0.08
Nodes (24): args, byYear, cfg, chosen, csv, data, eligible, firstT (+16 more)

### Community 27 - "trend-robust.js"
Cohesion: 0.08
Nodes (24): portfolio(), ALL, allBase, block(), btc, btcUp, cfg, cut (+16 more)

### Community 28 - "Primitive"
Cohesion: 0.12
Nodes (5): FIB_COLORS, FIB_LEVELS, Overlay, Primitive, RsiBands

### Community 35 - "scan-once.js"
Cohesion: 0.40
Nodes (4): args, cfg, charts, names

### Community 37 - "trend-risk.js"
Cohesion: 0.15
Nodes (15): ALL, bootstrap(), cfg, curveStats(), ddStats(), md, P, pStreak() (+7 more)

### Community 43 - "server.js"
Cohesion: 0.13
Nodes (14): ref_node_crypto, cfg, check, params, secret, user, web, drawings (+6 more)

### Community 45 - "bot.js"
Cohesion: 0.15
Nodes (24): checkChannel(), normalizeChannel(), DEFAULTS_PATH, loadConfig(), MUTABLE_KEYS, parseSymbol(), readJson(), resetParams() (+16 more)

### Community 47 - "آزمونِ سطحِ استراتژی (روزانه)"
Cohesion: 0.17
Nodes (11): A. شکستِ دانچیان + استاپِ متحرکِ ATR, B. برگشت به میانگینِ روزانه, C. رژیم: بالای EMA بمان, D. مومنتومِ مقطعی (هفتگی), آزمونِ سطحِ استراتژی (روزانه), جمع‌بندی, شبکه — داخل, شبکه — داخل (+3 more)

### Community 49 - "backtest.js"
Cohesion: 0.18
Nodes (7): all, args, cfg, charts, maxBars, names, threshold

### Community 58 - "بک‌تستِ پولبکِ اشباع در جهتِ روند"
Cohesion: 0.25
Nodes (7): بک‌تستِ پولبکِ اشباع در جهتِ روند, هر نماد — خارجِ نمونه, ۱. شبکه‌ی پارامتر — فقط داخلِ نمونه, ۲. ترکیبِ انتخاب‌شده: داخل و خارجِ نمونه, ۳. سال‌به‌سال (کلِ دوره), ۴. آزمونِ فشار (کلِ دوره، ترکیبِ انتخاب‌شده), ۵. قیفِ ستاپ‌ها (کلِ دوره)

### Community 59 - "بک‌تستِ پولبکِ اشباع در جهتِ روند — ماشه‌ی 4h"
Cohesion: 0.25
Nodes (7): بک‌تستِ پولبکِ اشباع در جهتِ روند — ماشه‌ی 4h, هر نماد — خارجِ نمونه, ۱. شبکه‌ی پارامتر — فقط داخلِ نمونه, ۲. ترکیبِ انتخاب‌شده: داخل و خارجِ نمونه, ۳. سال‌به‌سال (کلِ دوره), ۴. آزمونِ فشار (کلِ دوره، ترکیبِ انتخاب‌شده), ۵. قیفِ ستاپ‌ها (کلِ دوره)

### Community 60 - "ممیزیِ استراتژیِ فعلیِ بات — واچ‌لیست"
Cohesion: 0.25
Nodes (7): خلاصه, سال‌به‌سال (همه), سبد (ریسکِ ۱٪ در هر معامله), ممیزیِ استراتژیِ فعلیِ بات — واچ‌لیست, نتیجه‌ها, هر شرط: وقتی برقرار بود در برابرِ وقتی نبود, هر نماد

### Community 68 - "history.js"
Cohesion: 0.38
Nodes (6): fetchRange(), getJson(), loadHistory(), SOURCES, TF_MS, loadUniverse()

### Community 69 - "مطالعه‌ی رویداد — کدام سیگنال اطلاعات دارد؟"
Cohesion: 0.33
Nodes (5): روزِ هفته (روزانه، مازاد٪، واچ‌لیست), ساعتِ روز (UTC، کندلِ ۱س، مازاد٪), قبول‌شده‌ها, مطالعه‌ی رویداد — کدام سیگنال اطلاعات دارد؟, همه‌ی آزمون‌ها

### Community 70 - "پایداریِ خانواده‌ی C — «بالای EMA بمان» (روزانه، فقط خرید)"
Cohesion: 0.33
Nodes (5): walk-forward (آموزش ۲ سال روی واچ‌لیست، آزمون ۶ ماهِ بعد), اکسپوژرِ سرمایه (پایه، واچ‌لیست، ریسکِ ۱٪ در هر معامله), سال‌به‌سال (پایه، همه‌ی ۲۸ نماد), هر نماد (پایه، کلِ دوره), پایداریِ خانواده‌ی C — «بالای EMA بمان» (روزانه، فقط خرید)

### Community 71 - "پژوهشِ استراتژی — وضعیتِ ۳ نوامبر ۲۰۲۶"
Cohesion: 0.33
Nodes (6): اجرای دوباره, استراتژیِ کاندید: «روند‌گیریِ روزانه با EMA50», خلاصه در پنج خط, روی بات (شاخه‌ی همین پژوهش، هنوز دیپلوی نشده), پژوهشِ استراتژی — وضعیتِ ۳ نوامبر ۲۰۲۶, گام‌های بعدی

### Community 74 - "ریسک و اندازه‌ی معامله — EMA50 ِ روزانه، استاپِ فاجعه ۳ATR"
Cohesion: 0.40
Nodes (5): ریسک و اندازه‌ی معامله — EMA50 ِ روزانه، استاپِ فاجعه ۳ATR, ۱. سبد با مرکب‌سازی, ۲. بوت‌استرپ (۲۰۰۰ مسیرِ ۵ ساله از بلوک‌های ۳۰ روزه), ۳. رشته‌ی ضرر, ۴. جا انداختنِ سیگنال (واچ‌لیست، ریسکِ ۱٪)

## Knowledge Gaps
- **259 isolated node(s):** `name`, `version`, `private`, `type`, `description` (+254 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `api()` connect `app.js` to `createBot`, `bot.js`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Why does `onInput()` connect `bot.js` to `panel.js`, `createBot`, `app.js`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `parseSymbol()` connect `bot.js` to `createBot`, `scan-once.js`, `strategy.test.js`, `backtest.js`, `backtest-rsi3.js`, `backtest-pullback.js`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `createBot()` (e.g. with `decide()` and `onCallback()`) actually correct?**
  _`createBot()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _259 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `panel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08985507246376812 - nodes in this community are weakly interconnected._
- **Should `createBot` be split into smaller, more focused modules?**
  _Cohesion score 0.09071117561683599 - nodes in this community are weakly interconnected._