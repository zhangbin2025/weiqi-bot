#!/usr/bin/env node
/**
 * 统一资源拷贝配置
 * 用法: node scripts/build-assets.mjs
 * 
 * 在 vite build 之后执行，拷贝所有需要的资源到 dist-web/
 * 并生成 web-resources.zip 供客户端预下载使用
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'fs';
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
const PRELOAD_EXCLUDE_DIRS = ['models', 'tfjs'];
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
 * 生成 web-resources.zip
 * 
 * 将 dist-web/ 下需要预下载的文件（排除 models/、tfjs/ 等）打包为 zip
 * 客户端启动时下载此压缩包并解压，替代之前逐文件下载的方式
 */
function generateWebResourcesZip() {
  console.log('\n📦 生成 web-resources.zip...\n');

  const distDir = resolve(ROOT, 'dist-web');
  const allFiles = listFilesRecursively(distDir);

  // 过滤掉排除目录和文件
  const includedFiles = [];
  let excludedCount = 0;

  for (const file of allFiles) {
    const isExcludedDir = PRELOAD_EXCLUDE_DIRS.some(dir => file.path.startsWith(dir + '/'));
    const isExcludedFile = PRELOAD_EXCLUDE_FILES.includes(file.path);

    if (isExcludedDir || isExcludedFile) {
      excludedCount++;
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

  console.log(`✅ web-resources.zip 已生成`);
  console.log(`   包含文件: ${includedFiles.length} 个 (${totalOrigMB} MB)`);
  console.log(`   排除文件: ${excludedCount} 个 (models/, tfjs/)`);
  console.log(`   压缩后大小: ${zipSizeMB} MB`);
}

// 执行
copyResources();
const version = generateVersionJson();
generateWebResourcesZip();
