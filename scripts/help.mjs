#!/usr/bin/env node
/**
 * npm run help — 列出所有可用命令
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

const GROUPS = [
  {
    title: '🔨 构建',
    items: {
      'build':            '编译 TypeScript (tsc)',
      'build:watch':      '编译 TypeScript 并监听变更',
      'build:web':        '构建 Web 产物 (vite build + 资源拷贝)',
      'build:app':        '构建 Android APK',
      'build:desktop':    '构建 Desktop 产物 (Web + Electron)',
    },
  },
  {
    title: '🧪 测试',
    items: {
      'test':             '运行测试 (vitest)',
      'test:watch':       '运行测试并监听变更',
      'test:coverage':    '运行测试并生成覆盖率报告',
      'typecheck':        '类型检查 (tsc --noEmit)',
      'lint':             'ESLint 检查',
    },
  },
  {
    title: '💻 开发',
    items: {
      'dev':              '启动 Vite 开发服务器',
      'dev:build':        '开发构建 (vite build + 资源拷贝, 删除 sourcemap)',
      'dev:desktop':      '启动 Desktop 开发模式',
    },
  },
  {
    title: '📦 数据生成',
    items: {
      'generate:joseki':  '生成定式 Trie 树数据 (索引 + 子树 + 做题)',
    },
  },
  {
    title: '🚀 发布',
    items: {
      'dist:desktop':     '打包 Desktop 安装包 (Electron Builder)',
    },
  },
  {
    title: '🧹 清理',
    items: {
      'clean':            '清理构建产物 (dist, coverage, tsbuildinfo)',
      'clean:all':        '清理全部 (含 node_modules)',
      'reset':            'clean:all + 重新安装依赖',
    },
  },
];

const scripts = pkg.scripts || {};
const maxLen = Math.max(...Object.keys(scripts).map(k => k.length));
const pad = (s) => s.padEnd(maxLen + 2);

console.log('');
console.log(`📦 ${pkg.name} v${pkg.version}`);
console.log('─'.repeat(52));

for (const group of GROUPS) {
  console.log(`\n${group.title}`);
  for (const [name, desc] of Object.entries(group.items)) {
    if (scripts[name]) {
      console.log(`  ${pad(name)}${desc}`);
    }
  }
}

// 找出未被分组覆盖的脚本
const grouped = new Set();
for (const g of GROUPS) Object.keys(g.items).forEach(k => grouped.add(k));
const extra = Object.keys(scripts).filter(k => !grouped.has(k) && k !== 'help');
if (extra.length > 0) {
  console.log('\n⚙️  其他');
  for (const name of extra) {
    console.log(`  ${pad(name)}${scripts[name]}`);
  }
}

console.log('');
