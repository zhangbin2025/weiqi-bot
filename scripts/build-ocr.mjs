#!/usr/bin/env node
/**
 * OCR 引擎预打包脚本
 *
 * 为什么必须脱离 Vite 单独打包：
 *   根 vite.config.ts 的 build.target 是 'chrome61'、esbuild.target 是 'es2015'。
 *   onnxruntime-web 与 OpenCV.js 含有 BigInt、现代 WASM/ES 语法，交给 Vite 统一转译
 *   大概率产出不可运行代码，且会把 11MB+ 的引擎塞进主 chunk。
 *   这里用独立 esbuild 打成 ESM，产物放 public/ocr/，作为静态资源原样发布。
 *
 * ── ORT 运行时改为 CDN 加载（2026-10-19）────────────────────────────
 *
 * 背景：WebGPU 必须走 jsep 版 ORT，其 .wasm 为 27.00 MiB，
 *   超过 Cloudflare Workers 单静态资源 25 MiB 上限，随包发布直接部署失败。
 *   之前为绕开限制而改用非 jsep 版（13.58 MiB），代价是彻底放弃 WebGPU。
 *
 * 现在改为运行时从 CDN 拉取，不再进包体：
 *   - 包体瘦身 ~28MB，部署不再受 25MiB 限制
 *   - WebGPU 得以保留，真机有 GPU 时可用
 *   - 仍需 worker 主线程隔离（否则识别时页面冻结），这一点不变
 *
 * CDN 选型（2026-10-19 实测，真 Chrome，国内网络）：
 *   registry.npmmirror.com  ✅ 16.3 MB/s，CORS 反射 Origin，跨源动态 import 成功
 *   cdn.jsdelivr.net        ⚠️ 26~272 KB/s，实测基本不可用
 *   unpkg.com               ⚠️ 259 KB/s，且不返回 content-length
 *   注：百度 paddle-model-ecology 只托管模型，不托管 ORT（实测 404），故不适用。
 *
 * 用法: node scripts/build-ocr.mjs
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'clients/web/public/ocr');
const ORT_DIST = join(ROOT, 'node_modules/onnxruntime-web/dist');
const PADDLE_DIST = join(ROOT, 'node_modules/@paddleocr/paddleocr-js/dist');

/**
 * ORT 运行时 CDN 基址
 *
 * 必须与 package.json 里 onnxruntime-web 的版本严格一致：
 *   ORT 的 .mjs 与 .wasm 是配套产物，版本错配会在实例化 wasm 时失败。
 * 这里从 node_modules 读实际版本，避免手工同步。
 */
const ortVersion = (() => {
  const pkgPath = join(ROOT, 'node_modules/onnxruntime-web/package.json');
  if (!existsSync(pkgPath)) throw new Error('未找到 onnxruntime-web，请先安装依赖');
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
})();
const ORT_CDN_BASE = `https://registry.npmmirror.com/onnxruntime-web/${ortVersion}/files/dist/`;

/**
 * ORT 运行时文件（不进包体，运行时从 CDN 拉）
 *
 * 保留体积声明：运行时用它做进度分母。
 * 不能依赖 CDN 响应的 content-length —— 实测 npmmirror 返回的是
 * gzip 压缩后长度（8,246,457），真实解压为 28,312,028，
 * 拿压缩值当分母会让进度条突破 100%。
 */
const ORT_FILES = [
  { name: 'ort-wasm-simd-threaded.jsep.mjs', size: 0 },
  { name: 'ort-wasm-simd-threaded.jsep.wasm', size: 0 },
];

function main() {
  console.log('\n🔧 打包 OCR 引擎 (@paddleocr/paddleocr-js)\n');
  console.log(`   ORT ${ortVersion} 运行时改由 CDN 加载: ${ORT_CDN_BASE}\n`);

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // 1. esbuild 打包入口
  const entry = join(ROOT, 'scripts/ocr-entry.mjs');
  writeFileSync(
    entry,
    'import { PaddleOCR } from "@paddleocr/paddleocr-js";\n' +
      'window.__WeiqiOcrNs = { PaddleOCR };\n'
  );

  const outfile = join(OUT_DIR, 'bundle.js');
  console.log('  ⏳ esbuild 打包中…');
  //
  // 不再 alias 到 onnxruntime-web/wasm：
  //   默认入口内含 jsep 执行提供器，是 WebGPU 的必要条件。
  //   （之前为压体积 alias 到 ./wasm，等于放弃了 WebGPU。）
  //   jsep 的 .wasm 有 27MB，但已改由 CDN 加载，不影响部署。
  execFileSync(
    'npx',
    [
      'esbuild',
      entry,
      '--bundle',
      '--format=esm',
      '--target=es2015',
      '--platform=browser',
      '--external:fs',
      '--external:path',
      '--external:crypto',
      `--outfile=${outfile}`,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );
  rmSync(entry, { force: true });
  console.log('  ✅ bundle.js');

  // 2. ORT 运行时：不拷贝到产物，只记录真实体积供进度条使用
  for (const f of ORT_FILES) {
    const src = join(ORT_DIST, f.name);
    if (!existsSync(src)) {
      console.error(`  ❌ 缺少 ORT 文件: ${src}（本机构建需要它来读取体积）`);
      process.exit(1);
    }
    f.size = statSync(src).size;
    console.log(`  📦 ort/${f.name} ${(f.size / 1048576).toFixed(2)}MB → CDN`);
  }

  // 3. 拷贝 PaddleOCR worker 资产
  const assetsDir = join(PADDLE_DIST, 'assets');
  if (existsSync(assetsDir)) {
    const outAssets = join(OUT_DIR, 'assets');
    mkdirSync(outAssets, { recursive: true });
    let n = 0;
    for (const f of readdirSync(assetsDir)) {
      if (!f.endsWith('.js')) continue; // .map 不需要
      copyFileSync(join(assetsDir, f), join(outAssets, f));
      console.log(`  ✅ assets/${f}`);
      n++;
    }
    if (n === 0) console.error('  ⚠️  assets 目录为空，worker 可能无法加载');
  } else {
    console.error('  ❌ 缺少 PaddleOCR assets 目录:', assetsDir);
    process.exit(1);
  }

  // 4. 产出 manifest.json
  const workerFiles = readdirSync(join(OUT_DIR, 'assets')).filter((f) => f.endsWith('.js'));
  const sz = (rel) => statSync(join(OUT_DIR, rel)).size;
  const bundleSize = statSync(join(OUT_DIR, 'bundle.js')).size;
  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        version: 2,
        bundle: { path: 'bundle.js', size: bundleSize },
        worker: workerFiles.map((f) => ({ path: 'assets/' + f, size: sz('assets/' + f) })),
        // ort 带 base，运行时据此拼 CDN 地址；size 为解压后真实体积
        ort: {
          base: ORT_CDN_BASE,
          files: ORT_FILES.map((f) => ({ path: f.name, size: f.size })),
        },
      },
      null,
      2
    )
  );
  console.log(`  ✅ manifest.json (worker: ${workerFiles.join(', ')})`);

  const totalMb = (bundleSize + workerFiles.reduce((s, f) => s + sz('assets/' + f), 0)) / 1048576;
  console.log(`\n✅ 完成 → clients/web/public/ocr/`);
  console.log(`   包体 ${totalMb.toFixed(1)}MB（ORT 已外置，不再受 Workers 25MiB 限制）\n`);
}

main();
