#!/usr/bin/env node
/**
 * 内置棋谱库生成脚本 v1.1
 *
 * 从 ~/.weiqi-sgf/ 读取棋谱，按分类打包为仿 KataGo 的 .tar.bz2 归档，
 * 供前端「内置题库 / 内置棋谱」使用。
 *
 * 分类（按源目录）：
 *   life-and-death  死活题   : weiqi101 / ogs-puzzle / goproblems
 *   ai-review       实战AI   : foxwq / ogs
 *
 * 唯一 id = HMAC-MD5( 明文记录, 口令 )，不可逆（需口令才能重算）。
 *   明文记录 = <来源码>|<日期>|<序号>|<原始文件名>
 *   口令保存于 ~/.weiqi-sgf-library/.library-key（权限 600），首次输入后免输。
 *
 * 输出（默认 clients/web/shared/assets/data/games/）：
 *   <category>/<YYYY-MM-DD>.tar.bz2   该日期的棋谱（多源合并，内含 <id>.sgf，按 id 排序）
 *   index.json.gz                     { version, generatedAt, categories: { cat: [dates...] } }
 *
 * 增量：以「已存在归档的最大日期」为水位，重扫 >= 水位的源日期（可捕获同日追加），
 *       更早日期不再变动。--rebuild 全量重建。
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

// ─── 配置 ──────────────────────────────────────────────

const LIB_DIR = join(homedir(), '.weiqi-sgf-library');
const DEFAULT_INPUT = join(homedir(), '.weiqi-sgf');
const DEFAULT_OUTPUT = join(process.cwd(), 'clients/web/shared/assets/data/games');
const DEFAULT_KEY_PATH = join(LIB_DIR, '.library-key');
const PRIVATE_MAP_PATH = join(LIB_DIR, 'private-map.json');

/** 源目录 → { code(来源码, 仅内部/id 用), category, perspective(胜率视角) } */
const SOURCES = {
  foxwq:        { code: 'FWQ', category: 'ai-review', perspective: 'mover' },
  ogs:          { code: 'OGS', category: 'ai-review', perspective: 'black' },
  weiqi101:     { code: 'W101', category: 'life-and-death', perspective: null },
  'ogs-puzzle': { code: 'OGP', category: 'life-and-death', perspective: null },
  goproblems:   { code: 'GPR', category: 'life-and-death', perspective: null },
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
      case '--help':
      case '-h':
        console.log(`
内置棋谱库生成脚本 v1.1

用法: node scripts/generate-sgf-library.mjs [选项]

选项:
  --input  <path>   源目录（默认 ~/.weiqi-sgf）
  --output <path>   输出目录（默认 clients/web/shared/assets/data/games）
  --key-path <path> 口令文件（默认 ~/.weiqi-sgf-library/.library-key）
  --rebuild         忽略水位，全量重建
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

// ─── SGF 解析 / 序列化 ───────────────────────────────────

/**
 * 解析 SGF 文本为树。
 * 节点：{ props: [ [ident, [values...]] ... ], children: [node...] }
 * 值保留原始转义（如 \" ）。
 */
function parseSgf(text) {
  let i = 0;
  const n = text.length;

  const skipWs = () => { while (i < n && /\s/.test(text[i])) i++; };

  function parseNode() {
    // 前提 text[i] === ';'
    i++;
    const props = [];
    while (i < n) {
      const c = text[i];
      if (c === '(' || c === ')' || c === ';') break;
      if (/\s/.test(c)) { i++; continue; }
      if (!/[A-Za-z]/.test(c)) { i++; continue; } // 容错跳过
      let ident = '';
      while (i < n && /[A-Za-z]/.test(text[i])) { ident += text[i]; i++; }
      const values = [];
      while (i < n) {
        while (i < n && /\s/.test(text[i])) i++;
        if (text[i] !== '[') break;
        i++; // '['
        let val = '';
        while (i < n) {
          const c2 = text[i];
          if (c2 === '\\') { val += '\\' + (text[i + 1] ?? ''); i += 2; continue; }
          if (c2 === ']') { i++; break; }
          val += c2; i++;
        }
        values.push(val);
      }
      props.push([ident, values]);
    }
    return { props, children: [] };
  }

  function parseGameTree() {
    skipWs();
    if (text[i] !== '(') throw new Error(`SGF \u89E3\u6790\u9519\u8BEF: \u671F\u5F85 '(' @${i}`);
    i++;
    skipWs();
    const chain = [];
    // \u5BB9\u9519\uFF1A\u90E8\u5206\u975E\u6807\u51C6 SGF\uFF08\u5982 weiqi101\uFF09\u5728 (; \u4E4B\u524D\u76F4\u63A5\u653E\u5C5E\u6027
    // \u5982\u679C\u9047\u5230\u975E ';' \u7684\u5C5E\u6027\u5B57\u7B26\uFF0C\u521B\u5EFA\u4E00\u4E2A\u865A\u62DF\u7A7A\u8282\u70B9\u6536\u96C6\u8FD9\u4E9B\u5C5E\u6027
    if (i < n && text[i] !== ';' && text[i] !== ')' && /[A-Za-z]/.test(text[i])) {
      const emptyNode = { props: [], children: [] };
      while (i < n && text[i] !== ';' && text[i] !== '(' && text[i] !== ')') {
        if (/\s/.test(text[i])) { i++; continue; }
        if (!/[A-Za-z]/.test(text[i])) { i++; continue; }
        let ident = '';
        while (i < n && /[A-Za-z]/.test(text[i])) { ident += text[i]; i++; }
        const values = [];
        while (i < n) {
          while (i < n && /\s/.test(text[i])) i++;
          if (text[i] !== '[') break;
          i++;
          let val = '';
          while (i < n) {
            const c2 = text[i];
            if (c2 === '\\') { val += '\\' + (text[i + 1] ?? ''); i += 2; continue; }
            if (c2 === ']') { i++; break; }
            val += c2; i++;
          }
          values.push(val);
        }
        emptyNode.props.push([ident, values]);
      }
      if (emptyNode.props.length > 0) chain.push(emptyNode);
    }
    while (i < n && text[i] === ';') { chain.push(parseNode()); skipWs(); }
    if (chain.length === 0) {
      chain.push({ props: [], children: [] });
    }
    for (let k = 0; k < chain.length - 1; k++) chain[k].children.push(chain[k + 1]);
    const last = chain[chain.length - 1];
    while (i < n && text[i] === '(') { last.children.push(parseGameTree()); skipWs(); }
    if (text[i] === ')') i++; else throw new Error(`SGF \u89E3\u6790\u9519\u8BEF: \u671F\u5F85 ')' @${i}`);
    return chain[0];
  }

  skipWs();
  const roots = [];
  while (i < n) {
    if (text[i] === '(') roots.push(parseGameTree());
    skipWs();
    if (i < n && text[i] !== '(') break;
    skipWs();
  }
  return roots;
}

function serializeNode(node) {
  let s = ';';
  for (const [ident, values] of node.props) {
    s += ident;
    for (const v of values) s += '[' + v + ']';
  }
  if (node.children.length === 0) return s;
  if (node.children.length === 1) return s + serializeNode(node.children[0]);
  return s + node.children.map((c) => '(' + serializeNode(c) + ')').join('');
}

function serializeSgf(roots) {
  return roots.map((r) => '(' + serializeNode(r) + ')').join('\n');
}

// ─── 属性辅助 ───────────────────────────────────────────

function getProp(node, ident) {
  for (const [id, values] of node.props) if (id === ident) return values[0] ?? '';
  return null;
}
function setProp(node, ident, value) {
  for (const p of node.props) if (p[0] === ident) { p[1] = [value]; return; }
  node.props.push([ident, [value]]);
}
function removeProp(node, ident) {
  node.props = node.props.filter(([id]) => id !== ident);
}

// ─── 白名单重建 ─────────────────────────────────────────

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

/**
 * 从死活题 PW 字段提取难度信息
 * 支持格式：
 *   - "OGS life_and_death 18k" → "18k"
 *   - "GoProblems 25 kyu" → "25k"
 *   - "13K 死活题" → "13K 死活题"
 *   - "" → ""
 */
function extractDifficulty(val) {
  // OGS: "OGS life_and_death 18k"
  let m = val.match(/(\d+\s*[kKdDpP])\s*kyu?/i);
  if (m) return m[1].replace(/\s/g, '');
  // 101: "13K 死活题" → 保留 "13K 死活题"
  m = val.match(/(\d+\s*[kKdD])\s*死活题/i);
  if (m) return m[0];
  // GoProblems: "GoProblems 25 kyu"
  m = val.match(/(\d+)\s*kyu/i);
  if (m) return m[1] + 'k';
  // 纯难度
  m = val.match(/^(\d+\s*[kKdDpP])$/);
  if (m) return m[1].replace(/\s/g, '');
  return '';
}

/**
 * 判断死活题 C[] 是否为变化备注（正解图/失败图/变化图/正解/失败/变化）
 */
function isLifeComment(val) {
  const trimmed = val.trim();
  return /^(正解图|失败图|变化图|正解|失败|变化)/.test(trimmed);
}

/**
 * 清理死活题变化备注：去掉用户名后缀
 * "正解图 - kenny" → "正解图"
 * "失败图 - admin" → "失败图"
 * "变化图 - 我想要" → "变化图"
 */
function cleanLifeComment(val) {
  const trimmed = val.trim();
  // 匹配 "正解图/失败图/变化图/正解/失败/变化" 后可选的 " - 用户名"
  const m = trimmed.match(/^(正解图|失败图|变化图|正解|失败|变化)\s*[-–]?\s*.*$/);
  if (m) return m[1];
  return trimmed;
}

/**
 * 从 AI 复盘 C[] 提取胜率信息
 * 支持格式：
 *   - 野狐: "黑35.7% | -1.5目" 或 "黑99.7%"
 *   - 野狐带引擎前缀: "/\"jueyi白99.8%" → "白99.8%"
 *   - OGS: "胜率: 47.5% | 目差: -0.3 | 第1手" → "黑47.5% | -0.3"
 *   - OGS: "胜率: 100.0%" → "黑100.0%"
 * perspective: 'mover' (野狐, 已是走子方视角) | 'black' (OGS, 黑方视角)
 * moveColor: 'B' | 'W' | null (当前着法颜色)
 */
function extractWinrate(val, perspective, moveColor) {
  if (!moveColor) return null;

  // 去掉引擎前缀如 /"jueyi
  let s = val.replace(/^\/\\"[a-zA-Z]+/, '').trim();

  // 野狐格式: "黑35.7% | -1.5目" 或 "白99.8%"
  let m = s.match(/([黑白])(\d+\.?\d*)%\s*(?:\|\s*([+-]?\d+\.?\d*)\s*目)?/);
  if (m) {
    let result = `${m[1]}${m[2]}%`;
    if (m[3]) result += ` | ${m[3]}目`;
    return result;
  }

  // OGS 格式: "胜率: 47.5% | 目差: -0.3 | 第1手"
  m = s.match(/胜率[:\s]*(\d+\.?\d*)%\s*(?:\|\s*目差[:\s]*([+-]?\d+\.?\d*))?/);
  if (m) {
    let wr = parseFloat(m[1]);
    let scoreStr = m[2];
    if (perspective === 'black') {
      // OGS 是黑方视角，白棋走子时翻转
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
    // mover 视角
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

/**
 * 白名单重建：解析 SGF → 过滤属性 → 重新序列化
 */
function processSgf(text, category, perspective) {
  // 988459047406FF1A91ce72d0 SGF 75285b57976291cf \r\n 4f5c520696947b26Ff0c9700514853bb6389
  let src = text.split("\\r\\n").join("");
  // 540c65f66e0574065b57976291cf \r 548c \n 535572ec51fa73b0768460c551b5
  src = src.split("\\r").join("").split("\\n").join("");
  const roots = parseSgf(src);
  const headerWhitelist = category === 'life-and-death' ? LIFE_HEADER_WHITELIST : AI_HEADER_WHITELIST;
  const moveProps = category === 'life-and-death' ? LIFE_MOVE_PROPS : AI_MOVE_PROPS;

  let lastColor = null; // 'B' | 'W'

  function walk(node) {
    const filteredProps = [];
    const isRoot = node === roots[0];

    // 判断当前节点着法颜色
    const bVal = getProp(node, 'B');
    const wVal = getProp(node, 'W');
    const moveColor = bVal !== null ? 'B' : (wVal !== null ? 'W' : null);
    if (moveColor) lastColor = moveColor;

    // 是否有着法属性
    const hasMove = node.props.some(([id]) => moveProps.has(id));

    for (const [ident, values] of node.props) {
      // 根节点：只允许头属性白名单中的
      if (isRoot && !hasMove) {
        if (headerWhitelist.has(ident)) {
          filteredProps.push([ident, values]);
        }
        continue;
      }

      // 非根节点：只允许着法属性 + C
      if (moveProps.has(ident)) {
        filteredProps.push([ident, values]);
      } else if (ident === 'C') {
        const val = values[0] || '';
        if (category === 'life-and-death') {
          // 死活题：只保留变化备注（正解图/失败图/变化图/正解/失败/变化），去掉用户名
          if (isLifeComment(val)) {
            filteredProps.push([ident, [cleanLifeComment(val)]]);
          }
        } else {
          // AI 复盘：只保留胜率信息
          const wr = extractWinrate(val, perspective, moveColor || lastColor);
          if (wr) {
            filteredProps.push([ident, [wr]]);
          }
        }
      }
    }

    // 特殊处理根节点
    if (isRoot) {
      // 棋手匿名化
      setInProps(filteredProps, 'PB', '黑棋');
      setInProps(filteredProps, 'PW', category === 'life-and-death' ? extractDifficulty(getProp(node, 'PW') || '') || '白棋' : '白棋');

      // 段位清理（野狐 P9段 → 9段）
      if (category === 'ai-review') {
        const br = getProp(node, 'BR');
        if (br) {
          const dv = br.trim().replace(/^P(\d+段)$/, '$1');
          setInProps(filteredProps, 'BR', dv);
        }
        const wr = getProp(node, 'WR');
        if (wr) {
          const dv = wr.trim().replace(/^P(\d+段)$/, '$1');
          setInProps(filteredProps, 'WR', dv);
        }
      }

      // 贴目标准化（野狐整数 → 小数）
      const km = getInProps(filteredProps, 'KM');
      if (km && /^\d+$/.test(km.trim())) {
        const num = parseInt(km.trim());
        if (num >= 100) setInProps(filteredProps, 'KM', (num / 100).toString());
      }

      // 规则标准化
      const ru = getInProps(filteredProps, 'RU');
      if (ru) {
        let rv = ru.trim();
        if (rv === 'JP') rv = 'Japanese';
        else if (rv === 'CN') rv = 'Chinese';
        else if (rv === 'KO') rv = 'Korean';
        setInProps(filteredProps, 'RU', rv);
      }

      // 确保 CA[UTF-8] 在 GM 前
      ensureCA(filteredProps);
    }

    node.props = filteredProps;

    for (const child of node.children) walk(child);
  }

  for (const root of roots) walk(root);

  return serializeSgf(roots);
}

// 辅助：在 props 数组中设置属性
function setInProps(props, ident, value) {
  for (const p of props) {
    if (p[0] === ident) { p[1] = [value]; return; }
  }
  props.push([ident, [value]]);
}

// 辅助：从 props 数组中获取属性值
function getInProps(props, ident) {
  for (const [id, values] of props) if (id === ident) return values[0] || '';
  return null;
}

// 辅助：确保 CA[UTF-8] 存在且在 GM 前
function ensureCA(props) {
  const caIdx = props.findIndex(([id]) => id === 'CA');
  if (caIdx >= 0) props.splice(caIdx, 1);
  const gmIdx = props.findIndex(([id]) => id === 'GM');
  if (gmIdx >= 0) {
    props.splice(gmIdx, 0, ['CA', ['UTF-8']]);
  } else {
    props.unshift(['CA', ['UTF-8']]);
  }
}

// ─── 扫描 / 水位 ─────────────────────────────────────────

function scanSource(inputDir, sourceName, fromDateInclusive) {
  const dir = join(inputDir, sourceName);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const dateDir of readdirSync(dir)) {
    const dp = join(dir, dateDir);
    if (!statSync(dp).isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue;
    if (fromDateInclusive && dateDir < fromDateInclusive) continue;
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

// ─── 主流程 ──────────────────────────────────────────────

function main() {
  const opts = parseArgs();
  console.log('='.repeat(56));
  console.log('内置棋谱库生成 v1.1');
  console.log(`源目录 : ${opts.input}`);
  console.log(`输出   : ${opts.output}`);
  console.log(`口令   : ${opts.keyPath}`);
  console.log(`重建   : ${opts.rebuild}`);
  console.log('='.repeat(56));

  const key = loadOrCreateKey(opts.keyPath);
  mkdirSync(opts.output, { recursive: true });

  if (opts.rebuild) {
    for (const cat of CATEGORIES) rmSync(join(opts.output, cat), { recursive: true, force: true });
    rmSync(join(opts.output, 'index.json.gz'), { force: true });
  }

  const privateMap = loadPrivateMap();
  const watermark = {};
  for (const cat of CATEGORIES) {
    watermark[cat] = opts.rebuild ? null : maxExistingDate(opts.output, cat);
    console.log(`水位 [${cat}]: ${watermark[cat] || '(无，全量)'}`);
  }

  const buckets = { 'life-and-death': {}, 'ai-review': {} };

  for (const [srcName, cfg] of Object.entries(SOURCES)) {
    const files = scanSource(opts.input, srcName, watermark[cfg.category]);
    if (files.length === 0) continue;
    console.log(`\n来源 ${srcName} → ${cfg.category}: ${files.length} 盘`);

    for (const f of files) {
      const id = computeId(key, cfg.code, f.date, f.seq, f.filename);
      const raw = readFileSync(f.path, 'utf-8');
      let sgf;
      try {
        sgf = processSgf(raw, cfg.category, cfg.perspective);
      } catch (err) {
        console.error(`  ⚠️  跳过（解析失败）${f.path}: ${err.message}`);
        continue;
      }
      (buckets[cfg.category][f.date] ||= []).push({ id, sgf, date: f.date });

      const grab = (p) => { const m = new RegExp(`${p}\\[([^\\]]*)\\]`).exec(raw); return m ? m[1] : ''; };
      privateMap[id] = {
        path: f.path, source: srcName, date: f.date, seq: f.seq, filename: f.filename,
        origPB: grab('PB'), origPW: grab('PW'), origGN: grab('GN'),
      };
    }
  }

  console.log('\n打包归档...');
  let total = 0, nLife = 0, nAi = 0;
  for (const cat of CATEGORIES) {
    const dates = Object.keys(buckets[cat]).sort();
    if (dates.length === 0) { console.log(`  ${cat}: 无新增`); continue; }
    for (const date of dates) {
      const entries = buckets[cat][date];
      writeArchive(opts.output, cat, date, entries);
      total += entries.length;
      if (cat === 'life-and-death') nLife += entries.length; else nAi += entries.length;
    }
  }

  console.log('\n写入索引...');
  writeIndex(opts.output);
  savePrivateMap(privateMap);

  console.log('\n完成：');
  console.log(`  新增棋谱: ${total} 盘`);
  console.log(`  死活题  : ${nLife}`);
  console.log(`  实战AI  : ${nAi}`);
  console.log(`  私密映射: ${PRIVATE_MAP_PATH}`);
}

main();
