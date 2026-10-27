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
 * 唯一 id = HMAC-MD5( 明文记录, 口令 )，不可逆（需口令才能重算）。
 *   明文记录 = <来源码>|<日期>|<序号>|<原始文件名>
 *   口令保存于 ~/.weiqi-sgf-library/.library-key（权限 600），首次输入后免输。
 *
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
 *   --key-path <path> 口令文件（默认 ~/.weiqi-sgf-library/.library-key）
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
const DEFAULT_KEY_PATH = join(LIB_DIR, '.library-key');
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
  const opts = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, keyPath: DEFAULT_KEY_PATH };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input': opts.input = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--key-path': opts.keyPath = args[++i]; break;
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
  --key-path <path> 口令文件（默认 ~/.weiqi-sgf-library/.library-key）
  --dedup-only      只统计重复、不改动输出（去重体检用）
  -h, --help        显示帮助
`);
        process.exit(0);
    }
  }
  return opts;
}

// ─── 口令 ──────────────────────────────────────────────

function loadOrCreateKey(keyPath) {
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath, 'utf-8').trim();
    if (key) { console.log(`🔑 使用已有口令: ${keyPath}`); return key; }
  }
  const envKey = (process.env.LIBRARY_KEY || '').trim();
  if (envKey) {
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, envKey + '\n', { mode: 0o600 });
    console.log(`🔑 已根据 LIBRARY_KEY 写入口令文件: ${keyPath}`);
    return envKey;
  }
  const key = crypto.randomBytes(16).toString('hex');
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key + '\n', { mode: 0o600 });
  console.log(`🔑 生成新的随机口令并写入: ${keyPath}`);
  console.log(`   ${key}`);
  console.log('   （如需自定义，请编辑该文件后重新生成）');
  return key;
}

function computeId(key, sourceCode, date, seq, filename) {
  return crypto.createHmac('md5', key).update(`${sourceCode}|${date}|${seq}|${filename}`).digest('hex');
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
// 口径（2026-10-27 与用户确认）：
//   1) 只看【初始局面的摆子坐标集合】（AB + AW），不区分黑白、不看先行方(PL)。
//      理由：棋形一样只是黑白互换 / 先行方不同的，视为同一题。
//   2) 不管首着。同一局面可能有多种正解，首着不同不代表是不同题。
//   3) 生成 8 个方向（4 旋转 × 2 镜像）的哈希，任一命中即判重复。
//   4) 按 SZ 实际路数分桶；小棋盘（4/5/7 路）同样参与，不特殊对待。
//   5) 空局面（无摆子）无法算局面哈希 → 返回 null，调用方退回 contentMd5。
//
// ⚠️ 仅用于 life-and-death。ai-review 绝不能用：所有对局初始都是空枰，
//    按局面去重会让整包塌成 1 条。

/**
 * 取 SGF 文本里的摆子坐标（AB/AW），返回 [x,y] 数组；剔除 tt（脱先/pass）。
 *
 * 用逐字符扫描而不是正则：SGF 属性值里的 \\ 与 ] 转义在「字符串 → RegExp」
 * 之间极易写错（实测过一次，构造出的正则损坏且 --check 才暴露），
 * 直接按 [xx] 形态取两个字母更稳。
 */
function extractSetupPoints(sgf) {
  const pts = [];
  for (const tag of ['AB', 'AW']) {
    let i = 0;
    // 找到每个 "AB[" / "AW[" 起点，然后连续读取紧邻的 [xx] 坐标
    for (;;) {
      const at = sgf.indexOf(tag + '[', i);
      if (at < 0) break;
      let j = at + tag.length;
      while (j + 2 < sgf.length && sgf[j] === '[' && sgf[j + 3] === ']') {
        const c = sgf.slice(j + 1, j + 3);
        if (c !== 'tt' && /^[a-z]{2}$/.test(c)) {
          pts.push([c.charCodeAt(0) - 97, c.charCodeAt(1) - 97]);
        }
        j += 4;
      }
      i = at + tag.length;
    }
  }
  return pts;
}

/**
 * 计算初始局面的 8 方向哈希集合。
 * @returns {Set<string>} 8 个哈希；无摆子或非整数路数时返回 null
 */
function lifePositionHashes(sgf) {
  const szm = /SZ\[(\d+)(?::(\d+))?\]/.exec(sgf);
  const n = szm ? parseInt(szm[1], 10) : 19;
  if (!Number.isFinite(n) || n <= 0) return null;
  // 非方形棋盘无法做旋转/镜像（当前数据里没有），退回调用方处理
  if (szm && szm[2] && parseInt(szm[2], 10) !== n) return null;

  const all = extractSetupPoints(sgf);
  const pts = all.filter(([x, y]) => x >= 0 && x < n && y >= 0 && y < n);
  if (pts.length === 0) return null;

  const hashes = new Set();
  for (let rot = 0; rot < 4; rot++) {
    for (let flip = 0; flip < 2; flip++) {
      const q = pts.map(([x0, y0]) => {
        let x = x0, y = y0;
        for (let r = 0; r < rot; r++) { const nx = y, ny = n - 1 - x; x = nx; y = ny; }
        if (flip) x = n - 1 - x;
        return [x, y];
      });
      const minX = Math.min(...q.map((p) => p[0]));
      const minY = Math.min(...q.map((p) => p[1]));
      const key = q.map(([x, y]) => `${x - minX},${y - minY}`).sort().join(';');
      hashes.add(md5(`${n}|${key}`));
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
function processSgf(text, category, perspective) {
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
        const diff = clampRank(rawDiff);
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
    version: '2.1',
    category,
    date,
    count: entries.length,
    // 分块信息：取单条时按 chunkSize 定位所属块，只下载该块
    chunkSize,
    chunks: chunks.map(c => ({ start: c.start, count: c.count, size: c.size })),
    // 二选一：题库的标签 / 棋谱的 md5 id（exactOptionalPropertyTypes 下不写空字段）
    ...(isPuzzle
      ? { pw: entries.map(e => extractPw(e.sgf)) }
      : { ids: entries.map(e => e.id) }),
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
  console.log(`口令   : ${opts.keyPath}`);
  console.log(`模式   : 全量重建`);
  console.log(`去重   : 死活题=初始局面8方向哈希；ai-review=内容MD5`);
  console.log('='.repeat(56));

  const key = loadOrCreateKey(opts.keyPath);
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
        out = processSgf(raw, cfg.category, cfg.perspective);
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

      const id = computeId(key, cfg.code, f.date, f.seq, f.filename);
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
