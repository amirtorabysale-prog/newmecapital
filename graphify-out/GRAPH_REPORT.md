# Graph Report - newcapital  (2026-10-28)

## Corpus Check
- 34 files · ~31,462 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .ttf 2, .example 1)

## Summary
- 310 nodes · 787 edges · 12 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `10344555`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- panel.js
- createBot
- store.js
- strategy.test.js
- سندِ پیشرفت — بات سیگنال NewMe Capital
- panel.test.js
- package.json
- Find Skills
- backtest.js
- بات سیگنال — NewMe Capital
- deploy
- config.js

## God Nodes (most connected - your core abstractions)
1. `createBot()` - 56 edges
2. `b()` - 23 edges
3. `esc()` - 22 edges
4. `action()` - 19 edges
5. `price()` - 17 edges
6. `utc()` - 16 edges
7. `home` - 15 edges
8. `buildChartSvg()` - 14 edges
9. `onInput()` - 13 edges
10. `decide()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `رفع‌شده در ۲۸ اکتبر` --references--> `checkLivePrice()`  [INFERRED]
  PROGRESS.md → src/planEdit.js
- `رفع‌شده در ۲۸ اکتبر` --references--> `catchUp()`  [INFERRED]
  PROGRESS.md → src/tracker.js
- `setup()` --calls--> `createBot()`  [EXTRACTED]
  test/bot.test.js → src/telegram/bot.js
- `setup()` --calls--> `createBot()`  [EXTRACTED]
  test/panel.test.js → src/telegram/bot.js
- `setup()` --calls--> `loadConfig()`  [EXTRACTED]
  test/panel.test.js → src/config.js

## Import Cycles
- None detected.

## Communities (12 total, 0 thin omitted)

### Community 0 - "panel.js"
Cohesion: 0.11
Nodes (51): decimalsFor(), pct(), price(), utc(), adminAlert(), channelAnalysis(), channelSignal(), coinReport() (+43 more)

### Community 1 - "createBot"
Cohesion: 0.10
Nodes (57): checkChannel(), normalizeChannel(), parseSymbol(), resetParams(), saveSettings(), setParam(), fetchFrom(), applyEdits() (+49 more)

### Community 2 - "store.js"
Cohesion: 0.43
Nodes (7): writeJson(), dataDir(), load(), save(), snapshotPath(), statePath(), store

### Community 3 - "strategy.test.js"
Cohesion: 0.14
Nodes (19): analyze(), analyzeLong(), buildPlan(), findLtfDivergence(), mirrorCandles(), unmirror(), findDivergence(), rsiNear() (+11 more)

### Community 4 - "سندِ پیشرفت — بات سیگنال NewMe Capital"
Cohesion: 0.13
Nodes (14): استراتژی, این بات چه می‌کند, راه‌اندازی روی Railway — خلاصه, رفع‌شده در ۲۸ اکتبر, سندِ پیشرفت — بات سیگنال NewMe Capital, قابلیتِ برنامه‌ریزی‌شده (درخواستِ ۲۷ اکتبر ۲۰۲۶), مسیرِ کار, نتیجه‌ی بک‌تست (+6 more)

### Community 5 - "panel.test.js"
Cohesion: 0.21
Nodes (11): fakeApi(), lbankBody(), quiet, setup(), candlesFrom(), longSetup(), ltfDivergence(), path() (+3 more)

### Community 6 - "package.json"
Cohesion: 0.13
Nodes (15): dependencies, @resvg/resvg-js@^2.6.2, description, engines, node, name, private, scripts (+7 more)

### Community 7 - "Find Skills"
Cohesion: 0.14
Nodes (13): Common Skill Categories, Find Skills, How to Help Users Find Skills, Step 1: Understand What They Need, Step 2: Check the Leaderboard First, Step 3: Search for Skills, Step 4: Verify Quality Before Recommending, Step 5: Present Options to the User (+5 more)

### Community 8 - "backtest.js"
Cohesion: 0.07
Nodes (33): all, args, cfg, charts, maxBars, names, threshold, args (+25 more)

### Community 9 - "بات سیگنال — NewMe Capital"
Cohesion: 0.22
Nodes (8): Railway, استراتژی, بات سیگنال — NewMe Capital, بعد از هشدار, بک‌تست — آیا استراتژی جواب می‌دهد؟, داده, راه‌اندازی, پنل

### Community 10 - "deploy"
Cohesion: 0.33
Nodes (5): deploy, restartPolicyMaxRetries, restartPolicyType, startCommand, $schema

### Community 11 - "config.js"
Cohesion: 0.09
Nodes (22): DEFAULTS_PATH, loadConfig(), loadEnv(), MUTABLE_KEYS, readJson(), ROOT, SCAN_INTERVALS, settingsPath (+14 more)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createBot()` connect `createBot` to `panel.js`, `store.js`, `panel.test.js`, `backtest.js`, `config.js`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `createBot()` (e.g. with `decide()` and `onCallback()`) actually correct?**
  _`createBot()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Should `panel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10974025974025974 - nodes in this community are weakly interconnected._
- **Why does `@resvg/resvg-js` connect `package.json` to `backtest.js`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Should `createBot` be split into smaller, more focused modules?**
  _Cohesion score 0.09575012800819252 - nodes in this community are weakly interconnected._
- **Why does `رفع‌شده در ۲۸ اکتبر` connect `سندِ پیشرفت — بات سیگنال NewMe Capital` to `panel.js`, `createBot`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Should `strategy.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14482758620689656 - nodes in this community are weakly interconnected._