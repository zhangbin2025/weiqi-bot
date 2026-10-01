# SGF 解析代码去重重构计划

> 调查日期：2026-09-30
> 最后更新：2026-10-01
> 状态：解析侧已完成，构造侧已完成（#21-22、#23-27、#30 解析；G1-G5 构造）

## 背景

项目中存在大量 SGF 解析逻辑重复实现的问题。`domain/sgf/` 已提供完整的解析接口（`SGFParser`、`parseSGF`、`sgfToReplayData`），但许多文件仍自行手写解析器或用正则提取 SGF 数据，导致维护成本高、行为不一致。

## 现状分类

### ✅ 第一类：已通过 domain/sgf 接口（无需改动，共 20 个文件）

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
| 20 | `presentation/core/helpers/DecisionReplayHelper.ts` | `sgfToReplayData()` + gameInfo 覆盖（原 `ReplayHelper`，已改名） |

### ⚠️ 第二类：已用 domain 接口但有正则 fallback（可优化，共 2 个文件）

| # | 文件 | 问题 |
|---|------|------|
| 21 | `presentation/adapters/web/pages/review/ReviewPage.ts` | ✅ 已删除 `parseMovesCount`/`parseNewMoves` 的正则 fallback（死代码） |
| 22 | `presentation/adapters/web/pages/review/LiveModeManager.ts` | ✅ 已删除 `parseMovesByRegex()` fallback（死代码） |

### ❌ 第三类：自己写 SGF 解析逻辑（需整改，共 9 个文件）

| # | 文件 | 解析内容 | 优先级 | 改动建议 |
|---|------|----------|--------|----------|
| 23 | `services/game/providers/goproblems/GoProblemsProvider.ts` | ✅ 已改用 `parseSGF()`，删除手写解析器 | ✅ 完成 | — |
| 24 | `services/game/providers/foxwq/FoxwqLiveProviderBase.ts` | ✅ 已改用 `parseSGF().gameInfo`，删除 `parseSgfMetadata()` + `countMoves()` | ✅ 完成 | — |
| 25 | `services/game/providers/foxwq/FoxwqShareProvider.ts` | ✅ 已改用 `parseSGF().gameInfo` + `.moves.length`，删除 `parseSgfMetadata()` + `countMoves()` | ✅ 完成 | — |
| 26 | `services/game/providers/izis/IzisParser.ts` | ✅ 已改用 `parseSGF().gameInfo` + `.moves.length`，删除正则 `extractTag` + `countMoves` | ✅ 完成 | — |
| 27 | `services/game/providers/txwq/TxwqParser.ts` | ✅ 已改用 `parseSGF().gameInfo` + `.moves.length`，删除 `extractSgfProp`/`extractSgfNumber`/`countMoves` | ✅ 完成 | — |
| 28 | `services/game/providers/xinboduiyi/XinboduiyiParser.ts` | 非标准 SGF（大写坐标 + 旋转）+ 元数据来自 JSON | ⏭️ 不改 | 非标准 SGF 坐标 + 元数据来自平台 JSON，不适用 domain 接口 |
| 29 | `services/game/providers/yuanluobo/YuanluoboProvider.ts` | 非 SGF 解析（遍历 JSON moves 数组） | ⏭️ 不改 | `parseMoves()` 匹配单条 `move.coordinate` 字符串，非 SGF 文本解析 |
| 30 | `presentation/adapters/web/pages/play/renderers/HHGameDialogRenderer.ts` | ✅ 已改用 `parseSGF().moves.length`，修复误匹配 AB[]/PB[] 的 bug | ✅ 完成 | — |
| 31 | `services/game/providers/foxwq/FoxwqJueyiLiveProvider.ts` | ✅ 调用继承的 `sgfToMetadata()`（原 `parseSgfMetadata()`） | ✅ 完成 | — |

## 统计

### 解析侧
- 已用 domain 接口：28 个文件 ✅
- 有 fallback 正则：0 个文件 ✅
- 自己写解析逻辑：0 个文件 ✅（#28-29 经评估不属 SGF 解析，不改）

### 构造侧
- 已用 domain 接口（SGFWriter）：5 个文件 ✅（G1-G5）
- 保留手写构造：2 个文件 ⏭️（G6 1919数字坐标、G7 新博旋转坐标，不适用 domain 接口）

## 整改原则

### 解析侧
1. 所有 SGF 解析统一走 `domain/sgf` 接口（`parseSGF` / `SGFParser` / `sgfToReplayData`）
2. 移除自定义 `SGFNode` / `SgfNode` 类型定义，统一使用 `ISGFNode`
3. 正则提取元数据的地方改用 `parseSGF().gameInfo`
4. 正则统计手数的地方改用 `parseSGF().moves.length`
5. 保留必要的 fallback 仅用于非 SGF 格式数据（如平台专有 API 返回的 JSON 着法）

### 构造侧
1. 所有 SGF 生成统一走 `domain/sgf` 的 `SGFWriter.write()`
2. 扩展 `ISGFGameInfo`：新增 `application`、`source`、`blackRank`、`whiteRank`、`event` 字段
3. 扩展 `SGFWriter`：输出 `AP[]`、`SO[]`、`BR[]`、`WR[]`、`EV[]`、`HA[]` 属性
4. 各 Provider 保留专有逻辑（如 foxwq 让子跳过），仅序列化委托给 SGFWriter
5. 非标准坐标格式（1919 数字坐标、新博旋转坐标）保留手写构造

## 整改顺序

1. ✅ ~~#22 ReplayHelper~~ → DecisionReplayHelper — 已完成（2026-10-01，commit 0e0fef7）
2. ✅ #23 GoProblemsProvider — 手写解析器 → domain 接口（2026-10-01，commit f68a7da）
3. ✅ ~~#22 ReplayHelper~~ → DecisionReplayHelper — 已完成（2026-10-01，commit 0e0fef7）
4. ✅ #23 GoProblemsProvider — 手写解析器 → domain 接口（2026-10-01，commit f68a7da）
5. ✅ #24-25 FoxwqLiveProviderBase/FoxwqShareProvider — 正则元数据提取 → domain 接口（2026-10-01）
6. ✅ #31 FoxwqJueyiLiveProvider — 随 #24 改动自动生效
7. ✅ #26-27 IZIS/Txwq — 正则元数据提取 → domain 接口
8. ⏭️ #28-29 Xinboduiyi/Yuanluobo — 评估后不改（非标准 SGF / 非 SGF 解析）
9. ✅ #30 HHGameDialogRenderer — 简单手数统计 + bug 修复
10. ✅ #21-22 ReviewPage/LiveModeManager — 清理正则 fallback（死代码）


---

## SGF 构造（生成）整改

### domain 接口扩展（2026-10-01）

| 改动 | 内容 |
|------|------|
| `ISGFGameInfo` | 新增 `application?`、`source?`、`blackRank?`、`whiteRank?`、`event?` 字段 |
| `ISGFGameInfoFull` | 新增 `application?`、`source?` 字段 |
| `SGFWriter.write()` | 输出 `AP[]`、`SO[]`、`BR[]`、`WR[]`、`EV[]`、`HA[]` 属性 |
| `SGFParser` | 解析时提取 `AP`、`SO` 属性到 `gameInfo` |

### 构造整改明细

| # | 文件 | 原实现 | 改动 | 状态 |
|---|------|--------|------|------|
| G1 | `FoxwqLiveProviderBase.ts` | ~60 行手写 `createSgf()`，含让子 AB[] + 跳过逻辑 | 改用 `SGFWriter.write()`，适配层处理让子跳过 + `handicapStones` | ✅ 完成 |
| G2 | `IzisParser.ts` | ~20 行手写 `generateSgf()` | 改用 `SGFWriter.write()`，传入 `application: '隐智智能棋盘'` | ✅ 完成 |
| G3 | `YuanluoboProvider.ts` | ~15 行手写 `generateSgf()` | 改用 `SGFWriter.write()` | ✅ 完成 |
| G4 | `YichengParser.ts` | ~20 行手写 `generateSgf()` | 改用 `SGFWriter.write()`，传入 `application: '弈城围棋'` | ✅ 完成 |
| G5 | `ShoutanParser.ts` | ~20 行手写 `generateSgf()` | 改用 `SGFWriter.write()`，传入 `application: 'GoStarV7'`、`source: '丹朱对局集'` | ✅ 完成 |
| G6 | `Weiqi1919SgfGenerator.ts` | 专有数字坐标(0-360) + 动态 info 对象 | ⏭️ 不改 | 非标准坐标格式，不适用 domain 接口 |
| G7 | `XinboduiyiParser.ts` | 自定义坐标旋转 | ⏭️ 不改 | 着法坐标需旋转，生成时反向旋转，SGFWriter 不支持 |

### 让子棋处理（G1 FoxwqLiveProviderBase）

原 `createSgf()` 的让子跳过逻辑：
- moves 列表可能包含让子位置上的黑棋（从 WebSocket 数据直接提取）
- 输出 SGF 时需要跳过这些重复着法（已在 AB[] 中摆放）

适配方案：
1. 在转换为 `MoveOrPass[]` 时，用 `handicapSet` 过滤让子位置上的黑棋
2. 让子位置通过 `ISGFGameInfo.handicapStones` 传给 SGFWriter
3. SGFWriter 输出 `HA[]` + `AB[]` 属性

## 整改记录

### ✅ #22 ReplayHelper → DecisionReplayHelper（2026-10-01）

- **commit**: `0e0fef7`
- **改动**:
  - 删除 `ReplayHelper.ts`（~300 行手写 SGF 解析器、自定义 `SGFNode`/`SGFParseResult`/`GameInfo` 类型）
  - 新建 `DecisionReplayHelper.ts`（110 行），SGF 解析全部委托给 `domain/sgf` 的 `sgfToReplayData()`
  - 保留 gameInfo 覆盖逻辑 + localStorage 存储功能
  - **改名原因**：原名称与 `clients/web/replay` 页面容易混淆，实际唯一调用方是决策题页面（`DecisionPage`）
  - 新增 20 个单测，全量 2071 测试通过
  - 删减净 ~230 行手写解析逻辑

### ✅ #24-25 FoxwqLiveProviderBase/FoxwqShareProvider — 正则元数据提取 → domain 接口（2026-10-01）

- **改动**:
  - `FoxwqLiveProviderBase.ts`：删除 `parseSgfMetadata()`（正则逐字段提取 PB/PW/SZ/KM/HA/RU/DT/RE）+ `countMoves()`（正则统计 `[BW][xx]`），新增 `sgfToMetadata()` 调用 `parseSGF().gameInfo` + `.moves.length`
  - `FoxwqShareProvider.ts`：同样删除两个方法，新增 `sgfToMetadata()` 调用 `parseSGF()`
  - `FoxwqJueyiLiveProvider.ts`：调用点从 `parseSgfMetadata()` 改为 `sgfToMetadata()`
  - 新增 `FoxwqSgfMetadata.test.ts`：29 个单测覆盖标准 SGF、让子棋、缺失字段、Pass 着法、直播生成 SGF 回解析、空/异常输入
  - **komi 类型适配**：domain 返回 `string`（默认 `'375'`），转换层用 `parseFloat` + 特判 domain 默认值 `'375'` 回退到 foxwq 默认 `6.5`；`KM[0]` 正确处理（0 是 falsy，改用 `isNaN` 判断）
  - 删减净 ~40 行正则解析逻辑
  - 全量 2135 测试通过

### ✅ #23 GoProblemsProvider — 手写解析器 → domain 接口（2026-10-01）

- **commit**: `f68a7da`
- **改动**:
  - 删除 ~200 行手写 SGF tokenizer/解析器（`tokenize`/`parseSgf`/`parseSequence`/`parseNodeProperties`/`findClosingParen`）
  - 删除自定义 `SgfNode` 接口，统一使用 `ISGFNode`
  - 删除正则提取方法（`extractBoardSize`/`extractStones`/`extractPlayerColor`），改用 `parseSGF()` 结果
  - 保留 goproblems 特有分支分类逻辑（RIGHT/CHOICE/NOTTHIS → 正解图/变化图/失败图），适配 `ISGFNode` 树结构
  - `collectMoves` 从 `next` 链改为 `children[0]` 链
  - 新增 35 个单测，全量 2106 测试通过
  - 删减净 196 行（77 增 / 273 删）

### ✅ G1-G5 SGF 构造 → domain 接口（2026-10-01）

- **domain 扩展**:
  - `ISGFGameInfo` 新增 `application`/`source`/`blackRank`/`whiteRank`/`event` 字段
  - `SGFWriter.write()` 支持 `AP[]`/`SO[]`/`BR[]`/`WR[]`/`EV[]`/`HA[]` 属性输出
  - `SGFParser` 解析时提取 `AP`/`SO` 到 `gameInfo`
- **改动**:
  - G1 FoxwqLiveProviderBase: ~60 行 → 适配层 + `SGFWriter.write()`，保留让子跳过逻辑
  - G2 IzisParser: ~20 行 → `SGFWriter.write()`，传入 `application: '隐智智能棋盘'`
  - G3 YuanluoboProvider: ~15 行 → `SGFWriter.write()`
  - G4 YichengParser: ~20 行 → `SGFWriter.write()`，传入 `application: '弈城围棋'`
  - G5 ShoutanParser: ~20 行 → `SGFWriter.write()`，传入 `application: 'GoStarV7'`、`source: '丹朱对局集'`
- **不改**: G6（1919 数字坐标）、G7（新博旋转坐标）
- 删减净 ~115 行手写 SGF 构造逻辑
- 全量 2154 测试通过，0 类型错误
