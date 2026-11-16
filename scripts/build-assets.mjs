#!/usr/bin/env node
/**
 * 统一资源拷贝配置
 * 用法: node scripts/build-assets.mjs
 * 
 * 在 vite build 之后执行，拷贝所有需要的资源到 dist-web/
 * 并生成 web-resources.zip 供客户端预下载使用
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = resolve(process.cwd());

/**
 * 资源拷贝配置
 * 描述所有需要在构建后拷贝的资源
 */
const RESOURCES = [
  {
    name: 'shared',
    from: 'clients/web/shared',
    to: 'dist-web/shared',
    description: '共享组件、样式和依赖',
    enabled: true,
  },
  {
    name: 'tfjs-wasm',
    from: 'clients/web/public/tfjs',
    to: 'dist-web/tfjs',
    description: 'TensorFlow.js WASM 后端文件',
    enabled: true,
  },
  {
    name: 'models',
    from: 'clients/web/public/models',
    to: 'dist-web/models',
    description: '模型文件',
    enabled: true,
  },
  {
    name: 'board-images',
    from: 'clients/web/public/images',
    to: 'dist-web/images',
    description: '棋盘图片资源（背景、线条、棋子）',
    enabled: true,
  },
  {
    name: 'katago-config',
    from: 'clients/web/public/katago',
    to: 'dist-web/katago',
    description: 'KataGo 配置文件（analysis.cfg）',
    enabled: true,
  },
];

/**
 * 预下载排除项
 * 这些资源不纳入 web-resources.zip，客户端已有特殊处理逻辑
 */
// photo：cnn.onnx 约 0.5MB，只有用户点了「拍照摆子」才需要。
// vendor：ORT 1.19.2 运行时三件套约 11MB，仅拍照识别用（253f2c8 起排除）。
// 定式库 / 题库 / AI 复盘棋谱：整包约 20MB，本就是分块按需加载
//   （见 generate-sgf-library.mjs、BuiltinLibraryArchiveProvider），
//   塞进预加载 zip 等于把「按需」变成「全部预下载」。
//
// ⚠️ 这里只是「不预加载」，dist-web/ 里的文件本身保留：deploy-cloudflare.mjs 会把
// 整个 dist-web 部署到 Worker；本地 FileServer / desktop AssetServer 缓存未命中时
// 按相对路径回源 remoteBase，首次用到才下载，即「按需下载」。
const PRELOAD_EXCLUDE_DIRS = [
  'models', 'tfjs', 'photo', 'vendor',
  // 定式库：trie-*.json.gz + quiz-*.json.gz，约 5MB
  'shared/assets/data/joseki',
  // 题库：死活题 life-and-death 分块 + meta，约 8.7MB
  'shared/assets/data/games/life-and-death',
  // AI 复盘棋谱：index/meta + 29 个 .tar.bz2 分块，约 5.5MB（zip 内 5.46MB）。
  // 与 life-and-death 同一套分块加载器，只先取 index.json.gz 与 <date>.meta.json.gz，
  // 用户翻到哪一页才拉对应块；全量预下载等于废掉分块设计。
  'shared/assets/data/games/ai-review',
  // 月度榜单：3 份 .json.gz，约 0.6MB。YichafenClient.loadPlayers() 用到才 fetch，
  // 且自身带 CACHE_TTL 内存缓存，没有预下载的理由。
  'shared/assets/data/rankings',
  // 插件沙箱 QuickJS wasm：仅执行用户插件脚本时才由
  // PluginSystem.defaultWasmBinary() fetch，属边缘功能。
  'plugin',
];

/**
 * 按路径模式排除（相对 dist-web/）。
 * Vite 把 quickjs-emscripten 4 个 variant 的 wasm 都当 asset 输出到
 * assets/emscripten-module-<hash>.wasm，但本项目只用 release-sync
 * （infrastructure/plugin-vm/QuickJsExecutor.ts）；且 wasm 字节是主线程
 * fetch /plugin/quickjs-release-sync.wasm 后 postMessage 注入 Worker 的，
 * 不走 Worker 内的 new URL(...) 回退路径。4 份里 3 份无人引用，另 1 份与
 * plugin/ 下那份字节完全相同。hash 每次构建都变，故用模式而非硬编码文件名。
 * 文件仍留在 dist-web/，真走到回退路径时客户端照样能按需回源下载。
 */
const PRELOAD_EXCLUDE_PATTERNS = [
  /^assets\/emscripten-module-[A-Za-z0-9_-]+\.wasm$/,
];
const PRELOAD_EXCLUDE_FILES = ['web-resources.zip'];

/**
 * 执行资源拷贝
 */
function copyResources() {
  console.log('\n📦 开始拷贝资源...\n');

  for (const resource of RESOURCES) {
    if (!resource.enabled) {
      console.log(`⏭️  [${resource.name}] 已禁用，跳过`);
      continue;
    }

    const srcPath = resolve(ROOT, resource.from);
    const destPath = resolve(ROOT, resource.to);

    if (!existsSync(srcPath)) {
      console.warn(`⚠️  [${resource.name}] 源目录不存在: ${resource.from}`);
      continue;
    }

    // 确保目标目录存在
    mkdirSync(dirname(destPath), { recursive: true });

    // 如果目标已存在，先删除（避免残留）
    if (existsSync(destPath)) {
      rmSync(destPath, { recursive: true });
    }

    // 执行拷贝
    cpSync(srcPath, destPath, { recursive: true });
    console.log(`✅ [${resource.name}] ${resource.description}`);
    console.log(`   ${resource.from} → ${resource.to}`);
  }

  console.log('\n✅ 资源拷贝完成\n');
}

/**
 * 生成 version.json
 */
function generateVersionJson() {
  console.log('\n📝 生成 version.json...\n');

  const versionJsonPath = resolve(ROOT, 'dist-web/version.json');

  // 获取当前时间
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  
  // 版本号格式: YYYYMMDDHHMM (精确到分钟)
  const version = `${year}${month}${day}${hour}${minute}`;

  const versionData = {
    version,
  };

  writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2) + '\n');
  console.log(`✅ version.json 已生成`);
  console.log(`   版本: ${version}`);

  return version;
}

/**
 * 给 HTML 中的 JS/CSS 引用添加 cache-busting query string
 * 解决 vite hash 不变但内容变了的问题
 */
function addCacheBusting(version) {
  console.log('\n🔄 添加 cache-busting...\n');
  
  const distDir = resolve(ROOT, 'dist-web');
  
  // 递归查找所有 HTML 文件
  function findHtmlFiles(dir, baseDir = dir) {
    const files = [];
    if (!existsSync(dir)) return files;
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relPath = relative(baseDir, fullPath);
      if (statSync(fullPath).isDirectory()) {
        files.push(...findHtmlFiles(fullPath, baseDir));
      } else if (entry.endsWith('.html')) {
        files.push(fullPath);
      }
    }
    return files;
  }
  
  const htmlFiles = findHtmlFiles(distDir);
  let count = 0;
  
  for (const htmlFile of htmlFiles) {
    let content = readFileSync(htmlFile, 'utf-8');
    let modified = false;
    
    // 给 script src 加 ?v=version（已有 ? 的不加）
    content = content.replace(/src="([^"]+\.js)(\?[^"]*)?"/g, (match, jsPath, existingQuery) => {
      if (jsPath.startsWith('http') || jsPath.startsWith('//')) return match; // 跳过外部 URL
      modified = true;
      count++;
      return `src="${jsPath}?v=${version}"`;
    });
    
    // 给 link href 加 ?v=version
    content = content.replace(/href="([^"]+\.css)(\?[^"]*)?"/g, (match, cssPath, existingQuery) => {
      if (cssPath.startsWith('http') || cssPath.startsWith('//')) return match;
      modified = true;
      return `href="${cssPath}?v=${version}"`;
    });
    
    if (modified) {
      writeFileSync(htmlFile, content);
    }
  }
  
  console.log(`✅ Cache-busting 已添加`);
  console.log(`   版本: ${version}`);
  console.log(`   修改文件: ${htmlFiles.length} 个 HTML`);
  console.log(`   修改引用: ${count} 处`);
}

/**
 * 递归列出目录下所有文件的相对路径
 */
function listFilesRecursively(dir, baseDir = dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  
  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listFilesRecursively(fullPath, baseDir));
    } else {
      files.push({ path: relative(baseDir, fullPath).replace(/\\/g, '/'), size: stat.size });
    }
  }
  return files;
}

/**
 * 生成「内置库全量下载清单」（2026-11-17）
 *
 * 这些库仍是【运行时按需下载】——不进 web-resources.zip（见 PRELOAD_EXCLUDE_DIRS）。
 * 但触发一次不再只拉命中的那一个文件，而是按本清单把整个库【串行】拉全：
 * 多个业务并发首次用到同一库时，各自发起一轮单文件下载、写同名 <dest>.tmp
 * 再 rename，会互相覆盖字节流 / 抢同一目标。全量 + 串行 + 库级锁解决该冲突。
 *
 * 三个库彼此独立触发（棋谱库 ≠ 题库 ≠ 定式 trie 树），不混在一起：
 *   - games/ai-review       棋谱库
 *   - games/life-and-death  题库
 *   - joseki 的 trie 树     仅 trie-*.json.gz + trie-meta.json，排除 quiz-*
 * 不处理：quiz-*、rankings、其余按需资源。
 *
 * 为何另出一份清单而不是直接复用现有 index：
 *   games 的 index.json.gz + <date>.meta.json.gz 要解压两处才能拼出分块名；
 *   joseki 的 trie 树是层层嵌套引用（trie-index 只引用 2 个，其余 60 个散在
 *   子树里），没有中心清单。构建期直接列目录生成扁平文件名数组最可靠，
 *   纯 JSON 免解压，体积只有几百字节，远低于服务器单文件限制。
 *
 * 清单落在各库目录内，而这些目录整体在 PRELOAD_EXCLUDE_DIRS 中，
 * 因此不会混进 web-resources.zip —— 预加载包保持精简。
 */
const LIBRARIES = [
  {
    id: 'joseki-trie',
    dir: 'shared/assets/data/joseki',
    include: (name) => name.startsWith('trie-') || name === 'trie-meta.json',
    note: '定式 trie 树（排除 quiz-*）',
  },
  {
    id: 'life-and-death',
    dir: 'shared/assets/data/games/life-and-death',
    include: () => true,
    note: '题库',
  },
  {
    id: 'ai-review',
    dir: 'shared/assets/data/games/ai-review',
    include: () => true,
    note: '棋谱库',
  },
];

const LIBRARY_MANIFEST = 'library-files.json';

function generateLibraryManifests() {
  console.log('\n📋 生成内置库全量下载清单...\n');

  const distDir = resolve(ROOT, 'dist-web');
  let total = 0;

  for (const lib of LIBRARIES) {
    const root = join(distDir, lib.dir);
    const files = listFilesRecursively(root)
      .map(f => f.path)
      .filter(name => name !== LIBRARY_MANIFEST && lib.include(name))
      .sort();
    if (files.length === 0) {
      console.warn(`⚠️  [${lib.id}] 目录为空，跳过`);
      continue;
    }
    const payload = {
      id: lib.id,
      dir: lib.dir,
      generatedAt: new Date().toISOString(),
      count: files.length,
      files,
    };
    writeFileSync(join(root, LIBRARY_MANIFEST), JSON.stringify(payload, null, 2) + '\n');
    console.log(`✅ [${lib.id}] ${lib.note}: ${files.length} 个文件 -> ${lib.dir}/${LIBRARY_MANIFEST}`);
    total += files.length;
  }
  console.log(`✅ 清单生成完成，共 ${total} 个文件（不进 web-resources.zip）\n`);
}

/**
 * 生成 web-resources.zip
 * 
 * 将 dist-web/ 下需要预下载的文件（排除 models/、tfjs/、定式库、题库、
 * AI 复盘棋谱、榜单、插件 wasm 等）打包为 zip
 * 客户端启动时下载此压缩包并解压，替代之前逐文件下载的方式
 * 被排除的资源仍在 Worker 上，由客户端按需回源下载
 */
function generateWebResourcesZip() {
  console.log('\n📦 生成 web-resources.zip...\n');

  const distDir = resolve(ROOT, 'dist-web');
  const allFiles = listFilesRecursively(distDir);

  // 过滤掉排除目录和文件
  const includedFiles = [];
  let excludedCount = 0;
  let excludedBytes = 0;

  for (const file of allFiles) {
    const isExcludedDir = PRELOAD_EXCLUDE_DIRS.some(dir =>
      file.path === dir || file.path.startsWith(dir + '/'));
    const isExcludedFile = PRELOAD_EXCLUDE_FILES.includes(file.path);
    const isExcludedPattern = PRELOAD_EXCLUDE_PATTERNS.some(re => re.test(file.path));

    if (isExcludedDir || isExcludedFile || isExcludedPattern) {
      excludedCount++;
      excludedBytes += file.size;
      continue;
    }

    includedFiles.push(file);
  }

  const zipPath = join(distDir, 'web-resources.zip');

  // 删除旧的 zip
  if (existsSync(zipPath)) {
    rmSync(zipPath);
  }

  // 使用系统 zip 命令打包
  // 先生成文件列表写入临时文件，再用 -@ 模式
  const fileListPath = join(distDir, '.zip-filelist.txt');
  const fileListContent = includedFiles.map(f => f.path).join('\n');
  writeFileSync(fileListPath, fileListContent);

  try {
    // zip -@ 从 stdin 读取文件列表，-9 最高压缩，-x 排除
    execSync(`zip -9 -@ "${zipPath}" < "${fileListPath}"`, {
      cwd: distDir,
      stdio: 'pipe',
    });
  } finally {
    // 清理临时文件
    if (existsSync(fileListPath)) {
      rmSync(fileListPath);
    }
  }

  const zipSize = statSync(zipPath).size;
  const zipSizeMB = (zipSize / 1024 / 1024).toFixed(1);
  const totalOrigMB = (includedFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(1);
  const excludedMB = (excludedBytes / 1024 / 1024).toFixed(1);

  console.log(`✅ web-resources.zip 已生成`);
  console.log(`   包含文件: ${includedFiles.length} 个 (${totalOrigMB} MB)`);
  console.log(`   排除文件: ${excludedCount} 个 (${excludedMB} MB)`);
  console.log(`   排除目录: ${PRELOAD_EXCLUDE_DIRS.join(', ')}`);
  console.log(`   排除模式: ${PRELOAD_EXCLUDE_PATTERNS.map(re => String(re)).join(', ')}`);
  console.log(`   压缩后大小: ${zipSizeMB} MB`);
}

// 执行
copyResources();
const version = generateVersionJson();
addCacheBusting(version);
generateLibraryManifests();
generateWebResourcesZip();
