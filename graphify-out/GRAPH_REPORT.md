# Graph Report - newmecapital  (2026-10-27)

## Corpus Check
- 33 files · ~27,147 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .ttf 2, .example 1)

## Summary
- 286 nodes · 736 edges · 11 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fc2f5bf8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- panel.js
- createBot
- config.js
- strategy.test.js
- render.js
- panel.test.js
- package.json
- Find Skills
- exchanges/index.js
- بات سیگنال — NewMe Capital
- deploy

## God Nodes (most connected - your core abstractions)
1. `createBot()` - 52 edges
2. `b()` - 23 edges
3. `esc()` - 22 edges
4. `action()` - 19 edges
5. `price()` - 15 edges
6. `utc()` - 15 edges
7. `home` - 15 edges
8. `buildChartSvg()` - 14 edges
9. `onInput()` - 13 edges
10. `getPath()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `setup()` --calls--> `loadConfig()`  [EXTRACTED]
  test/panel.test.js → src/config.js
- `setup()` --calls--> `createBot()`  [EXTRACTED]
  test/bot.test.js → src/telegram/bot.js
- `setup()` --calls--> `createBot()`  [EXTRACTED]
  test/panel.test.js → src/telegram/bot.js
- `sig()` --calls--> `newSignal()`  [EXTRACTED]
  test/tracker.test.js → src/tracker.js
- `buildChartSvg()` --calls--> `price()`  [EXTRACTED]
  src/chart/render.js → src/format.js

## Import Cycles
- None detected.

## Communities (11 total, 0 thin omitted)

### Community 0 - "panel.js"
Cohesion: 0.10
Nodes (52): decimalsFor(), pct(), price(), adminAlert(), channelAnalysis(), channelSignal(), coinReport(), dateOf() (+44 more)

### Community 1 - "createBot"
Cohesion: 0.11
Nodes (49): checkChannel(), normalizeChannel(), parseSymbol(), resetParams(), saveSettings(), setParam(), fetchFrom(), applyEdits() (+41 more)

### Community 2 - "config.js"
Cohesion: 0.08
Nodes (29): args, cfg, charts, names, DEFAULTS_PATH, loadConfig(), loadEnv(), MUTABLE_KEYS (+21 more)

### Community 3 - "strategy.test.js"
Cohesion: 0.15
Nodes (19): analyze(), analyzeLong(), buildPlan(), mirrorCandles(), unmirror(), findDivergence(), rsiNear(), atr() (+11 more)

### Community 4 - "render.js"
Cohesion: 0.12
Nodes (20): all, args, cfg, charts, maxBars, names, threshold, axisTag() (+12 more)

### Community 5 - "panel.test.js"
Cohesion: 0.15
Nodes (13): fakeApi(), lbankBody(), quiet, setup(), candlesFrom(), longSetup(), path(), fakeApi() (+5 more)

### Community 6 - "package.json"
Cohesion: 0.13
Nodes (15): dependencies, @resvg/resvg-js@^2.6.2, description, engines, node, name, private, scripts (+7 more)

### Community 7 - "Find Skills"
Cohesion: 0.14
Nodes (13): Common Skill Categories, Find Skills, How to Help Users Find Skills, Step 1: Understand What They Need, Step 2: Check the Leaderboard First, Step 3: Search for Skills, Step 4: Verify Quality Before Recommending, Step 5: Present Options to the User (+5 more)

### Community 8 - "exchanges/index.js"
Cohesion: 0.19
Nodes (9): ADAPTERS, closedOnly(), fetchCandles(), TF_BITGET, TF_LBANK, TF_MEXC, TF_MS, scanAll() (+1 more)

### Community 9 - "بات سیگنال — NewMe Capital"
Cohesion: 0.22
Nodes (8): Railway, استراتژی, بات سیگنال — NewMe Capital, بعد از هشدار, بک‌تست — آیا استراتژی جواب می‌دهد؟, داده, راه‌اندازی, پنل

### Community 10 - "deploy"
Cohesion: 0.33
Nodes (5): deploy, restartPolicyMaxRetries, restartPolicyType, startCommand, $schema

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createBot()` connect `createBot` to `exchanges/index.js`, `config.js`, `render.js`, `panel.test.js`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `createBot()` (e.g. with `decide()` and `onCallback()`) actually correct?**
  _`createBot()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Should `panel.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10102843315184513 - nodes in this community are weakly interconnected._
- **Why does `@resvg/resvg-js` connect `package.json` to `render.js`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Should `createBot` be split into smaller, more focused modules?**
  _Cohesion score 0.1146051712089448 - nodes in this community are weakly interconnected._
- **Why does `utc()` connect `render.js` to `panel.js`, `createBot`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Should `config.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07936507936507936 - nodes in this community are weakly interconnected._