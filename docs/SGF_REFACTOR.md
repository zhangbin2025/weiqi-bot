# SGF 解析代码去重重构计划

> 调查日期：2026-09-30
> 状态：待整改

## 背景

项目中存在大量 SGF 解析逻辑重复实现的问题。`domain/sgf/` 已提供完整的解析接口（`SGFParser`、`parseSGF`、`sgfToReplayData`），但许多文件仍自行手写解析器或用正则提取 SGF 数据，导致维护成本高、行为不一致。

## 现状分类

### ✅ 第一类：已通过 domain/sgf 接口（无需改动，共 19 个文件）

| # | 文件 | 用法 |
|---|------|------|
| 1 | `application/fetcher/FetcherApp.ts` | `parseSGF()` |
| 2 | `application/opponent/OpponentAnalyzer.ts` | `parseSGF()` |
| 3 | `application/replay/ReplayApp.ts` | `sgfToReplayData()` + `SGFParser` |
| 4 | `services/decision/DecisionGenerator.ts` | `parseSGF()` |
| 5 | `services/game/GameFetchHelper.ts` | `parseSGF()` fallback 统计手数 |
| 6 | `services/game/providers/katago/KatagoGameProvider.ts` | `parseSGF()` |
| 7 | `services/game/providers/library/BuiltinLibraryProvider.ts` | `parseSGF()` |
| 8 | `services/game/providers/yike/YikeOnlineGameProvider.ts` | `SGFParser` 实例 |
| 9 | `services/recorder/RecorderService.ts` | `SGFParser` + `SGFWriter` |
| 10 | `services/review/ReviewService.ts` | 注入 `SGFParser` |
| 11 | `services/thumbnail/ThumbnailMoveParser.ts` | `SGFParser` |
| 12 | `clients/cli/commands/review.ts` | `new SGFParser()` 注入 ReviewService |
| 13 | `clients/web/review/index.ts` | `new SGFParser()` 注入 ReviewService |
| 14 | `domain/joseki/JosekiDiscoverer.ts` | `SGFParser`（domain 层内部） |
| 15 | `application/joseki/JosekiDiscoverApp.ts` | `new SGFParser()` |
| 16 | `clients/cli/commands/board.ts` | `new SGFParser()` |
| 17 | `clients/cli/commands/joseki-auto.ts` | `new SGFParser()` |
| 18 | `clients/cli/commands/joseki-build.ts` | `new SGFParser()` |
| 19 | `clients/cli/commands/joseki.ts` | `new SGFParser()` |

### ⚠️ 第二类：已用 domain 接口但有正则 fallback（可优化，共 2 个文件）

| # | 文件 | 问题 |
|---|------|------|
| 20 | `presentation/adapters/web/pages/review/ReviewPage.ts` | `parseMovesCount()`、`parseNewMoves()` 有正则 fallback |
| 21 | `presentation/adapters/web/pages/review/LiveModeManager.ts` | `parseMovesByRegex()` 正则 fallback |

### ❌ 第三类：自己写 SGF 解析逻辑（需整改，共 10 个文件）

| # | 文件 | 解析内容 | 优先级 | 改动建议 |
|---|------|----------|--------|----------|
| 22 | `presentation/core/helpers/ReplayHelper.ts` | 手写完整 SGF 树解析器（~100 行），自定义 `SGFNode` 类型 | 🔴 高 | 改用 `SGFParser.parse()` + `sgfToReplayData()` |
| 23 | `services/game/providers/goproblems/GoProblemsProvider.ts` | 手写 tokenizer + 树解析器（~200 行），自定义 `SgfNode` 类型 | 🔴 高 | 改用 `SGFParser.parse()` |
| 24 | `services/game/providers/foxwq/FoxwqLiveProviderBase.ts` | `parseSgfMetadata()` 正则提取 PB/PW/SZ/KM/HA/RU/DT/RE | 🟡 中 | 改用 `parseSGF().gameInfo` |
| 25 | `services/game/providers/foxwq/FoxwqShareProvider.ts` | `parseSgfMetadata()` + `countMoves()` 正则 | 🟡 中 | 改用 `parseSGF().gameInfo` + `.moves.length` |
| 26 | `services/game/providers/izis/IzisParser.ts` | `parseSgfMetadata()` 正则提取元数据 + 手数 | 🟡 中 | 改用 `parseSGF().gameInfo` + `.moves.length` |
| 27 | `services/game/providers/txwq/TxwqParser.ts` | `countMoves()` 正则统计 `[BW][xx]` | 🟡 中 | 改用 `parseSGF().moves.length` |
| 28 | `services/game/providers/xinboduiyi/XinboduiyiParser.ts` | `parseMoves()` 正则提取 `[BW][XX]` + 坐标转换 | 🟡 中 | 需评估：有自定义坐标旋转逻辑 |
| 29 | `services/game/providers/yuanluobo/YuanluoboProvider.ts` | `parseMoves()` 正则提取 `([BW])([a-z]{2})` | 🟡 中 | 改用 `parseSGF().moves` |
| 30 | `presentation/adapters/web/pages/play/renderers/HHGameDialogRenderer.ts` | `countMovesFromSGF()` 正则统计 `B[` + `W[` | 🟢 低 | 改用 `parseSGF().moves.length` |
| 31 | `services/game/providers/foxwq/FoxwqJueyiLiveProvider.ts` | 调用继承的 `parseSgfMetadata()` | 🟡 中 | 随 #24 改动后自动生效 |

## 统计

- 已用 domain 接口：19 个文件 ✅
- 有 fallback 正则：2 个文件 ⚠️
- 自己写解析逻辑：10 个文件 ❌（预计可消除重复代码 ~300+ 行）

## 整改原则

1. 所有 SGF 解析统一走 `domain/sgf` 接口（`parseSGF` / `SGFParser` / `sgfToReplayData`）
2. 移除自定义 `SGFNode` / `SgfNode` 类型定义，统一使用 `ISGFNode`
3. 正则提取元数据的地方改用 `parseSGF().gameInfo`
4. 正则统计手数的地方改用 `parseSGF().moves.length`
5. 保留必要的 fallback 仅用于非 SGF 格式数据（如平台专有 API 返回的 JSON 着法）
6. #28（新博对弈）需保留坐标旋转逻辑，仅解析部分改用 domain 接口

## 整改顺序

1. 🔴 #22 ReplayHelper — 手写解析器 → domain 接口
2. 🔴 #23 GoProblemsProvider — 手写解析器 → domain 接口
3. 🟡 #24-27 Foxwq/IZIS/Txwq — 正则元数据提取 → domain 接口
4. 🟡 #28-29 Xinboduiyi/Yuanluobo — 评估后整改
5. 🟢 #30 HHGameDialogRenderer — 简单手数统计
6. ⚠️ #20-21 ReviewPage/LiveModeManager — 清理正则 fallback
