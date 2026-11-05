#!/usr/bin/env node
/**
 * 拍照摆子引擎「上游产物」准备脚本
 *
 * 背景（2026-11-05）：
 *   scripts/build-photo.mjs 要把 ../weiqi-photo/dist 里的
 *     opencv.stripped.js / opencv.wasm
 *   拷到 clients/web/public/photo/。但这两个不是 tsc 产物 ——
 *   `npm run build` 只生成 .js/.d.ts/.map，opencv 资产得靠
 *   weiqi-photo/tools/extract-wasm.mjs 从 opencv.js 里单独剥离。
 *   clone 后只跑 npm run build 就执行 build-photo.mjs，必然报：
 *     ❌ 缺少 opencv.stripped.js（先在 ../weiqi-photo 执行 npm run build）
 *   （报错文案本身也有误导性：光跑 build 并不会生成这两个文件）
 *
 * 本脚本把前置链固化，且「只补缺失、不无谓重编译」（幂等）：
 *   1. ../weiqi-photo 缺 node_modules → npm ci
 *   2. dist/index.js 缺失            → npm run build（tsc）
 *   3. dist/opencv.{wasm,stripped.js} 缺失 → extract-wasm.mjs
 *
 * opencv.js 来源：优先用本仓库 node_modules 里的 @techstark/opencv-js，
 * 避免走 jsdelivr（国内实测很慢）；本地缺失或版本与 adapter.ts 的
 * DEFAULT_CV_URL 不符时，回退 extract-wasm.mjs 默认的 CDN。
 *
 * 用法：
 *   node scripts/prepare-photo.mjs           # 只补缺失
 *   node scripts/prepare-photo.mjs --force  # 强制重编译 + 重新剥离
 *   npm run build:photo:prepare
 *
 * 通常由 build-photo.mjs 在发现资产缺失时自动调用，无需手动跑。
 */

import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO_ROOT = resolve(ROOT, '..', 'weiqi-photo');
const DIST = join(PHOTO_ROOT, 'dist');
const FORCE = process.argv.includes('--force');

const ASSETS = ['opencv.wasm', 'opencv.stripped.js'];

function run(cmd, args, cwd) {
  console.log(`  ▶ ${cmd} ${args.join(' ')}   (cwd=${cwd})`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

/** adapter.ts 的 DEFAULT_CV_URL 里锁定的 opencv 版本，避免两处硬编码漂移 */
function expectedCvVersion() {
  try {
    const src = readFileSync(join(PHOTO_ROOT, 'src', 'cv', 'adapter.ts'), 'utf8');
    return src.match(/opencv-js@([^/"']+)\/dist\/opencv\.js/)?.[1] || null;
  } catch {
    return null;
  }
}

if (!existsSync(PHOTO_ROOT)) {
  console.error(`❌ 未找到上游仓库: ${PHOTO_ROOT}`);
  process.exit(1);
}

// 1) 依赖
if (!existsSync(join(PHOTO_ROOT, 'node_modules'))) {
  console.log('📦 weiqi-photo 缺依赖，执行 npm ci …');
  run('npm', ['ci'], PHOTO_ROOT);
}

// 2) tsc 产物
if (FORCE || !existsSync(join(DIST, 'index.js'))) {
  console.log('🔨 编译 weiqi-photo (tsc) …');
  run('npm', ['run', 'build'], PHOTO_ROOT);
}

// 3) opencv 资产
const missing = ASSETS.filter((f) => !existsSync(join(DIST, f)));
if (FORCE || missing.length) {
  console.log(missing.length
    ? `🧩 缺 opencv 资产: ${missing.join(', ')}，开始剥离 …`
    : '🧩 --force：重新剥离 opencv 资产 …');

  const cvPkg = join(ROOT, 'node_modules', '@techstark', 'opencv-js', 'package.json');
  const localCv = join(ROOT, 'node_modules', '@techstark', 'opencv-js', 'dist', 'opencv.js');
  const expected = expectedCvVersion();
  let args = [join(PHOTO_ROOT, 'tools', 'extract-wasm.mjs')];

  if (existsSync(localCv)) {
    let version = '?';
    try { version = JSON.parse(readFileSync(cvPkg, 'utf8')).version; } catch { /* ignore */ }
    if (version === expected) {
      args.push(localCv, join(DIST, 'opencv.wasm'), join(DIST, 'opencv.stripped.js'));
      console.log(`  ↳ 用本地 opencv.js (${version})，不走 CDN`);
    } else {
      console.warn(`  ⚠️ 本地 opencv.js 版本 ${version} ≠ 期望 ${expected ?? '?'}，回退 CDN`);
    }
  } else {
    console.log('  ↳ 本地无 opencv.js，回退 extract-wasm.mjs 默认 CDN');
  }
  run(process.execPath, args, PHOTO_ROOT);
}

// 4) 校验产物完整且合法
for (const f of ['index.js', ...ASSETS]) {
  if (!existsSync(join(DIST, f))) {
    console.error(`❌ 准备后仍缺 ${f} → ${join(DIST, f)}`);
    process.exit(1);
  }
}
const fd = openSync(join(DIST, 'opencv.wasm'), 'r');
const magic = Buffer.alloc(4);
readSync(fd, magic, 0, 4, 0);
closeSync(fd);
if (magic.toString('binary') !== '\x00asm') {
  console.error('❌ opencv.wasm 魔数不对，不是合法 wasm');
  process.exit(1);
}
if (!/wasmBinaryFile\s*=\s*"__WASM_URL__"/.test(readFileSync(join(DIST, 'opencv.stripped.js'), 'utf8'))) {
  console.error('❌ opencv.stripped.js 缺 __WASM_URL__ 占位符，运行时无法注入 wasmUrl');
  process.exit(1);
}
for (const f of ASSETS) {
  console.log(`  ✅ ${f}  ${(statSync(join(DIST, f)).size / 1048576).toFixed(2)} MB`);
}
console.log('\n✅ weiqi-photo/dist 已就绪\n');
