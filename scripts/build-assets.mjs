#!/usr/bin/env node
/**
 * 统一资源拷贝配置
 * 用法: node scripts/build-assets.mjs
 * 
 * 在 vite build 之后执行，拷贝所有需要的资源到 dist-web/
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
}

// 执行
copyResources();
generateVersionJson();
