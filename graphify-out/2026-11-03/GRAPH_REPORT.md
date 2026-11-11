# Graph Report - newcapital  (2026-11-03)

## Corpus Check
- 127 files · ~171,371 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1564 nodes · 3217 edges · 78 communities (73 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b2677825`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- panel.js
- createBot
- drawings.js
- fit.js
- سندِ پیشرفت — بات سیگنال NewMe Capital
- strategy.test.js
- package.json
- Find Skills
- server.js
- بات سیگنال — NewMe Capital
- deploy
- src/index.js
- app.js
- App.tsx
- master-audit.js
- render.js
- goldHistory.js
- server/index.js
- evaluate_backtest.py
- 4. Red Flags Checklist
- ArenaChart.tsx
- Backtesting Methodology Reference
- rsi3.js
- backtest-rsi3.js
- event-study.js
- backtest-pullback.js
- drawings.ts
- trend-robust.js
- Primitive
- TestDecisionGates
- Backtest Expert
- MazneChart.tsx
- bot.js
- format.ts
- TestInputValidation
- config.js
- portfolio.js
- trend-risk.js
- TestRedFlagsDetection
- user.js
- candleStore.js
- PnlChart.tsx
- PriceService
- webapp-dev.js
- upstreamPrices.js
- action
- test_evaluate_backtest.py
- آزمونِ سطحِ استراتژی (روزانه)
- Backtesting Frameworks
- backtest.js
- Risk Metrics Calculation
- MarketEngine
- persistence.ts
- TestSampleSizeScoring
- TestExpectancyCalculation
- TestProfitFactor
- Implementation Patterns
- Implementation
- بک‌تستِ پولبکِ اشباع در جهتِ روند
- بک‌تستِ پولبکِ اشباع در جهتِ روند — ماشه‌ی 4h
- ممیزیِ استراتژیِ فعلیِ بات — واچ‌لیست
- مسیرِ یک کندل، از قیمت تا صفحه
- marketSchedule.js
- TestRiskManagementScoring
- TestRobustnessYears
- TestRobustnessParameters
- TestOverallVerdict
- TestOutputJsonStructure
- history.js
- مطالعه‌ی رویداد — کدام سیگنال اطلاعات دارد؟
- پایداریِ خانواده‌ی C — «بالای EMA بمان» (روزانه، فقط خرید)
- پژوهشِ استراتژی — وضعیتِ ۳ نوامبر ۲۰۲۶
- evaluator_module
- Path
- ریسک و اندازه‌ی معامله — EMA50 ِ روزانه، استاپِ فاجعه ۳ATR
- research/README.md
- بک‌تستِ اشباعِ سه‌تایم‌فریمی
- ref_node_assert

## God Nodes (most connected - your core abstractions)
1. `createBot()` - 38 edges
2. `esc()` - 29 edges
3. `price()` - 25 edges
4. `TestDecisionGates` - 24 edges
5. `atr()` - 24 edges
6. `b()` - 24 edges
7. `utc()` - 22 edges
8. `rsi()` - 22 edges
9. `action()` - 20 edges
10. `home` - 18 edges

## Surprising Connections (you probably didn't know these)
- `handle()` --indirect_call--> `token()`  [INFERRED]
  src/web/server.js → چارت گلدمی/tests/chartTokens.test.js
- `prep()` --calls--> `atr()`  [EXTRACTED]
  scripts/research/engine.js → src/strategy/indicators.js
- `context()` --calls--> `atr()`  [EXTRACTED]
  scripts/research/event-study.js → src/strategy/indicators.js
- `context()` --calls--> `ema()`  [EXTRACTED]
  scripts/research/event-study.js → src/strategy/indicators.js
- `context()` --calls--> `rsi()`  [EXTRACTED]
  scripts/research/event-study.js → src/strategy/indicators.js

## Import Cycles
- None detected.

## Communities (78 total, 5 thin omitted)

### Community 0 - "panel.js"
Cohesion: 0.09
Nodes (68): decimalsFor(), pct(), price(), utc(), adminAlert(), channelAnalysis(), channelSignal(), coinReport() (+60 more)

### Community 1 - "createBot"
Cohesion: 0.15
Nodes (32): applyEdits(), setupKey(), createBot(), alertButtons(), chartFor(), closeAlert(), decide(), editorView() (+24 more)

### Community 2 - "drawings.js"
Cohesion: 0.30
Nodes (10): writeJson(), load(), path(), dataDir(), load(), save(), snapshotPath(), statePath() (+2 more)

### Community 3 - "fit.js"
Cohesion: 0.08
Nodes (51): analyze(), analyzeLong(), buildPlan(), findLtfDivergence(), mirrorCandles(), unmirror(), findDivergence(), rsiNear() (+43 more)

### Community 4 - "سندِ پیشرفت — بات سیگنال NewMe Capital"
Cohesion: 0.11
Nodes (18): استراتژی, این بات چه می‌کند, تصمیم‌های باز (با مالک), راه‌اندازی روی Railway — خلاصه, رسمِ آزاد و ❌ ِ قابلِ فهم — ۲۹ اکتبر, رفع‌شده در ۲۸ اکتبر, سندِ پیشرفت — بات سیگنال NewMe Capital, مسیرِ کار (+10 more)

### Community 5 - "strategy.test.js"
Cohesion: 0.08
Nodes (27): config_default, ref_node_os, ref_node_test, fakeApi(), lbankBody(), quiet, setup(), candlesFrom() (+19 more)

### Community 6 - "package.json"
Cohesion: 0.11
Nodes (17): dependencies, @resvg/resvg-js, description, engines, node, name, private, scripts (+9 more)

### Community 7 - "Find Skills"
Cohesion: 0.14
Nodes (13): Common Skill Categories, Find Skills, How to Help Users Find Skills, Step 1: Understand What They Need, Step 2: Check the Leaderboard First, Step 3: Search for Skills, Step 4: Verify Quality Before Recommending, Step 5: Present Options to the User (+5 more)

### Community 8 - "server.js"
Cohesion: 0.13
Nodes (17): drawings, ADAPTERS, closedOnly(), fetchCandles(), fetchFrom(), TF_BITGET, TF_LBANK, TF_MEXC (+9 more)

### Community 9 - "بات سیگنال — NewMe Capital"
Cohesion: 0.22
Nodes (8): Railway, استراتژی, بات سیگنال — NewMe Capital, بعد از هشدار, بک‌تست — آیا استراتژی جواب می‌دهد؟, داده, راه‌اندازی, پنل

### Community 10 - "deploy"
Cohesion: 0.33
Nodes (5): deploy, restartPolicyMaxRetries, restartPolicyType, startCommand, $schema

### Community 11 - "src/index.js"
Cohesion: 0.15
Nodes (10): loadEnv(), bot, cfg, env, problems, web, createApi(), TelegramError (+2 more)

### Community 12 - "app.js"
Cohesion: 0.06
Nodes (83): api(), applyFix(), bands, buildControls(), C, candleS, cfgFrom(), changedPaths() (+75 more)

### Community 13 - "App.tsx"
Cohesion: 0.04
Nodes (60): AccountPage, AdminPanel, Arena, DecisionArenaLanding, isDesktop(), MainApp(), Pricing, SkillPath (+52 more)

### Community 14 - "master-audit.js"
Cohesion: 0.06
Nodes (47): buyHold(), COST, crossRank(), FAMILIES, run(), runSymbol(), byYear(), DAY (+39 more)

### Community 15 - "render.js"
Cohesion: 0.11
Nodes (48): axisTag(), buildChartSvg(), C, checkFonts(), esc(), FONT_DIR, FONT_FILES, label() (+40 more)

### Community 16 - "goldHistory.js"
Cohesion: 0.07
Nodes (35): createMarketRoutes(), assessCandleQuality(), binance, cleanCandles(), coinbase, DATASET_QUALITY_LIMITS, describeFailure(), gateio (+27 more)

### Community 17 - "server/index.js"
Cohesion: 0.08
Nodes (37): accuracyCache, app, applyOraclePrices(), buildUserState(), cachedAccuracy(), checkLiquidations(), checkTakeProfitStopLoss(), distPath (+29 more)

### Community 18 - "evaluate_backtest.py"
Cohesion: 0.10
Nodes (36): calc_expectancy(), calc_profit_factor(), detect_red_flags(), evaluate(), _exact(), _exact_components(), expectancy_sign(), get_verdict() (+28 more)

### Community 19 - "4. Red Flags Checklist"
Cohesion: 0.06
Nodes (33): 1. Initial Hypothesis, 1. Initial Hypothesis, 1. Why Failed Ideas Are Valuable, 2. Common Failure Patterns, 2. Implementation, 2. Implementation Details, 3. Case Study Framework, 3. Test Results (+25 more)

### Community 20 - "ArenaChart.tsx"
Cohesion: 0.12
Nodes (16): ArenaCandle, ArenaChart(), EventMark, PriceMarks, Props, restoreDrawings(), storageKey(), TradeMark (+8 more)

### Community 21 - "Backtesting Methodology Reference"
Cohesion: 0.07
Nodes (29): 1. Core Testing Techniques, 2. Stress Testing Methods, 3. Parameter Sensitivity Analysis, 4. Slippage and Friction Modeling, 5. Sample Size Guidelines, 6. Market Regime Analysis, 7. Common Pitfalls and Biases, Backtesting Methodology Reference (+21 more)

### Community 22 - "rsi3.js"
Cohesion: 0.16
Nodes (22): isRuns, run(), prep(), ema(), rsi(), backtestPullback(), plan(), pbStats() (+14 more)

### Community 23 - "backtest-rsi3.js"
Cohesion: 0.10
Nodes (25): all, args, cacheDir, cfg, days, fetch5m(), fmt(), getJson() (+17 more)

### Community 24 - "event-study.js"
Cohesion: 0.09
Nodes (21): ref_node_path, cfg, context(), dEX, dIS, dOOS, DOW, f2() (+13 more)

### Community 25 - "backtest-pullback.js"
Cohesion: 0.08
Nodes (24): args, byYear, cfg, chosen, csv, data, eligible, firstT (+16 more)

### Community 26 - "drawings.ts"
Cohesion: 0.15
Nodes (18): DrawingsPaneView, Shape, channelOffset(), ChartPoint, distanceToRectEdges(), distanceToSegment(), distanceToShape(), DrawingKind (+10 more)

### Community 27 - "trend-robust.js"
Cohesion: 0.08
Nodes (22): ALL, allBase, btc, btcUp, cfg, cut, ev, md (+14 more)

### Community 28 - "Primitive"
Cohesion: 0.12
Nodes (5): FIB_COLORS, FIB_LEVELS, Overlay, Primitive, RsiBands

### Community 30 - "Backtest Expert"
Cohesion: 0.08
Nodes (23): 1. State the Hypothesis, 2. Codify Rules with Zero Discretion, 3. Run Initial Backtest, 4. Stress Test the Strategy, 5. Out-of-Sample Validation, 6. Evaluate Results, Backtest Expert, Common Failure Patterns (+15 more)

### Community 31 - "MazneChart.tsx"
Cohesion: 0.15
Nodes (17): Terminal, Timeframe, TIMEFRAMES, ChartPosition, ChartPreview, GhostTrade, CHART_TOOLS, ChartTool (+9 more)

### Community 32 - "bot.js"
Cohesion: 0.19
Nodes (17): checkLivePrice(), hasEdits(), validatePlan(), runTracker(), STATUS_FA, catchUp(), close(), MAX_5M (+9 more)

### Community 33 - "format.ts"
Cohesion: 0.14
Nodes (14): DrawingsRenderer, fmtPrice(), label(), withAlpha(), fmtPercent(), Geo, PositionZoneMark, PositionZoneOverlay() (+6 more)

### Community 34 - "TestInputValidation"
Cohesion: 0.10
Nodes (11): Negative years_tested raises ValueError., Negative num_parameters raises ValueError., win_rate=0 is valid (all losses)., win_rate=100 is valid (all wins)., win_rate > 100 raises ValueError., win_rate < 0 raises ValueError., Negative avg_win_pct raises ValueError., Negative avg_loss_pct raises ValueError. (+3 more)

### Community 35 - "config.js"
Cohesion: 0.12
Nodes (16): ref_node_fs, args, cfg, charts, names, DEFAULTS_PATH, loadConfig(), MUTABLE_KEYS (+8 more)

### Community 36 - "portfolio.js"
Cohesion: 0.15
Nodes (19): balancesFrom(), checkAffordability(), checkPriceLimit(), computePortfolio(), GRAMS_PER_MESGHAL, LEVERAGE_OPTIONS, liquidationPrice(), MAINTENANCE_RATIO (+11 more)

### Community 37 - "trend-risk.js"
Cohesion: 0.15
Nodes (15): ALL, bootstrap(), cfg, curveStats(), ddStats(), md, P, pStreak() (+7 more)

### Community 38 - "TestRedFlagsDetection"
Cohesion: 0.12
Nodes (9): <30 trades triggers red flag., Slippage not tested triggers red flag., >50% drawdown triggers red flag., 8 parameters triggers red flag., 7 parameters also triggers red flag (already penalized in scoring)., 6 parameters does NOT trigger over_optimized flag., <5 years triggers red flag., Well-constructed backtest has no red flags. (+1 more)

### Community 39 - "user.js"
Cohesion: 0.20
Nodes (10): router, isFiniteNumber(), MAX_PER_USER, POINTS_NEEDED, toClient(), validateBatch(), validateDrawing(), INITIAL_RIAL_BALANCE (+2 more)

### Community 40 - "candleStore.js"
Cohesion: 0.18
Nodes (12): dropOutOfScaleCandles(), loadRecentCandles(), pruneCandles(), saveCandle(), CANDLE_INTERVAL_MS, CANDLE_RETENTION_DAYS, INITIAL_GRAM_PRICE, MAX_CANDLES (+4 more)

### Community 41 - "PnlChart.tsx"
Cohesion: 0.15
Nodes (15): PAD, PnlChart(), Point, RangeId, RANGES, dateTime(), formatChange(), CHART_LABEL (+7 more)

### Community 42 - "PriceService"
Cohesion: 0.20
Nodes (7): refreshGoldPrice(), BOUNDS, clamp(), isInBounds(), median(), PriceService, reconcileStep()

### Community 43 - "webapp-dev.js"
Cohesion: 0.17
Nodes (14): ref_node_crypto, cfg, check, params, secret, user, web, createWebServer() (+6 more)

### Community 44 - "upstreamPrices.js"
Cohesion: 0.24
Nodes (13): healthSnapshot(), refreshUsdPrice(), scheduleUsdBootstrapRetry(), usdIsSeed(), fetchGoldSpot(), fetchJson(), fetchUsdFromNavasan(), fetchUsdFromNobitex() (+5 more)

### Community 45 - "action"
Cohesion: 0.24
Nodes (13): checkChannel(), normalizeChannel(), parseSymbol(), resetParams(), saveSettings(), setParam(), coerce(), setPath() (+5 more)

### Community 46 - "test_evaluate_backtest.py"
Cohesion: 0.17
Nodes (7): Tests for evaluate_backtest.py — backtest quality evaluation tool., Slippage tested -> full 20 points., Slippage not tested -> 0 points., PF score should not jump more than 2 points at PF=2.0 boundary., Higher PF should give equal or higher risk management score., TestProfitFactorScoreSmoothness, TestSlippageFlag

### Community 47 - "آزمونِ سطحِ استراتژی (روزانه)"
Cohesion: 0.17
Nodes (11): A. شکستِ دانچیان + استاپِ متحرکِ ATR, B. برگشت به میانگینِ روزانه, C. رژیم: بالای EMA بمان, D. مومنتومِ مقطعی (هفتگی), آزمونِ سطحِ استراتژی (روزانه), جمع‌بندی, شبکه — داخل, شبکه — داخل (+3 more)

### Community 48 - "Backtesting Frameworks"
Cohesion: 0.18
Nodes (10): 1. Backtesting Biases, 2. Proper Backtest Structure, 3. Walk-Forward Analysis, Backtesting Frameworks, Best Practices, Core Concepts, Detailed worked examples and patterns, Do's (+2 more)

### Community 49 - "backtest.js"
Cohesion: 0.18
Nodes (7): all, args, cfg, charts, maxBars, names, threshold

### Community 50 - "Risk Metrics Calculation"
Cohesion: 0.20
Nodes (9): 1. Risk Metric Categories, 2. Time Horizons, Best Practices, Core Concepts, Detailed patterns and worked examples, Do's, Don'ts, Risk Metrics Calculation (+1 more)

### Community 52 - "persistence.ts"
Cohesion: 0.47
Nodes (8): cacheDrawings(), clearCachedDrawings(), fetchDrawings(), isValid(), KINDS, loadCachedDrawings(), pushDrawings(), useDrawings()

### Community 53 - "TestSampleSizeScoring"
Cohesion: 0.22
Nodes (5): <30 trades -> 0 points., 30 trades -> partial credit., 100 trades -> 15 points., 200+ trades -> full 20 points., TestSampleSizeScoring

### Community 54 - "TestExpectancyCalculation"
Cohesion: 0.22
Nodes (5): Positive expectancy -> positive score., Negative expectancy -> 0 points., Break-even -> 0 points., Very high expectancy still capped at 20., TestExpectancyCalculation

### Community 55 - "TestProfitFactor"
Cohesion: 0.25
Nodes (4): win_rate=60, avg_win=2, avg_loss=1 -> PF = 3.0., win_rate=50, avg_win=1, avg_loss=1 -> PF = 1.0., 100% win rate -> PF = inf (capped)., TestProfitFactor

### Community 56 - "Implementation Patterns"
Cohesion: 0.25
Nodes (7): backtesting-frameworks — detailed worked examples, Implementation Patterns, Pattern 1: Event-Driven Backtester, Pattern 2: Vectorized Backtester (Fast), Pattern 3: Walk-Forward Optimization, Pattern 4: Monte Carlo Analysis, Performance Metrics

### Community 57 - "Implementation"
Cohesion: 0.25
Nodes (7): Implementation, Pattern 1: Core Risk Metrics, Pattern 2: Portfolio Risk, Pattern 3: Rolling Risk Metrics, Pattern 4: Stress Testing, Quick Reference, risk-metrics-calculation — detailed patterns and worked examples

### Community 58 - "بک‌تستِ پولبکِ اشباع در جهتِ روند"
Cohesion: 0.25
Nodes (7): بک‌تستِ پولبکِ اشباع در جهتِ روند, هر نماد — خارجِ نمونه, ۱. شبکه‌ی پارامتر — فقط داخلِ نمونه, ۲. ترکیبِ انتخاب‌شده: داخل و خارجِ نمونه, ۳. سال‌به‌سال (کلِ دوره), ۴. آزمونِ فشار (کلِ دوره، ترکیبِ انتخاب‌شده), ۵. قیفِ ستاپ‌ها (کلِ دوره)

### Community 59 - "بک‌تستِ پولبکِ اشباع در جهتِ روند — ماشه‌ی 4h"
Cohesion: 0.25
Nodes (7): بک‌تستِ پولبکِ اشباع در جهتِ روند — ماشه‌ی 4h, هر نماد — خارجِ نمونه, ۱. شبکه‌ی پارامتر — فقط داخلِ نمونه, ۲. ترکیبِ انتخاب‌شده: داخل و خارجِ نمونه, ۳. سال‌به‌سال (کلِ دوره), ۴. آزمونِ فشار (کلِ دوره، ترکیبِ انتخاب‌شده), ۵. قیفِ ستاپ‌ها (کلِ دوره)

### Community 60 - "ممیزیِ استراتژیِ فعلیِ بات — واچ‌لیست"
Cohesion: 0.25
Nodes (7): خلاصه, سال‌به‌سال (همه), سبد (ریسکِ ۱٪ در هر معامله), ممیزیِ استراتژیِ فعلیِ بات — واچ‌لیست, نتیجه‌ها, هر شرط: وقتی برقرار بود در برابرِ وقتی نبود, هر نماد

### Community 61 - "مسیرِ یک کندل، از قیمت تا صفحه"
Cohesion: 0.25
Nodes (7): تست‌ها, دام‌هایی که در گلدمی یک‌بار گرفتار شدیم, سرور, مسیرِ یک کندل، از قیمت تا صفحه, وابستگی‌ها, چارت گلدمی — کپیِ مستقل, کلاینت

### Community 62 - "marketSchedule.js"
Cohesion: 0.46
Nodes (6): compactClosedMarketCandles(), goldMarketStatusAt(), isFlatCandle(), isGoldMarketOpenAtUnix(), newYorkParts(), nyClock

### Community 63 - "TestRiskManagementScoring"
Cohesion: 0.29
Nodes (4): <20% drawdown + high PF -> full points., 30% drawdown -> partial points., 50%+ drawdown -> 0 points., TestRiskManagementScoring

### Community 64 - "TestRobustnessYears"
Cohesion: 0.29
Nodes (4): <5 years -> 0 for years component., 5 years -> partial credit., 10+ years -> full years component (15 pts)., TestRobustnessYears

### Community 65 - "TestRobustnessParameters"
Cohesion: 0.29
Nodes (4): 3 parameters -> full parameter component (5 pts)., 5 parameters -> partial deduction., 8+ parameters -> heavy deduction., TestRobustnessParameters

### Community 66 - "TestOverallVerdict"
Cohesion: 0.29
Nodes (4): Score >= 70 -> Deploy., 40 <= score < 70 -> Refine., Score < 40 -> Abandon., TestOverallVerdict

### Community 67 - "TestOutputJsonStructure"
Cohesion: 0.29
Nodes (4): evaluate() result must contain all required keys., Each dimension must have name, score, max_score., Total score must be 0-100., TestOutputJsonStructure

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

### Community 72 - "evaluator_module"
Cohesion: 0.40
Nodes (4): evaluator_module(), Test fixtures for backtest evaluator., Load evaluate_backtest.py as a module for unit tests., fixture

### Community 73 - "Path"
Cohesion: 0.40
Nodes (3): Path, write_outputs creates .json and .md files., TestFileOutput

### Community 74 - "ریسک و اندازه‌ی معامله — EMA50 ِ روزانه، استاپِ فاجعه ۳ATR"
Cohesion: 0.40
Nodes (5): ریسک و اندازه‌ی معامله — EMA50 ِ روزانه، استاپِ فاجعه ۳ATR, ۱. سبد با مرکب‌سازی, ۲. بوت‌استرپ (۲۰۰۰ مسیرِ ۵ ساله از بلوک‌های ۳۰ روزه), ۳. رشته‌ی ضرر, ۴. جا انداختنِ سیگنال (واچ‌لیست، ریسکِ ۱٪)

## Knowledge Gaps
- **458 isolated node(s):** `name`, `version`, `private`, `type`, `description` (+453 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `buildTimeIndex()` connect `drawings.ts` to `ArenaChart.tsx`, `MazneChart.tsx`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `api()` connect `app.js` to `createBot`, `action`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `onInput()` connect `action` to `panel.js`, `createBot`, `app.js`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `createBot()` (e.g. with `decide()` and `onCallback()`) actually correct?**
  _`createBot()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _458 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `panel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08637747336377473 - nodes in this community are weakly interconnected._
- **Should `createBot` be split into smaller, more focused modules?**
  _Cohesion score 0.14717741935483872 - nodes in this community are weakly interconnected._