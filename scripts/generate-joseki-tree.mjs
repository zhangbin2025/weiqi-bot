#!/usr/bin/env node
/**
 * 定式库 Trie 树数据生成脚本 v2.0
 * 
 * 从 ~/.weiqi-joseki/database.json 读取定式数据，
 * 构建 Trie 树，按前缀裁剪，生成索引和子树文件。
 * 
 * 用法:
 *   node scripts/generate-joseki-tree.mjs [options]
 * 
 * 选项:
 *   --threshold <number>  子树裁剪阈值（默认 1000）
 *   --output <path>       输出目录（默认 clients/web/shared/assets/data/joseki）
 *   --db <path>           数据库路径（默认 ~/.weiqi-joseki/database.json）
 * 
 * 输出文件:
 *   trie-index.json.gz    索引 trie（顶层树，子树替换为引用）
 *   trie-{prefix}.json.gz 前缀子树文件
 *   trie-meta.json        元信息
 *   quiz-easy.json.gz     简单题（≤10手）
 *   quiz-medium.json.gz   中等题（11-20手）
 *   quiz-hard.json.gz     困难题（>20手）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { gunzipSync, gzipSync } from 'zlib';
import { basename, join } from 'path';

// ─── JSON 序列化（与 Python json.dumps 兼容）──────────────────────────
// Python json.dumps 把 0.0 输出为 "0.0"，JS JSON.stringify 输出为 "0"
// 语义等价但字节不同。用正则后处理对齐 Python 输出。
// 只替换 winrate 对象内的整数值（delta/stddev 可能为 0.0）
function jsonSerialize(obj) {
  let s = JSON.stringify(obj);
  // 匹配 winrate 值中的整数字面量（紧跟 : 前有 delta/stddev 键名）
  // 实际简单做法：匹配 "delta":0 或 "stddev":0 这种模式
  s = s.replace(/"(delta|stddev)":0([,}\]])/g, '"$1":0.0$2');
  return s;
}

// ─── 配置 ──────────────────────────────────────────────

const DEFAULT_THRESHOLD = 1000;
const DEFAULT_DB_PATH = join(homedir(), '.weiqi-joseki', 'database.json');
const DEFAULT_OUTPUT_DIR = join(
  process.cwd(),
  'clients/web/shared/assets/data/joseki'
);

// ─── 参数解析 ────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    threshold: DEFAULT_THRESHOLD,
    dbPath: DEFAULT_DB_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--threshold':
        opts.threshold = parseInt(args[++i], 10);
        break;
      case '--output':
        opts.outputDir = args[++i];
        break;
      case '--db':
        opts.dbPath = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
定式库 Trie 树数据生成脚本 v2.0

用法: node scripts/generate-joseki-tree.mjs [选项]

选项:
  --threshold <number>  子树裁剪阈值 (默认 ${DEFAULT_THRESHOLD})
  --output <path>       输出目录
  --db <path>           数据库路径
  -h, --help            显示帮助
`);
        process.exit(0);
    }
  }
  return opts;
}

// ─── 数据库读取 ──────────────────────────────────────────

function loadDatabase(dbPath) {
  console.log(`加载数据库: ${dbPath}`);

  if (!existsSync(dbPath)) {
    console.error(`❌ 数据库不存在: ${dbPath}`);
    return null;
  }

  const raw = readFileSync(dbPath);

  // 尝试 gzip 解压，失败则按普通 JSON 处理
  let text;
  try {
    text = gunzipSync(raw).toString('utf-8');
  } catch {
    text = raw.toString('utf-8');
  }

  const data = JSON.parse(text);
  const josekiList = data.joseki_list || [];
  console.log(`定式数量: ${josekiList.length}`);
  return josekiList;
}

// ─── Trie 构建 ──────────────────────────────────────────

/**
 * 构建 Trie 树
 * 
 * 每条定式的 moves 是坐标字符串数组（如 ["pd","nc","lc",...]）。
 * 在 trie 中，每个节点对应一步棋，颜色由索引奇偶决定。
 * 定式终点节点会挂载 freq / prob / winrate 指标。
 */
function buildTrie(josekiList) {
  const root = { coord: null, children: new Map() };

  for (const j of josekiList) {
    const moves = j.moves;
    if (!moves || moves.length === 0) continue;

    const freq = j.frequency || 0;
    const prob = j.probability || 0;
    const winrate = j.winrate_stats || null;

    let node = root;
    for (let i = 0; i < moves.length; i++) {
      const coord = moves[i];
      if (!node.children.has(coord)) {
        node.children.set(coord, {
          coord,
          color: i % 2 === 0 ? 'black' : 'white',
          children: new Map(),
        });
      }
      node = node.children.get(coord);
    }

    // 定式终点：累加 freq（可能同一路径多条定式）
    node.moves = moves.length;
    node.name = node.name || j.id || '';
    node.freq = (node.freq || 0) + freq;
    node.prob = (node.prob || 0) + prob;
    // winrate 只保留第一个
    if (winrate && !node.winrate) {
      node.winrate = winrate;
    }
  }

  // 后序遍历计算热度
  calcHeat(root);
  return root;
}

/**
 * 后序遍历计算节点热度
 * - 定式节点（有 freq）：heat = freq
 * - 非定式节点：heat = sum(子节点 heat)
 */
function calcHeat(node) {
  let childHeat = 0;
  for (const child of node.children.values()) {
    calcHeat(child);
    childHeat += child.heat || 0;
  }
  node.heat = node.freq ? node.freq : childHeat;
}

// ─── 裁剪 ──────────────────────────────────────────────

/**
 * 统计子树下的定式节点数（含中间定式节点）
 */
function countJosekiNodes(node) {
  let count = node.freq ? 1 : 0;
  if (node.children) {
    for (const child of node.children.values()) {
      count += countJosekiNodes(child);
    }
  }
  return count;
}

/**
 * 后序遍历裁剪 trie，将大子树导出为独立文件
 */
function pruneTrie(node, prefix, threshold, outputDir, stats) {
  const children = node.children;
  if (!children || children.size === 0) return;

  // 先递归处理所有子节点
  for (const [coord, child] of children) {
    if (child.subtree) continue; // 已裁剪
    const newPrefix = prefix ? `${prefix}-${coord}` : coord;
    pruneTrie(child, newPrefix, threshold, outputDir, stats);
  }

  // 检查每个子节点是否需要裁剪
  for (const [coord, child] of children) {
    if (child.subtree) continue; // 已经裁剪过

    const josekiCount = countJosekiNodes(child);
    if (josekiCount >= threshold) {
      const newPrefix = prefix ? `${prefix}-${coord}` : coord;
      const filename = `trie-${newPrefix}.json.gz`;

      exportSubtree(child, filename, threshold, outputDir, stats);

      child.subtree = { file: filename, josekiCount };
      child.children = null; // 清除子节点，保留引用
    }
  }
}

/**
 * 导出子树文件
 */
function exportSubtree(node, filename, threshold, outputDir, stats) {
  // 先对子树自身做裁剪
  pruneTrie(node, '', threshold, outputDir, stats);

  collectDifficulty(node, stats);

  const serialized = serializeTrie(node);
  const json = jsonSerialize(serialized);
  const gzipped = gzipSync(Buffer.from(json, 'utf-8'));

  const filepath = join(outputDir, filename);
  writeFileSync(filepath, gzipped);

  const fileSize = gzipped.length;
  const josekiCount = countJosekiNodes(node);
  stats.subtreeFiles.push({
    prefix: filename.replace('trie-', '').replace('.json.gz', ''),
    size: fileSize,
    count: josekiCount,
  });
  console.log(`  导出: ${filename} (${Math.floor(fileSize / 1024)}KB, ${josekiCount}定式)`);
}

// ─── 难度收集 ──────────────────────────────────────────

function collectDifficulty(node, stats) {
  if (node.freq) {
    const moves = node.moves || 0;
    if (moves <= 10) stats.difficulty.easy++;
    else if (moves <= 20) stats.difficulty.medium++;
    else stats.difficulty.hard++;
  }
  if (node.children) {
    for (const child of node.children.values()) {
      collectDifficulty(child, stats);
    }
  }
}

// ─── 做题数据收集 ────────────────────────────────────────

function collectJosekiNodes(node, path, nodes) {
  if (!nodes) nodes = { easy: [], medium: [], hard: [] };

  if (node.freq) {
    const moves = node.moves || 0;
    let difficulty;
    if (moves <= 10) difficulty = 'easy';
    else if (moves <= 20) difficulty = 'medium';
    else difficulty = 'hard';

    nodes[difficulty].push({
      path,
      moves,
      freq: node.freq || 0,
      prob: node.prob || 0,
      winrate: node.winrate || undefined,
    });
  }

  if (node.children && node.children.size > 0) {
    for (const [coord, child] of node.children) {
      const childPath = path ? `${path}-${coord}` : coord;
      collectJosekiNodes(child, childPath, nodes);
    }
  }

  return nodes;
}

// ─── 序列化 ────────────────────────────────────────────

function serializeTrie(node) {
  const result = {
    coord: node.coord || null,
    heat: node.heat || 0,
  };

  // color: 根节点为 null，其他节点有值
  if (node.coord === null) {
    result.color = null;
  } else if (node.color) {
    result.color = node.color;
  }

  // 定式节点才有 freq / prob
  if (node.freq) {
    result.moves = node.moves;
    result.freq = node.freq;
    result.prob = node.prob;
    if (node.winrate) result.winrate = node.winrate;
  }

  if (node.subtree) {
    result.subtree = node.subtree;
  }

  if (node.children && node.children.size > 0) {
    const sorted = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    result.children = {};
    for (const [coord, child] of sorted) {
      result.children[coord] = serializeTrie(child);
    }
  } else if (node.subtree) {
    result.children = null;
  }

  return result;
}

// ─── 主流程 ────────────────────────────────────────────

function build(outputDir, threshold, dbPath) {
  const stats = {
    subtreeFiles: [],
    difficulty: { easy: 0, medium: 0, hard: 0 },
  };

  // 准备输出目录
  mkdirSync(outputDir, { recursive: true });

  // 清理旧文件
  for (const f of readdirSync(outputDir)) {
    const fp = join(outputDir, f);
    if (f.endsWith('.gz') || f === 'trie-meta.json') {
      rmSync(fp);
    }
  }

  // 加载数据库
  const josekiList = loadDatabase(dbPath);
  if (!josekiList || josekiList.length === 0) {
    console.error('❌ 无定式数据');
    return false;
  }

  // 构建 trie
  console.log('\n构建 trie 树...');
  const trie = buildTrie(josekiList);

  const total = countJosekiNodes(trie);
  console.log(`总定式节点: ${total}`);

  // 收集做题数据（裁剪前，确保遍历所有节点）
  console.log('\n收集做题数据...');
  const quizNodes = collectJosekiNodes(trie, '');
  for (const [diff, items] of Object.entries(quizNodes)) {
    console.log(`  ${diff}: ${items.length}题`);
  }

  // 裁剪
  console.log('\n开始裁剪...');
  pruneTrie(trie, '', threshold, outputDir, stats);

  collectDifficulty(trie, stats);

  // 导出索引
  console.log('\n导出索引...');
  const indexJson = jsonSerialize(serializeTrie(trie));
  const indexGzipped = gzipSync(Buffer.from(indexJson, 'utf-8'));
  const indexFile = join(outputDir, 'trie-index.json.gz');
  writeFileSync(indexFile, indexGzipped);
  const indexSize = indexGzipped.length;
  console.log(`  索引大小: ${Math.floor(indexSize / 1024)}KB`);

  // 导出做题数据
  console.log('\n导出做题数据...');
  for (const [difficulty, items] of Object.entries(quizNodes)) {
    if (items.length === 0) continue;

    // 按频率降序排序
    items.sort((a, b) => b.freq - a.freq);

    const filename = `quiz-${difficulty}.json.gz`;
    const payload = jsonSerialize({ leaves: items, count: items.length });
    const gzipped = gzipSync(Buffer.from(payload, 'utf-8'));
    writeFileSync(join(outputDir, filename), gzipped);
    console.log(`  导出: ${filename} (${Math.floor(gzipped.length / 1024)}KB, ${items.length}题)`);
  }

  // 导出元信息
  const meta = {
    version: '2.0',
    threshold,
    total,
    subtrees: stats.subtreeFiles.length,
    difficulty: stats.difficulty,
    indexSize,
  };
  writeFileSync(
    join(outputDir, 'trie-meta.json'),
    JSON.stringify(meta, null, 2) + '\n'
  );

  // 统计输出
  console.log('\n结果统计:');
  console.log(`  索引: ${Math.floor(indexSize / 1024)}KB`);
  console.log(`  子树: ${stats.subtreeFiles.length}个`);

  if (stats.subtreeFiles.length > 0) {
    const sizes = stats.subtreeFiles.map((s) => s.size);
    console.log(`  子树大小: ${Math.floor(Math.min(...sizes) / 1024)}KB - ${Math.floor(Math.max(...sizes) / 1024)}KB`);
    const totalBytes = indexSize + sizes.reduce((a, b) => a + b, 0);
    console.log(`  总存储: ${Math.floor(totalBytes / 1024 / 1024)}MB`);
  }

  console.log(
    `  难度: 初${stats.difficulty.easy} 中${stats.difficulty.medium} 高${stats.difficulty.hard}`
  );

  return true;
}

// ─── 入口 ──────────────────────────────────────────────

const opts = parseArgs();

console.log('='.repeat(50));
console.log('定式 Trie 树数据生成 v2.0 (Node.js)');
console.log(`阈值: ${opts.threshold}`);
console.log(`数据库: ${opts.dbPath}`);
console.log(`输出: ${opts.outputDir}`);
console.log('='.repeat(50));

const ok = build(opts.outputDir, opts.threshold, opts.dbPath);
process.exit(ok ? 0 : 1);
