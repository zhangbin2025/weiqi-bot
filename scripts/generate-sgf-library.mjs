#!/usr/bin/env -S npx tsx
/**
 * 内置棋谱库生成脚本 v1.1
 *
 * 从 ~/.weiqi-sgf/ 读取棋谱，按分类打包为仿 KataGo 的 .tar.bz2 归档，
 * 供前端「内置题库 / 内置棋谱」使用。
 *
 * 分类（按源目录）：
 *   life-and-death  题库     : weiqi101 / shizhan101 / qili101
 *   ai-review       实战AI   : foxwq / ogs
 *
 * 唯一 id = HMAC-MD5( 明文记录, 口令 )，不可逆（需口令才能重算）。
 *   明文记录 = <来源码>|<日期>|<序号>|<原始文件名>
 *   口令保存于 ~/.weiqi-sgf-library/.library-key（权限 600），首次输入后免输。
 *
 * 去重（v1.2）：按「分类 + 内容 MD5」去重，重复棋谱只入库首次出现的那条。
 *   rawMd5     = md5(原始文件文本)           —— 同一文件多次落盘
 *   contentMd5 = md5(白名单重建后的 SGF)      —— 同一题换个来源/文件名也算重复
 *   判定以 contentMd5 为准（入库内容相同即重复），rawMd5 仅用于快筛与溯源。
 *   去重集合跨运行持久化：从 private-map.json 回填，故增量模式也能去掉与历史重复的棋谱。
 *   被跳过的重复项记入 ~/.weiqi-sgf-library/duplicate-map.json（本机溯源，不进仓库）。
 *
 * 输出（默认 clients/web/shared/assets/data/games/）：
 *   <category>/<YYYY-MM-DD>.tar.bz2   该日期的棋谱（多源合并，内含 <id>.sgf，按 id 排序）
 *   index.json.gz                     { version, generatedAt, categories: { cat: [dates...] } }
 *
 * 增量：以「已存在归档的最大日期」为水位，重扫 > 水位的源日期（可捕获同日追加），
 *       更早日期不再变动，跨批次去重靠 private-map.json 里持久化的 contentMd5。
 *       --rebuild 全量重建（清空输出与去重集合，重扫所有日期，并重置 private-map）。
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
 *   --rebuild         忽略水位，全量重建
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
};
const CATEGORIES = ['life-and-death', 'ai-review'];

// ─── 参数解析 ────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, keyPath: DEFAULT_KEY_PATH, rebuild: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input': opts.input = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--key-path': opts.keyPath = args[++i]; break;
      case '--rebuild': opts.rebuild = true; break;
      case '--dedup-only': opts.dedupOnly = true; break;
      case '--help':
      case '-h':
        console.log(`
内置棋谱库生成脚本 v1.2

用法: npx tsx scripts/generate-sgf-library.mjs [选项]

选项:
  --input  <path>   源目录（默认 ~/.weiqi-sgf）
  --output <path>   输出目录（默认 clients/web/shared/assets/data/games）
  --key-path <path> 口令文件（默认 ~/.weiqi-sgf-library/.library-key）
  --rebuild         忽略水位，全量重建
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
  console.log('   （如需自定义，请编辑该文件后使用 --rebuild 重新生成）');
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

/** 本地时区的 YYYY-MM-DD（不用 UTC，避免跨日错判） */
function localDateString(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 从 private-map.json 回填「已入库棋谱」的 contentMd5 去重集合。
 * 老版本 private-map 没有 contentMd5 字段时返回空集合（本次运行内仍会去重）。
 * 返回 { all, history }：history 是本次运行前已入库的子集，用于区分「历史重复」与「本次重复」。
 */
function loadDedupSet(privateMap) {
  const all = new Set();
  for (const rec of Object.values(privateMap || {})) {
    if (rec && typeof rec.contentMd5 === 'string' && rec.contentMd5) all.add(rec.category + ':' + rec.contentMd5);
  }
  return { all, history: new Set(all) };
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
    m = s.match(/(\d+\s*[kKdDpP])(?!\s*kyu)(?!\s*死)/);
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
function extractType(pw, rootComment) {
  const s = `${pw || ''} ${rootComment || ''}`;
  if (/死活|life_and_death|elementary/i.test(s)) return '死活题';
  if (/手筋|tesuji/i.test(s)) return '手筋题';
  if (/对杀/.test(s)) return '对杀题';
  if (/官子|endgame/i.test(s)) return '官子题';
  if (/中盘|middlegame/i.test(s)) return '中盘题';
  if (/布局|fuseki|opening/i.test(s)) return '布局题';
  if (/棋理/.test(s)) return '棋理题';
  if (/best_move/i.test(s)) return '一选题';
  if (/定式|joseki/i.test(s)) return '定式题';
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
        const diff = extractDifficulty(origPW, origC);
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

  return sgfWriter.writeTree(tree);
}

// ─── 扫描 / 水位 ─────────────────────────────────────────

function scanSource(inputDir, sourceName, fromDateInclusive, today) {
  const dir = join(inputDir, sourceName);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const dateDir of readdirSync(dir)) {
    const dp = join(dir, dateDir);
    if (!statSync(dp).isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue;
    // 跳过当天：实时追加类来源（如 shizhan101 每 5 分钟更新）当天数据不完整，
    // 次日再纳入，避免同日新增被水位逻辑遗漏或打包冲突。其它来源无当天数据，无影响。
    if (today && dateDir === today) continue;
    if (fromDateInclusive && dateDir <= fromDateInclusive) continue;
    for (const f of readdirSync(dp)) {
      if (!f.toLowerCase().endsWith('.sgf')) continue;
      out.push({ date: dateDir, seq: basename(f, '.sgf'), path: join(dp, f), filename: f });
    }
  }
  return out.sort((a, b) => (a.date + '/' + a.filename).localeCompare(b.date + '/' + b.filename));
}

function maxExistingDate(outputDir, category) {
  const dir = join(outputDir, category);
  if (!existsSync(dir)) return null;
  let max = null;
  for (const f of readdirSync(dir)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.tar\.bz2$/.exec(f);
    if (m && (!max || m[1] > max)) max = m[1];
  }
  return max;
}

// ─── 打包 ────────────────────────────────────────────────

function writeArchive(outputDir, category, date, entries) {
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const tmp = join(tmpdir(), `sgflib-${category}-${date}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    for (const e of entries) writeFileSync(join(tmp, `${e.id}.sgf`), e.sgf, 'utf-8');
    const catDir = join(outputDir, category);
    mkdirSync(catDir, { recursive: true });
    const archivePath = join(catDir, `${date}.tar.bz2`);
    const files = readdirSync(tmp).sort();
    execFileSync('tar', ['-cjf', archivePath, '-C', tmp, ...files], { stdio: 'pipe' });
    const size = statSync(archivePath).size;
    console.log(`  📦 ${category}/${date}.tar.bz2  (${entries.length} 盘, ${Math.floor(size / 1024)}KB)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeIndex(outputDir) {
  const categories = {};
  for (const cat of CATEGORIES) {
    const dir = join(outputDir, cat);
    const dates = [];
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        const m = /^(\d{4}-\d{2}-\d{2})\.tar\.bz2$/.exec(f);
        if (m) dates.push(m[1]);
      }
    }
    dates.sort((a, b) => b.localeCompare(a));
    categories[cat] = dates;
  }
  const index = { version: '1.0', generatedAt: new Date().toISOString(), categories };
  writeFileSync(join(outputDir, 'index.json.gz'), gzipSync(Buffer.from(JSON.stringify(index), 'utf-8')));
  console.log(`  🗂  index.json.gz (${Object.entries(categories).map(([c, d]) => `${c}:${d.length}`).join(', ')})`);
}

function loadPrivateMap() {
  if (existsSync(PRIVATE_MAP_PATH)) {
    try { return JSON.parse(readFileSync(PRIVATE_MAP_PATH, 'utf-8')); } catch { /* ignore */ }
  }
  return {};
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
  console.log('内置棋谱库生成 v1.2');
  console.log(`源目录 : ${opts.input}`);
  console.log(`输出   : ${opts.output}`);
  console.log(`口令   : ${opts.keyPath}`);
  console.log(`重建   : ${opts.rebuild}`);
  console.log(`去重   : MD5（原始 + 白名单重建后内容，按分类）`);
  console.log('='.repeat(56));

  const key = loadOrCreateKey(opts.keyPath);
  mkdirSync(opts.output, { recursive: true });

  // --dedup-only 是只读体检：清目录前先短路，避免误删已有产物
  if (opts.dedupOnly) {
    console.log('（--dedup-only 只读体检模式，不改动输出目录）');
  } else if (opts.rebuild) {
    for (const cat of CATEGORIES) rmSync(join(opts.output, cat), { recursive: true, force: true });
    rmSync(join(opts.output, 'index.json.gz'), { force: true });
  }

  // --rebuild 时重置私密映射与去重集合（全量重建 = 从零开始，包含历史上被去重跳过的记录）
  let privateMap = loadPrivateMap();
  if (opts.rebuild) {
    privateMap = {};
    rmSync(DUPLICATE_MAP_PATH, { force: true });
  }
  let duplicateMap = {};
  const watermark = {};
  for (const cat of CATEGORIES) {
    watermark[cat] = opts.rebuild ? null : maxExistingDate(opts.output, cat);
  }
  // 当天日期（本地时区），用于跳过实时追加类来源的当日数据
  // 注意：不能用 toISOString()（UTC），CST 早上跑会算成前一天，漏跳当日
  const today = localDateString();
  for (const cat of CATEGORIES) {
    console.log(`水位 [${cat}]: ${watermark[cat] ? watermark[cat] + '（不含）' : '(无，全量)'}`);
  }

  const buckets = { 'life-and-death': {}, 'ai-review': {} };
  // 去重集合：key = "<category>:<contentMd5>"，已入库即跳过
  const dedup = loadDedupSet(privateMap);
  console.log(`\n历史去重集合: ${dedup.history.size} 条${opts.rebuild ? '（--rebuild 已重置）' : ''}`);
  // 统计
  const stats = {
    scanned: 0, kept: 0,
    dupRaw: 0,            // 原始文件 MD5 重复（同一来源内同一文件重复落盘，仅统计不跳过）
    dupContent: 0,        // 本次运行内重复（白名单重建后内容相同，含跨来源）
    dupHistory: 0,        // 与本次运行前已入库的棋谱重复（跨批次）
    parseFailed: 0,
    perSource: {},
  };
  const rawMd5Seen = new Set();   // 按来源统计原始重复，仅用于体检输出
  const keepDedupOnly = !!opts.dedupOnly;

  for (const [srcName, cfg] of Object.entries(SOURCES)) {
    const files = scanSource(opts.input, srcName, watermark[cfg.category], today);
    if (files.length === 0) continue;
    console.log(`\n来源 ${srcName} → ${cfg.category}: ${files.length} 盘`);
    const ss = (stats.perSource[srcName] ||= { scanned: 0, kept: 0, dupRaw: 0, dupContent: 0, dupHistory: 0, parseFailed: 0 });

    for (const f of files) {
      stats.scanned++; ss.scanned++;
      const raw = readFileSync(f.path, 'utf-8');
      const rawMd5 = md5(raw);
      const rawKey = srcName + ':' + rawMd5;
      if (rawMd5Seen.has(rawKey)) stats.dupRaw++, ss.dupRaw++;
      else rawMd5Seen.add(rawKey);

      let sgf;
      try {
        sgf = processSgf(raw, cfg.category, cfg.perspective);
      } catch (err) {
        stats.parseFailed++; ss.parseFailed++;
        console.error(`  ⚠️  跳过（解析失败）${f.path}: ${err.message}`);
        continue;
      }

      // 内容级去重（判定依据）：同一分类下入库内容相同即视为重复，保留首次出现的那条
      const contentMd5 = md5(sgf);
      const dedupKey = cfg.category + ':' + contentMd5;
      if (dedup.all.has(dedupKey)) {
        if (dedup.history.has(dedupKey)) stats.dupHistory++, ss.dupHistory++;
        else stats.dupContent++, ss.dupContent++;
        duplicateMap[`${srcName}/${f.date}/${f.filename}`] = {
          path: f.path, source: srcName, date: f.date, filename: f.filename,
          rawMd5, contentMd5, category: cfg.category,
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
  console.log('去重统计（MD5）');
  console.log(`  扫描       : ${stats.scanned}`);
  console.log(`  入库       : ${stats.kept}`);
  console.log(`  原始重复   : ${stats.dupRaw}（同来源内同一文件重复落盘）`);
  console.log(`  本次重复   : ${stats.dupContent}（白名单重建后内容相同，含跨来源）`);
  console.log(`  历史重复   : ${stats.dupHistory}（与本次运行前已入库的棋谱重复）`);
  console.log(`  解析失败   : ${stats.parseFailed}`);
  for (const [src, s] of Object.entries(stats.perSource)) {
    console.log(`    · ${src.padEnd(12)} 扫描 ${String(s.scanned).padStart(6)}  入库 ${String(s.kept).padStart(6)}  内容重复 ${String(s.dupContent + s.dupHistory).padStart(5)}  原始重复 ${String(s.dupRaw).padStart(5)}`);
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
    if (dates.length === 0) { console.log(`  ${cat}: 无新增`); continue; }
    // 增量包：合并本次新增的所有日期棋谱到一个包，日期标签用最新日期
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
  console.log(`  新增棋谱: ${total} 盘`);
  console.log(`  死活题  : ${nLife}`);
  console.log(`  实战AI  : ${nAi}`);
  console.log(`  私密映射: ${PRIVATE_MAP_PATH}`);
}

main();
