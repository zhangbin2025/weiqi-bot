#!/usr/bin/env -S npx tsx
/**
 * 内置棋谱库生成脚本 v1.1
 *
 * 从 ~/.weiqi-sgf/ 读取棋谱，按分类打包为仿 KataGo 的 .tar.bz2 归档，
 * 供前端「内置题库 / 内置棋谱」使用。
 *
 * 分类（按源目录）：
 *   life-and-death  题库     : weiqi101 / shizhan101 / qili101 / goproblems
 *   ai-review       实战AI   : foxwq / ogs
 *
 * goproblems 合入规则（2026-10-27）：
 *   · 难度带问号（悬而未决）→ 不入库（抓取侧已过滤，此处兜底）
 *   · 难度裁剪到 [15K, 7D]：30K~15K 统一为 15K，7D 以上统一为 7D
 *   · 类型对齐：joseki → 布局题（并入现有布局题，不再开“定式题”分类）
 *   · best move 已在抓取侧排除
 *   · PL[W]（白先）纳入白名单保留，不再依赖运行时首手推断
 *
 * 唯一 id = 【内容派生】，与日期/序号/文件名/口令无关（2026-10-28 改）：
 *   题库(life-and-death) = 初始局面棋形哈希（最小路数 × 8 方向 × 黑白互换的规范值）
 *   棋谱(ai-review)      = contentMd5（白名单重建后 SGF 的 md5）
 *
 *   为什么必须纯内容派生：内置库是【增量更新】的，每天生成一次。
 *   旧算法 HMAC(来源码|日期|序号|文件名) 含日期与序号，二者每次生成都变，
 *   于是同一条棋谱的 id 跟着变 —— 分享出去的 lib:// URL 过一天就失效，
 *   做题历史按 URL 去重也会把昨天的题判成新题（已做数突破总数）。
 *   改为内容派生后：只要这条棋谱还在库里（增量更新不会删存量），
 *   lib://<category>/<md5> 就永久可打开。
 * 去重（v1.2）：按「分类 + 内容 MD5」去重，重复棋谱只入库首次出现的那条。
 *   rawMd5     = md5(原始文件文本)           —— 同一文件多次落盘
 *   contentMd5 = md5(白名单重建后的 SGF)      —— 同一题换个来源/文件名也算重复
 *   判定以 contentMd5 为准（入库内容相同即重复），rawMd5 仅用于快筛与溯源。
 *   去重在每次全量重建内生效（按分类判定，已入库即跳过）。
 *   被跳过的重复项记入 ~/.weiqi-sgf-library/duplicate-map.json（本机溯源，不进仓库）。
 *
 * 输出（默认 clients/web/shared/assets/data/games/）：
 *   <category>/<YYYY-MM-DD>.pNNNN.tar.bz2  分块归档（块大小见 CHUNK_SIZE，按分类不同）。
 *        取整包会让「加载 1 道题」也下载整包（题库 3.3MB / 棋谱 2.8MB），故切块按需下载；
 *        块内顺序是全局顺序的一段，meta 下标可直接换算到块内偏移。
 *   <category>/<YYYY-MM-DD>.meta.json.gz  轻量元数据（两个分类都生成）：
 *        { version, category, date, count, chunkSize, chunks, pw?, ids? }
 *        pw[i] / ids[i] 对应 tar 内按文件名排序后的第 i 个 SGF，即 lib://<cat>/<date>/<i>。
 *        题库写 pw（标签）：只存标签不存 id —— id 是 md5 随机串不可压缩
 *          （实测存 id 会从 71KB 涨到 813KB），而标签重复度极高（4.2 万题仅 276 种取值）。
 *        棋谱写 ids（md5 文件名）：列表要展示 id，而棋谱盘数远少于题库，
 *          678 个 id 实测约 12KB（gzip 后），代价可忽略。
 *        用途：列表/筛选只下载这份索引，避免为拿一个标签或 id 而解压全包。
 *   index.json.gz                     { version, generatedAt, categories: { cat: [dates...] } }
 *
 * 构建模式：恒为全量重建 —— 每次运行都清空输出与去重集合，重扫所有日期，
 *       并重置 private-map.json。不提供增量模式（水位递增 + 跨批次去重）。
 *
 *       原因：归档已按日期分块，增量追加会让「同一个日期目录下既有旧块又有新块」
 *       的边界情况难以维护；且全量重建能重新纳入历史上被去重跳过的记录，
 *       并保证 private-map 始终是「本次发布产物 ↔ 本地路径」的完整映射
 *       （增量模式下 private-map 只覆盖增量部分，老条目溯源不到）。
 *
 * 匿名化 / 精简（发布数据不含来源、人名、平台名、口令）：
 *   死活题：棋手→黑棋/白棋；分支标签去人名；难度/先后手/正解图/失败图保留。
 *   实战AI：棋手→黑棋/白棋（段位保留）；AI/引擎/网络名→去掉；
 *           胜率注释统一归一化为野狐风格「黑xx.x% / 白xx.x%」（以走子方为准，
 *           OGS 黑方视角的胜率在白棋手翻转为 100-x），目差保留。
 *
 * 私密映射（本机，不进仓库，用于溯源）：
 *   ~/.weiqi-sgf-library/private-map.json
 *
 * 用法：
 *   node scripts/generate-sgf-library.mjs [options]
 * 选项：
 *   --input  <path>   源目录（默认 ~/.weiqi-sgf）
 *   --output <path>   输出目录（默认 clients/web/shared/assets/data/games）
 *   --dedup-only      只统计重复、不改动输出（去重体检用）
 *   -h, --help
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { gzipSync } from 'zlib';
import { join, basename, dirname } from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { SGFParser } from "../domain/sgf/SGFParser.js";
import { SGFWriter } from "../domain/sgf/SGFWriter.js";

// ─── 配置 ──────────────────────────────────────────────

const LIB_DIR = join(homedir(), '.weiqi-sgf-library');
const DEFAULT_INPUT = join(homedir(), '.weiqi-sgf');
const DEFAULT_OUTPUT = join(process.cwd(), 'clients/web/shared/assets/data/games');
const PRIVATE_MAP_PATH = join(LIB_DIR, 'private-map.json');
const DUPLICATE_MAP_PATH = join(LIB_DIR, 'duplicate-map.json');

/** 源目录 → { code(来源码, 仅内部/id 用), category, perspective(胜率视角) } */
const SOURCES = {
  foxwq:        { code: 'FWQ', category: 'ai-review', perspective: 'mover' },
  ogs:          { code: 'OGS', category: 'ai-review', perspective: 'black' },
  weiqi101:     { code: 'W101', category: 'life-and-death', perspective: null },
  shizhan101:   { code: 'SHZ', category: 'life-and-death', perspective: null },
  qili101:      { code: 'QL101', category: 'life-and-death', perspective: null },
  // goproblems.com 全站死活题（2026-10-27 合入）。
  // 抓取侧已过滤：难度带问号（悬而未决）、无难度、genre=best move 不落盘。
  goproblems:   { code: 'GP', category: 'life-and-death', perspective: null },
};
const CATEGORIES = ['life-and-death', 'ai-review'];

/**
 * 分块归档：每个分类每块的条目数。
 * 取单条时只需下载+解压所在块，避免整包下载解压。
 *
 * 两个分类单条体积差 ~70 倍（题库单题 ~430B，实战棋谱单盘含变化图 ~30KB），
 * 故块大小不能一刀切，按分类实测取值：
 *   life-and-death  1000/块 → 4.5 万题 46 块，总包体 +1.8%，单块 ~90KB、解压 ~31ms
 *   ai-review         50/块 → 678 盘 14 块，总包体 +0.6%，单块 ~266KB、解压 ~119ms
 *     （ai-review 备选实测：100/块 +0.3% 489KB/163ms；150/块 +0.1% 732KB/222ms；
 *       200/块 +0.1% 928KB/260ms）
 *     取 50 是因为「点开一盘棋」体感最敏感，且包体代价仅 +0.6%。
 * 数据规模持续增长，块数会随之上升，这里的题数/块数仅作当时量级参考。
 */
const CHUNK_SIZE = {
  'life-and-death': 1000,
  'ai-review': 50,
};

// ─── 参数解析 ────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input': opts.input = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--dedup-only': opts.dedupOnly = true; break;
      case '--help':
      case '-h':
        console.log(`
内置棋谱库生成脚本 v1.3（全量重建）

用法: npx tsx scripts/generate-sgf-library.mjs [选项]

说明: 每次运行都是全量重建 —— 清空输出与去重集合，重扫所有日期，
      并重置 private-map.json。无增量模式。

选项:
  --input  <path>   源目录（默认 ~/.weiqi-sgf）
  --output <path>   输出目录（默认 clients/web/shared/assets/data/games）
  --dedup-only      只统计重复、不改动输出（去重体检用）
  -h, --help        显示帮助
`);
        process.exit(0);
    }
  }
  return opts;
}


/**
 * 稳定题目 ID（题库专用）
 *
 * @description 由【初始局面棋形】派生：8 方向 × 黑白互换取规范最小值。
 *
 *   为什么不能用原来的 HMAC(sourceCode|date|seq|filename)：
 *   它含 date 与 seq，而内置库是【增量更新】的 —— 每天新跑一次生成脚本，
 *   date 变、序号整体平移，同一道题的 ID 跟着变。于是：
 *     · 分享出去的 lib:// URL 过一天就失效；
 *     · 做题历史按 URL 去重 → 昨天的题今天全被判成新题，已做数突破总数。
 *
 *   改为内容派生后：只要库是增量更新的，同一道题永远得到同一个 ID，
 *   lib://<category>/<md5> 永久可打开（这正是「棋谱分享 URL 会变」的修复）。
 *
 * @param sgf 白名单重建后的 SGF
 * @param contentMd5 该 SGF 的内容 md5，用于空局面（无摆子）回落
 * @returns 32 位 hex；空局面返回 null（调用方回落 contentMd5）
 */
function computeStablePuzzleId(sgf) {
  const ph = lifePositionHashes(sgf);
  // 取字典序最小的那个哈希作规范值：保证同一棋形的 16 个变体收敛到同一个 ID
  return ph ? [...ph].sort()[0] : null;
}


// ─── 去重（MD5） ────────────────────────────────────────

/** 文本 MD5（hex） */
function md5(text) {
  return crypto.createHash('md5').update(text, 'utf-8').digest('hex');
}

// ─── 去复：死活题「初始局面」8 方向哈希 ────────────────
//
// 背景：contentMd5 只能识别「完全相同的 SGF」。同一道题换个来源，根节点注释、
// PB/PW、分支顺序、坐标书写顺序都会变，白名单重建后 contentMd5 仍不同，
// 于是「同一道题两个马甲」识别不出来（101 系与 goproblems 之间存在大量此类）。
//
// 口径（2026-10-27 与用户确认，同日修正）：
//   1) 【看黑白】棋形 = 黑子集合 + 白子集合，两者是分开的。
//      ⚠️ 不能只取「所有摆子的坐标集合」：那样「aa,ba 全是黑子」与
//      「aa 黑 / ba 白」会塌成同一题（实测过，是错的）。
//   2) 【黑白互换也算重复】在 1) 的基础上，额外生成「黑白对调」那一版的哈希。
//      即同一棋形、只是黑白互换/先行方不同的，仍判为同一题。
//      → 共 8 方向 × 2 种配色 = 16 个哈希，任一命中即判重。
//   3) 不管首着。同一局面可能有多种正解，首着不同不代表是不同题。
//   4) 【路数由摆子包围盒自己算】（2026-10-28 修正）：最小标准路数 9/13/19，
//      ⚠️ 不用 SGF 的 SZ —— SZ 只说明出题者用了多大的盘，不是棋形自身的属性。
//      同一棋形摆在 9 路还是 19 路盘上，算出的 ID 必须相同，跨来源马甲才认得出。
//   5) 不看先行方(PL)：先行方已由 2) 的黑白互换覆盖。
//   6) 空局面（无摆子）无法算局面哈希 → 返回 null，调用方退回 contentMd5。
//
// ⚠️ 仅用于 life-and-death。ai-review 绝不能用：所有对局初始都是空枰，
//    按局面去重会让整包塌成 1 条。

/**
 * 取 SGF 文本里的摆子坐标，【黑/白分开返回】{ black, white }，元素为 [x,y]。
 * 剔除 tt（脱先/pass）。
 *
 * 用逐字符扫描而不是正则：SGF 属性值里的 \\ 与 ] 转义在「字符串 → RegExp」
 * 之间极易写错（实测过一次，构造出的正则损坏且 --check 才暴露），
 * 直接按 [xx] 形态取两个字母更稳。
 */
function extractSetupPoints(sgf) {
  const black = [], white = [];
  for (const [tag, out] of [['AB', black], ['AW', white]]) {
    let i = 0;
    // 找到每个 "AB[" / "AW[" 起点，然后连续读取紧邻的 [xx] 坐标
    for (;;) {
      const at = sgf.indexOf(tag + '[', i);
      if (at < 0) break;
      let j = at + tag.length;
      while (j + 2 < sgf.length && sgf[j] === '[' && sgf[j + 3] === ']') {
        const c = sgf.slice(j + 1, j + 3);
        if (c !== 'tt' && /^[a-z]{2}$/.test(c)) {
          out.push([c.charCodeAt(0) - 97, c.charCodeAt(1) - 97]);
        }
        j += 4;
      }
      i = at + tag.length;
    }
  }
  return { black, white };
}

/**
 * 计算初始局面的哈希集合：8 方向 × 2 种配色（原色 / 黑白互换） = 最多 16 个。
 * 任一命中即判重。
 * @returns {Set<string>} 哈希集合；无摆子或非方形棋盘时返回 null
 */
/**
 * 最小标准路数（9 / 13 / 19）
 *
 * @description 与 domain/sgf/TsumegoMinBoard.ts 的 roundUpToStandard 同口径。
 *              ⚠️ 由【摆子包围盒】推算，与 SGF 的 SZ 无关 —— 见 lifePositionHashes。
 */
function roundUpToStandard(n) {
  if (n <= 9) return 9;
  if (n <= 13) return 13;
  return 19;
}

function lifePositionHashes(sgf) {
  const { black, white } = extractSetupPoints(sgf);
  const B = black.slice();
  const W = white.slice();
  if (B.length === 0 && W.length === 0) return null;

  // ① 最小路数：只由摆子包围盒推算，【与 SGF 的 SZ 无关】。
  //    同一棋形摆在 SZ=9 或 SZ=19 的盘上算出的 ID 相同，跨来源马甲才能被认出。
  //    （SZ 只反映「出题者用了多大的盘」，不是棋形本身的属性。）
  let minX0 = Infinity, maxX0 = -Infinity, minY0 = Infinity, maxY0 = -Infinity;
  for (const [x, y] of [...B, ...W]) {
    if (x < minX0) minX0 = x;
    if (x > maxX0) maxX0 = x;
    if (y < minY0) minY0 = y;
    if (y > maxY0) maxY0 = y;
  }
  const n = roundUpToStandard(Math.max(maxX0 - minX0 + 1, maxY0 - minY0 + 1));

  // ② 先平移到包围盒原点：保证坐标落在 [0, n-1]，旋转/镜像才有确定定义域
  const B0 = B.map(([x, y]) => [x - minX0, y - minY0]);
  const W0 = W.map(([x, y]) => [x - minX0, y - minY0]);

  const hashes = new Set();
  for (let rot = 0; rot < 4; rot++) {
    for (let flip = 0; flip < 2; flip++) {
      const tf = ([x0, y0]) => {
        let x = x0, y = y0;
        for (let r = 0; r < rot; r++) { const nx = y, ny = n - 1 - x; x = nx; y = ny; }
        if (flip) x = n - 1 - x;
        return [x, y];
      };
      const qb = B0.map(tf);
      const qw = W0.map(tf);
      // ③ 变换会移动包围盒，故每个变体各自归零再序列化
      //    归一化原点用【黑白合并后】的包围盒左上角，保证两色的相对位置不被破坏
      const all = [...qb, ...qw];
      const minX = Math.min(...all.map((p) => p[0]));
      const minY = Math.min(...all.map((p) => p[1]));
      const norm = (pts) => pts.map(([x, y]) => `${x - minX},${y - minY}`).sort().join(';');
      const nb = norm(qb);
      const nw = norm(qw);
      // 原色 + 黑白互换：任一命中即判重（黑白互换是同一道题）
      hashes.add(md5(`${n}|B${nb}|W${nw}`));
      hashes.add(md5(`${n}|B${nw}|W${nb}`));
    }
  }
  return hashes;
}

/** 本地时区的 YYYY-MM-DD（不用 UTC，避免跨日错判） */
function localDateString(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 本次运行内的 contentMd5 去重集合（key = "<category>:<contentMd5>"）。
 * 全量重建下每次都从空集合开始，故不存在「历史重复」与「本次重复」之分。
 */
function loadDedupSet() {
  return { all: new Set() };
}

// ─── Domain SGF 接口 ────────────────────────────────────


const sgfParser = new SGFParser();
const sgfWriter = new SGFWriter();

// ─── 白名单 ─────────────────────────────────────────────

/**
 * 死活题允许的 SGF 标准头属性（白名单）
 */
const LIFE_HEADER_WHITELIST = new Set([
  'CA', 'GM', 'FF', 'SZ', 'PB', 'PW', 'KM', 'HA', 'RU',
  // PL（先手方）：死活题的「白先」靠它表达。此前不在白名单里，入库时被丢弃，
  // goproblems 有 9267 道白先题、101 系也有数千道，全靠运行时「首手推断」兜底。
  // 显式保留更稳妥，也避免推断规则变动时静默出错。
  'PL',
]);

/**
 * AI 复盘允许的 SGF 标准头属性（白名单）
 */
const AI_HEADER_WHITELIST = new Set([
  'CA', 'GM', 'FF', 'SZ', 'PB', 'PW', 'BR', 'WR', 'KM', 'HA', 'RU', 'RE',
]);

/**
 * 死活题允许的着法属性
 */
const LIFE_MOVE_PROPS = new Set(['B', 'W', 'AB', 'AW']);

/**
 * AI 复盘允许的着法属性
 */
const AI_MOVE_PROPS = new Set(['B', 'W']);

// ─── 属性辅助 ───────────────────────────────────────────

/**
 * 从 ISGFNode.properties 获取属性值
 */
function getProp(props, ident) {
  const v = props[ident];
  if (v === undefined) return null;
  if (Array.isArray(v)) return v[0] ?? '';
  return String(v);
}

/**
 * 在 ISGFNode.properties 中设置属性值
 */
function setProp(props, ident, value) {
  props[ident] = value;
}

// ─── 业务逻辑 ───────────────────────────────────────────

/**
 * 从死活题 PW 字段提取难度信息
 */
/**
 * 从死活题 PW 字段或根节点 C[] 提取难度信息
 * 支持格式：
 *   PW: "GoProblems 25 kyu" → "25k"
 *   PW: "OGS life_and_death 18k" → "18k"
 *   PW: "13K 死活题" → "13K 死活题"
 *   PW: "8K+ 死活题" → "8K+ 死活题"
 *   PW: "4D+ 死活题" → "4D+ 死活题"
 *   PW: "adum" + C: "GP-62868 - 17 kyu life and death - 白先" → "17k"
 *   PW: "Exercise 034" + C: "OGS-2806 - life_and_death 15k - 白先" → "15k"
 */
function extractDifficulty(pw, rootComment) {
  // goproblems 根节点 C[] 形如 "GP-56820 - 18 kyu life and death - 黑先"，
  // 是难度的权威来源，优先取它。
  //
  // ⚠️ 必须优先于 PW：白先题的 PW 是作者名（如 PW[j074r0kun6]、PW[J0kel2]、
  // PW[dam0kgs]），而下面的裸正则 (\d+\s*[kKdDpP]) 会把作者名里的 “0k” 当成难度，
  // 实测把 4 道 9D/7D/22K 题错标成 0K。
  const gp = (rootComment || '').match(/GP-\d+\s*-\s*(\d+)\s*(kyu|dan)/i);
  if (gp) return gp[2].toLowerCase() === 'kyu' ? gp[1] + 'K' : gp[1] + 'D';

  const sources = [pw || '', rootComment || ''];
  for (const s of sources) {
    if (!s) continue;
    // "25 kyu" / "29 kyu" / "17 kyu" → 25k
    let m = s.match(/(\d+)\s*kyu/i);
    if (m) return m[1] + 'K';
    // "13K 死活题" / "8K+ 死活题" / "2D+ 官子题" / "4D+ 中盘作战题" → 保留完整“+”（类型不限）
    m = s.match(/(\d+\s*[kKdD]\+?)\s*\S*题/);
    if (m) return m[1].replace(/\s/g, '').toUpperCase();
    // "life_and_death 18k" / "joseki 12k" → 18k
    // 左侧加 (^|[^A-Za-z0-9]) 边界：避免作者名/ID 里的 “数字+k” 被误判为难度
    // （如 "j074r0kun6" 里的 0k、"J0kel2" 里的 0k）。
    m = s.match(/(?:^|[^A-Za-z0-9])(\d+\s*[kKdDpP])(?!\s*kyu)(?!\s*死)/);
    if (m) return m[1].replace(/\s/g, '').toUpperCase();
  }
  return '';
}

/**
 * 从死活题 PW 字段 / 根节点 C[] 提取「题目类型」并归一化为中文。
 * 归一化映射：
 *   死活题 / life_and_death / elementary → 死活题
 *   手筋题 / tesuji                      → 手筋题
 *   对杀题                              → 对杀题
 *   官子题 / endgame                    → 官子题
 *   中盘作战题 / middlegame             → 中盘题
 *   布局题 / fuseki / opening           → 布局题
 *   棋理题                              → 棋理题
 *   best_move                           → 一选题
 *   定式题 / joseki                     → 定式题
 *   无法识别                            → 死活题（默认）
 */
/**
 * 难度裁剪（2026-10-27，为合入 goproblems 引入）。
 * goproblems 的等级跨度是 30K~9D，比现有 101 系题库（15K~7D）宽得多，
 * 两端各有大量题目：30K~15K 段共 22268 题（36%），7D 以上 1952 题。
 * 直接入库会让难度筛选出现一堆几乎无人可选的极端档位，故统一收口：
 *   30K ~ 15K → 15K   （K 数值越大越弱，>=15 即收口）
 *   7D 以上   → 7D
 * 现有 101 系题库本就落在 15K~7D，故此规则对它们基本是恒等变换。
 */
const RANK_FLOOR_K = 15;
const RANK_CEIL_D = 7;

// ─── goproblems 等级 → 101 系等级 映射表 ────────────────
//
// 背景：两站不是同一把尺子。goproblems 跨度 30K~9D，101 系只到 15K~7D，
// goproblems 的等级整体「虚高」约 2.3 倍（线性拟合 101 ≈ 0.435×gp − 0.056，R²=0.9907）。
//
// 本表取【实测中位数】：对每个 goproblems 等级，找出它与 101 系题目
// 冲突（同一初始局面）时，对方等级的中位数。全量 ~8000 组冲突对统计得出。
//
// ⚠️ 旧做法是「30K~15K 一律 clamp 到 15K」，实测不对：
//    gp 30K 确实对应 101 的 15K（碰巧对），
//    但 gp 15K 实际对应 101 的 7K —— 被硬抬到 15K，虚低了 8 档。
//
// 触底效应已排除：101 系最弱只到 15K，但「剔除 15K 后重算中位数」
// 与原中位数几乎一致（仅 30K 差 1 档），故本表可信。
//
// 键 = goproblems 原始等级（extractDifficulty 的输出形态，如 '30K' / '5D'）
// 值 = 101 系对应等级。无 “+” 后缀（goproblems 难度不带 +）。
const GP_RANK_MAP = {
  '30K': '15K', '29K': '14K', '28K': '13K', '27K': '12K', '26K': '12K',
  '25K': '11K', '24K': '11K', '23K': '10K', '22K': '10K', '21K': '9K',
  '20K': '9K',  '19K': '9K',  '18K': '8K',  '17K': '8K',  '16K': '7K',
  '15K': '7K',  '14K': '7K',  '13K': '6K',  '12K': '6K',  '11K': '5K',
  '10K': '5K',  '9K': '5K',   '8K': '4K',   '7K': '4K',   '6K': '4K',
  '5K': '3K',   '4K': '2K',   '3K': '2K',   '2K': '2K',   '1K': '1K',
  '1D': '1K',   '2D': '1D',   '3D': '1D',   '4D': '1D',   '5D': '2D',
  '6D': '2D',   '7D': '3D',   '8D': '4D',   '9D': '5D',
};

/**
 * goproblems 等级映射到 101 系等级。
 * 保留原有的 “+”（goproblems 实际不带 +，此处仅为稳妥兜底）。
 * 表内没有的等级（理论上不会有）→ 原样返回，由后续 clampRank 收口。
 */
function mapGoproblemsRank(diff) {
  const m = /^(\d+)([KD])(\+?)$/.exec(diff);
  if (!m) return diff;
  const hit = GP_RANK_MAP[`${m[1]}${m[2]}`];
  if (!hit) return diff;
  return `${hit}${m[3]}`;
}

/**
 * 归一化难度：
 *   · goproblems → 先按实测映射表换算到 101 系刻度，再收口到 [15K, 7D]
 *   · 101 系     → 只收口，不换算（本来就是 101 刻度）
 * 保留原有的 “+”（如 15K+ → 15K+，不影响现有数据）。
 */
function normalizeRank(diff, sourceName) {
  const d = sourceName === 'goproblems' ? mapGoproblemsRank(diff) : diff;
  return clampRank(d);
}

/**
 * 裁剪难度到 [15K, 7D] 区间，保留原有的 “+”（如 15K+ → 15K+，不影响现有数据）。
 */
function clampRank(diff) {
  const m = /^(\d+)([KD])(\+?)$/.exec(diff);
  if (!m) return diff;
  const v = parseInt(m[1], 10);
  if (m[2] === 'K') return v >= RANK_FLOOR_K ? `${RANK_FLOOR_K}K${m[3]}` : diff;
  return v >= RANK_CEIL_D ? `${RANK_CEIL_D}D${m[3]}` : diff;
}

/**
 * 难度带问号（悬而未决）→ true。
 * 抓取侧已过滤，这里是兜底：历史落盘的 SGF 可能仍带 “?”（旧 Provider 未写入时抓的）。
 */
function hasUncertainRank(pw, rootComment) {
  return /\d+\s*(kyu|dan)\?/i.test(`${pw || ''} ${rootComment || ''}`);
}

function extractType(pw, rootComment) {
  const s = `${pw || ''} ${rootComment || ''}`;
  if (/死活|life_and_death|elementary/i.test(s)) return '死活题';
  if (/手筋|tesuji/i.test(s)) return '手筋题';
  if (/对杀/.test(s)) return '对杀题';
  if (/官子|endgame/i.test(s)) return '官子题';
  if (/中盘|middlegame/i.test(s)) return '中盘题';
  // joseki → 布局题（用户指定，与 fuseki/opening 同类）。
  // 注意必须排在“定式”之前：goproblems 的 "joseki" 与中文“定式”是同义词，
  // 若沿用旧的 /定式|joseki/ → 定式题，会给布局类再开一个几乎空的新分类
  // （现有库里 定式题 只有 1 条，而 布局题 有 9488 条）。
  if (/布局|fuseki|opening|joseki/i.test(s)) return '布局题';
  if (/棋理/.test(s)) return '棋理题';
  // best move 已在抓取侧排除；此分支仅作兜底
  if (/best[_ ]move/i.test(s)) return '一选题';
  if (/定式/.test(s)) return '定式题';
  return '死活题';
}

/**
 * 判断死活题 C[] 是否为变化备注
 */
function isLifeComment(val) {
  return /^(正解图|失败图|变化图|正解|失败|变化)/.test(val.trim());
}

/**
 * 清理死活题变化备注：去掉用户名后缀
 */
function cleanLifeComment(val) {
  const trimmed = val.trim();
  const m = trimmed.match(/^(正解图|失败图|变化图|正解|失败|变化)\s*[-–]?\s*.*$/);
  if (m) return m[1];
  return trimmed;
}

/**
 * 从 AI 复盘 C[] 提取胜率信息
 */
function extractWinrate(val, perspective, moveColor) {
  if (!moveColor) return null;

  let s = val.replace(/^\/\\"[a-zA-Z]+/, '').trim();

  // 野狐格式: "黑35.7% | -1.5目"
  let m = s.match(/([黑白])(\d+\.?\d*)%\s*(?:\|\s*([+-]?\d+\.?\d*)\s*目)?/);
  if (m) {
    let result = `${m[1]}${m[2]}%`;
    if (m[3]) result += ` | ${m[3]}目`;
    return result;
  }

  // OGS 格式: "胜率: 47.5% | 目差: -0.3"
  m = s.match(/胜率[:\s]*(\d+\.?\d*)%\s*(?:\|\s*目差[:\s]*([+-]?\d+\.?\d*))?/);
  if (m) {
    let wr = parseFloat(m[1]);
    let scoreStr = m[2];
    if (perspective === 'black') {
      const isWhite = moveColor === 'W';
      const color = isWhite ? '白' : '黑';
      const shown = isWhite ? (100 - wr).toFixed(1) : wr.toFixed(1);
      let result = `${color}${shown}%`;
      if (scoreStr) {
        let score = parseFloat(scoreStr);
        if (isWhite) score = -score;
        result += ` | ${score}目`;
      }
      return result;
    }
    const color = moveColor === 'W' ? '白' : '黑';
    let result = `${color}${wr.toFixed(1)}%`;
    if (scoreStr) result += ` | ${scoreStr}目`;
    return result;
  }

  // 兜底：裸百分比
  m = s.match(/(\d+\.?\d*)%/);
  if (m) {
    let wr = parseFloat(m[1]);
    if (perspective === 'black') {
      const isWhite = moveColor === 'W';
      const color = isWhite ? '白' : '黑';
      const shown = isWhite ? (100 - wr).toFixed(1) : wr.toFixed(1);
      return `${color}${shown}%`;
    }
    const color = moveColor === 'W' ? '白' : '黑';
    return `${color}${wr.toFixed(1)}%`;
  }

  return null;
}

// ─── 白名单重建 ─────────────────────────────────────────

/**
 * 预处理：野狐 SGF 用字面量 \r\n 作分隔符，需先去掉
 */
function preprocessSgf(text) {
  return text.split("\\r\\n").join("").split("\\r").join("").split("\\n").join("");
}

/**
 * 白名单重建：解析 SGF → 过滤属性 → 重新序列化
 */
function processSgf(text, category, perspective, sourceName) {
  const src = preprocessSgf(text);
  const result = sgfParser.parse(src);
  if (result.errors.length > 0 && !result.tree) {
    throw new Error(result.errors.join('; '));
  }

  const tree = result.tree;
  const headerWhitelist = category === 'life-and-death' ? LIFE_HEADER_WHITELIST : AI_HEADER_WHITELIST;
  const moveProps = category === 'life-and-death' ? LIFE_MOVE_PROPS : AI_MOVE_PROPS;
  const moveWhitelist = new Set([...moveProps, 'C']);

  // 构建白名单：根节点用 headerWhitelist，非根节点用 moveWhitelist
  // 但根节点可能同时有头属性和着法，需要合并
  const rootWhitelist = new Set([...headerWhitelist, ...moveProps, 'C']);

  let lastColor = null;
  // 命中排除规则时置位，由调用方丢弃整条记录（难度带问号 = 悬而未决）
  let skipReason = null;

  function walk(node, isRoot) {
    const props = node.properties;
    const hasMove = moveProps.has('B') && ('B' in props) || moveProps.has('W') && ('W' in props) ||
                    'B' in props || 'W' in props;

    // 判断当前着法颜色
    const bVal = 'B' in props ? getProp(props, 'B') : null;
    const wVal = 'W' in props ? getProp(props, 'W') : null;
    const moveColor = bVal !== null ? 'B' : (wVal !== null ? 'W' : null);
    if (moveColor) lastColor = moveColor;

    const newProps = {};
    const whitelist = isRoot ? rootWhitelist : moveWhitelist;

    for (const key of Object.keys(props)) {
      if (!whitelist.has(key)) continue;

      if (key === 'C') {
        const val = getProp(props, 'C') || '';
        if (category === 'life-and-death') {
          if (isLifeComment(val)) {
            newProps['C'] = cleanLifeComment(val);
          }
          // 非变化备注的 C 字段直接丢弃
        } else {
          const wr = extractWinrate(val, perspective, moveColor || lastColor);
          if (wr) {
            newProps['C'] = wr;
          }
          // 无法提取胜率的 C 字段直接丢弃
        }
        continue;
      }

      newProps[key] = props[key];
    }

    // 特殊处理根节点
    if (isRoot) {
      // 棋手匿名化
      newProps['PB'] = '黑棋';
      const origPW = getProp(props, 'PW') || '';
      if (category === 'life-and-death') {
        const origC = getProp(props, 'C') || '';
        // 悬而未决（难度带问号）→ 整条跳过不入库。抓取侧已过滤，此处兜底。
        if (hasUncertainRank(origPW, origC)) { skipReason = 'uncertain-rank'; }
        // best move（一选题）→ 不入库（用户指定）。抓取侧已排除，此处兜底。
        if (/best[_ ]move/i.test(`${origPW} ${origC}`)) { skipReason = 'best-move'; }
        const rawDiff = extractDifficulty(origPW, origC);
        // 无难度 → 不入库。现有库 85018 条全部带难度，混入会破坏难度筛选的一致性。
        if (!rawDiff) { skipReason = 'no-rank'; }
        const diff = normalizeRank(rawDiff, sourceName);
        const type = extractType(origPW, origC);
        // PW 存「类型·难度」，供前端按类型/难度筛选；无难度时只存类型
        newProps['PW'] = diff ? `${type}·${diff}` : type;
      } else {
        newProps['PW'] = '白棋';
      }

      if (category === 'ai-review') {
        // 段位清理（野狐 P9段 → 9段）
        const br = getProp(props, 'BR');
        if (br) newProps['BR'] = br.trim().replace(/^P(\d+段)$/, '$1');
        const wr = getProp(props, 'WR');
        if (wr) newProps['WR'] = wr.trim().replace(/^P(\d+段)$/, '$1');

        // 贴目标准化（野狐整数 → 小数）
        const km = getProp(props, 'KM');
        if (km && /^\d+$/.test(km.trim())) {
          const num = parseInt(km.trim());
          if (num >= 100) newProps['KM'] = (num / 100).toString();
        }

        // 规则标准化
        const ru = getProp(props, 'RU');
        if (ru) {
          let rv = ru.trim();
          if (rv === 'JP') rv = 'Japanese';
          else if (rv === 'CN') rv = 'Chinese';
          else if (rv === 'KO') rv = 'Korean';
          newProps['RU'] = rv;
        }

        // 确保 CA[UTF-8]
        newProps['CA'] = 'UTF-8';
      }

      if (category === 'life-and-death') {
        // 确保 CA[UTF-8]
        newProps['CA'] = 'UTF-8';
      }
    }

    node.properties = newProps;

    for (const child of node.children) walk(child, false);
  }

  walk(tree, true);

  // 返回 { sgf: null, skipReason } 表示「按规则排除」（非解析错误），调用方据此分类计数并跳过
  return skipReason ? { sgf: null, skipReason } : { sgf: sgfWriter.writeTree(tree), skipReason: null };
}

// ─── 扫描 / 水位 ─────────────────────────────────────────

function scanSource(inputDir, sourceName, today) {
  const dir = join(inputDir, sourceName);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const dateDir of readdirSync(dir)) {
    const dp = join(dir, dateDir);
    if (!statSync(dp).isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue;
    // 跳过当天：实时追加类来源（如 shizhan101 每 5 分钟更新）当天数据不完整，
    // 次日再纳入，避免打包不完整。其它来源无当天数据，无影响。
    if (today && dateDir === today) continue;
    for (const f of readdirSync(dp)) {
      if (!f.toLowerCase().endsWith('.sgf')) continue;
      out.push({ date: dateDir, seq: basename(f, '.sgf'), path: join(dp, f), filename: f });
    }
  }
  return out.sort((a, b) => (a.date + '/' + a.filename).localeCompare(b.date + '/' + b.filename));
}

// ─── 打包 ────────────────────────────────────────────────

function writeArchive(outputDir, category, date, entries) {
  // 顺序 = 入库顺序（老 → 新）。文件名加零填充序号前缀，使「文件名字典序 == 时间序」。
  //
  // 为什么不能按 id 排序：id 是 md5，字典序与入库时间无关且恒定，
  // 于是运行时 lib://<cat>/<date>/<i> 的下标永远指到同一批老棋谱，
  // 新加入的棋谱散列到中段/尾段，取「前 N 盘」永远取不到它们。
  // 改成序号前缀后下标即时间序，「最近 N 盘」就是末尾 N 个下标。
  const seqWidth = Math.max(4, String(entries.length).length);
  const tmp = join(tmpdir(), `sgflib-${category}-${date}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      writeFileSync(join(tmp, `${String(i).padStart(seqWidth, '0')}_${e.id}.sgf`), e.sgf, 'utf-8');
    }
    const catDir = join(outputDir, category);
    mkdirSync(catDir, { recursive: true });
    const files = readdirSync(tmp).sort();

    // 两个分类都分块：取整包意味着「加载 1 条」也要下载解压全包
    // （题库 3.3MB / 解压 1.8s，棋谱 2.8MB / 解压 824ms）。
    // 块大小按分类取：单条体积差 ~70 倍，一刀切会让棋谱块=整包、题库块过小。
    const size = CHUNK_SIZE[category] ?? 1000;
    // 块内文件顺序 = 全局顺序的一段，故 meta 下标可直接换算到块内偏移
    const chunks = [];
    for (let start = 0; start < files.length; start += size) {
      const partFiles = files.slice(start, start + size);
      const partIndex = Math.floor(start / size);
      const partName = `${date}.p${String(partIndex).padStart(4, '0')}.tar.bz2`;
      const archivePath = join(catDir, partName);
      execFileSync('tar', ['-cjf', archivePath, '-C', tmp, ...partFiles], { stdio: 'pipe' });
      chunks.push({ partIndex, start, count: partFiles.length, size: statSync(archivePath).size });
    }
    const totalSize = chunks.reduce((a, c) => a + c.size, 0);
    const maxSize = chunks.length ? Math.max(...chunks.map(c => c.size)) : 0;
    console.log(`  📦 ${category}/${date} → ${chunks.length} 块 (${entries.length} 盘, ${Math.floor(totalSize / 1024)}KB, 单块最大 ${Math.floor(maxSize / 1024)}KB)`);
    writeMeta(catDir, category, date, entries, chunks, size);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * 抽取 SGF 的题库标签（PW 字段）。
 * 与运行时 BuiltinLibraryProvider.parsePuzzleTags 保持同一规则：取 PW，按「·」拆类型/难度。
 * 这里只需 raw（列表展示与筛选均基于 raw），故直接返回原始串。
 */
function extractPw(sgf) {
  const m = sgf.match(/PW\[([^\]]+)\]/);
  return m ? m[1].trim() : '';
}

/**
 * 写出轻量元数据索引 <category>/<date>.meta.json.gz
 * pw / ids 数组顺序必须与 tar 内 SGF 顺序一致（均为入库顺序，文件名带序号前缀），
 * 否则下标对不上号 → 列表显示错标签/id、筛选错题目。
 *
 * 题库写 pw（标签），棋谱写 ids（md5 文件名）—— 见文件头对两者取舍的说明。
 */
function writeMeta(catDir, category, date, entries, chunks, chunkSize) {
  // entries 已在 writeArchive 中按 id 排序，此处保持同序
  const isPuzzle = category === 'life-and-death';
  const meta = {
    version: '2.2',
    category,
    date,
    count: entries.length,
    // 分块信息：取单条时按 chunkSize 定位所属块，只下载该块
    chunkSize,
    chunks: chunks.map(c => ({ start: c.start, count: c.count, size: c.size })),
    // 两个分类都写 ids[]：稳定 ID，纯内容派生（题库=初始局面棋形哈希，棋谱=contentMd5）。
    // URL 形如 lib://<category>/<ids[i]>，与日期、序号无关 ——
    // 库增量更新后同一条仍是同一个 URL，分享链接永久可打开。
    ids: entries.map(e => e.id),
    // 题库额外写 pw[]（标签），供列表展示与筛选
    ...(isPuzzle ? { pw: entries.map(e => extractPw(e.sgf)) } : {}),
  };
  const buf = gzipSync(Buffer.from(JSON.stringify(meta), 'utf-8'));
  const metaPath = join(catDir, `${date}.meta.json.gz`);
  writeFileSync(metaPath, buf);
  console.log(`  🏷  ${category}/${date}.meta.json.gz  (${entries.length} 条, ${Math.floor(buf.length / 1024)}KB)`);
}

function writeIndex(outputDir) {
  const categories = {};
  for (const cat of CATEGORIES) {
    const dir = join(outputDir, cat);
    // 归档恒为分块 <date>.pNNNN.tar.bz2（题库 43 块 / 棋谱 13 块）。
    // 同一日期的多个分块会匹配出多个同名日期，故用 Set 去重。
    const dateSet = new Set();
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        const m = /^(\d{4}-\d{2}-\d{2})(?:\.p\d{4})?\.tar\.bz2$/.exec(f);
        if (m) dateSet.add(m[1]);
      }
    }
    const dates = [...dateSet].sort((a, b) => b.localeCompare(a));
    categories[cat] = dates;
  }
  const index = { version: '1.0', generatedAt: new Date().toISOString(), categories };
  writeFileSync(join(outputDir, 'index.json.gz'), gzipSync(Buffer.from(JSON.stringify(index), 'utf-8')));
  console.log(`  🗂  index.json.gz (${Object.entries(categories).map(([c, d]) => `${c}:${d.length}`).join(', ')})`);
}

function savePrivateMap(map) {
  mkdirSync(LIB_DIR, { recursive: true });
  writeFileSync(PRIVATE_MAP_PATH, JSON.stringify(map, null, 2) + '\n');
}
function saveDuplicateMap(map) {
  mkdirSync(LIB_DIR, { recursive: true });
  writeFileSync(DUPLICATE_MAP_PATH, JSON.stringify(map, null, 2) + '\n');
}

// ─── 主流程 ──────────────────────────────────────────────

function main() {
  const opts = parseArgs();
  console.log('='.repeat(56));
  console.log('内置棋谱库生成 v1.3（全量重建）');
  console.log(`源目录 : ${opts.input}`);
  console.log(`输出   : ${opts.output}`);
  console.log(`模式   : 全量重建`);
  console.log(`去重   : 死活题=初始局面8方向哈希；ai-review=内容MD5`);
  console.log('='.repeat(56));

  mkdirSync(opts.output, { recursive: true });

  // --dedup-only 是只读体检：清目录前先短路，避免误删已有产物
  if (opts.dedupOnly) {
    console.log('（--dedup-only 只读体检模式，不改动输出目录）');
  } else {
    for (const cat of CATEGORIES) rmSync(join(opts.output, cat), { recursive: true, force: true });
    rmSync(join(opts.output, 'index.json.gz'), { force: true });
  }

  // 全量重建 = 从零开始：清空私密映射与去重清单，
  // 使 private-map 精确覆盖本次发布产物（历史被去重跳过的记录也会重新参与判定）
  let privateMap = {};
  if (!opts.dedupOnly) rmSync(DUPLICATE_MAP_PATH, { force: true });
  let duplicateMap = {};
  // 当天日期（本地时区），用于跳过实时追加类来源的当日数据
  // 注意：不能用 toISOString()（UTC），CST 早上跑会算成前一天，漏跳当日
  const today = localDateString();

  const buckets = { 'life-and-death': {}, 'ai-review': {} };
  // 去重集合：key = "<category>:<contentMd5>"，已入库即跳过（本次运行内生效）
  const dedup = loadDedupSet();
  // 死活题「初始局面」8 方向哈希集合（见 lifePositionHashes 注释）。
  // 与 dedup 并存：life-and-death 走这里，ai-review 仍走 contentMd5。
  const lifePosSeen = new Set();
  const lifeStats = { byPosition: 0, byContent: 0 };
  // 统计
  const stats = {
    scanned: 0, kept: 0,
    dupRaw: 0,            // 原始文件 MD5 重复（同一来源内同一文件重复落盘，仅统计不跳过）
    dupContent: 0,        // 本次运行内重复（白名单重建后内容相同，含跨来源）
    skipped: 0,           // 按规则排除（见 skipReasons）
    skipReasons: {},      // { uncertainRank / bestMove / noRank: 数量 }
    parseFailed: 0,
    perSource: {},
  };
  const rawMd5Seen = new Set();   // 按来源统计原始重复，仅用于体检输出
  const keepDedupOnly = !!opts.dedupOnly;

  for (const [srcName, cfg] of Object.entries(SOURCES)) {
    const files = scanSource(opts.input, srcName, today);
    if (files.length === 0) continue;
    console.log(`\n来源 ${srcName} → ${cfg.category}: ${files.length} 盘`);
    const ss = (stats.perSource[srcName] ||= { scanned: 0, kept: 0, dupRaw: 0, dupContent: 0, skipped: 0, parseFailed: 0 });

    for (const f of files) {
      stats.scanned++; ss.scanned++;
      const raw = readFileSync(f.path, 'utf-8');
      const rawMd5 = md5(raw);
      const rawKey = srcName + ':' + rawMd5;
      if (rawMd5Seen.has(rawKey)) stats.dupRaw++, ss.dupRaw++;
      else rawMd5Seen.add(rawKey);

      let out;
      try {
        out = processSgf(raw, cfg.category, cfg.perspective, srcName);
      } catch (err) {
        stats.parseFailed++; ss.parseFailed++;
        console.error(`  ⚠️  跳过（解析失败）${f.path}: ${err.message}`);
        continue;
      }

      // 按规则排除（难度带问号 / best move / 无难度），与解析失败区分计数
      if (out.sgf === null) {
        stats.skipped++; ss.skipped++;
        stats.skipReasons[out.skipReason] = (stats.skipReasons[out.skipReason] || 0) + 1;
        continue;
      }
      const sgf = out.sgf;

      // 去重（判定依据）：保留首次出现的那条
      //   · life-and-death → 初始局面 8 方向哈希（跨来源同题马甲）
      //   · ai-review      → contentMd5（初始皆空枰，按局面去重会塌成 1 条）
      const contentMd5 = md5(sgf);
      let dedupKey;
      let dedupKind = 'content';
      if (cfg.category === 'life-and-death') {
        const ph = lifePositionHashes(sgf);
        if (ph) {
          dedupKind = 'position';
          dedupKey = cfg.category + ':pos:' + [...ph].sort()[0];
        } else {
          // 空局面（无摆子）无法算局面哈希，退回内容比对
          dedupKind = 'content';
          dedupKey = cfg.category + ':' + contentMd5;
        }
      } else {
        dedupKey = cfg.category + ':' + contentMd5;
      }
      if (dedup.all.has(dedupKey)) {
        stats.dupContent++, ss.dupContent++;
        // 只在【判重命中】时累加，区分「按局面」与「按内容/ai-review」
        if (dedupKind === 'position') lifeStats.byPosition++;
        else lifeStats.byContent++;
        duplicateMap[`${srcName}/${f.date}/${f.filename}`] = {
          path: f.path, source: srcName, date: f.date, filename: f.filename,
          rawMd5, contentMd5, category: cfg.category,
          // 标记判重依据，便于溯源
          dedupKind,
        };
        continue;
      }
      dedup.all.add(dedupKey);

      // 稳定 ID：只由内容派生（题库取棋形哈希，棋谱取 contentMd5）
      // ⚠️ 绝不能掺入 date / seq / filename / 口令：内置库是增量更新的，
      //    那些分量每次生成都会变，掺进去 ID 就跟着变 ——
      //    分享出去的 lib:// URL 过一天失效，做题历史也去重不了。
      const id = cfg.category === 'life-and-death'
        // 题库：初始局面棋形哈希；算不出（空局面/无摆子）时回落 contentMd5
        ? (computeStablePuzzleId(sgf) ?? contentMd5)
        // 棋谱：对局初始皆空枰，算不出棋形 → 用内容 md5（同样是纯内容派生）
        : contentMd5;
      if (!keepDedupOnly) {
        (buckets[cfg.category][f.date] ||= []).push({ id, sgf, date: f.date, contentMd5 });
      }
      stats.kept++; ss.kept++;

      const grab = (p) => { const m = new RegExp(`${p}\\[([^\\]]*)\\]`).exec(raw); return m ? m[1] : ''; };
      privateMap[id] = {
        path: f.path, source: srcName, date: f.date, seq: f.seq, filename: f.filename,
        category: cfg.category, rawMd5, contentMd5,
        origPB: grab('PB'), origPW: grab('PW'), origGN: grab('GN'),
      };
    }
  }

  // 去重体检输出
  console.log('\n' + '-'.repeat(56));
  console.log('去重统计（死活题=初始局面8方向；ai-review=内容MD5）');
  console.log(`  扫描       : ${stats.scanned}`);
  console.log(`  入库       : ${stats.kept}`);
  console.log(`  原始重复   : ${stats.dupRaw}（同来源内同一文件重复落盘）`);
  console.log(`  判重剔除   : ${stats.dupContent}`);
  console.log(`    其中死活题按初始局面 : ${lifeStats.byPosition}（含跨来源同题马甲）`);
  console.log(`    其余(ai-review/空局面): ${lifeStats.byContent}`);
  console.log(`  规则排除   : ${stats.skipped}（${Object.entries(stats.skipReasons).map(([k, v]) => `${k}:${v}`).join(' ') || '无'}）`);
  console.log(`  解析失败   : ${stats.parseFailed}`);
  for (const [src, s] of Object.entries(stats.perSource)) {
    console.log(`    · ${src.padEnd(12)} 扫描 ${String(s.scanned).padStart(6)}  入库 ${String(s.kept).padStart(6)}  内容重复 ${String(s.dupContent).padStart(5)}  原始重复 ${String(s.dupRaw).padStart(5)}`);
  }
  console.log('-'.repeat(56));

  if (keepDedupOnly) {
    saveDuplicateMap(duplicateMap);
    console.log(`\n--dedup-only：未改动输出目录。重复清单: ${DUPLICATE_MAP_PATH}`);
    return;
  }

  console.log('\n打包归档...');
  let total = 0, nLife = 0, nAi = 0;
  for (const cat of CATEGORIES) {
    const dates = Object.keys(buckets[cat]).sort();
    if (dates.length === 0) { console.log(`  ${cat}: 无棋谱`); continue; }
    // 合并该分类所有日期的棋谱到一个归档（按 CHUNK_SIZE 分块），日期标签用最新日期
    const latestDate = dates[dates.length - 1];
    const allEntries = [];
    for (const date of dates) {
      for (const e of buckets[cat][date]) allEntries.push(e);
    }
    writeArchive(opts.output, cat, latestDate, allEntries);
    total += allEntries.length;
    if (cat === 'life-and-death') nLife += allEntries.length; else nAi += allEntries.length;
  }

  console.log('\n写入索引...');
  writeIndex(opts.output);
  savePrivateMap(privateMap);
  saveDuplicateMap(duplicateMap);

  console.log('\n完成：');
  console.log(`  棋谱总数: ${total} 盘`);
  console.log(`  死活题  : ${nLife}`);
  console.log(`  实战AI  : ${nAi}`);
  console.log(`  私密映射: ${PRIVATE_MAP_PATH}`);
}

main();
