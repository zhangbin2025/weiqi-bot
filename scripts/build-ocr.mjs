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
 * 实测（2026-10-19，真实 Chrome）：
 *   - target=es2015 产物可正常运行，识别结果与未降级产物一致
 *   - ORT 运行时只请求 2 个文件：ort-wasm-simd-threaded.jsep.mjs / .wasm
 *     （不是整个 136MB 的 dist，只需拷贝这一对）
 *
 * 用法: node scripts/build-ocr.mjs
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'clients/web/public/ocr');
const ORT_DIST = join(ROOT, 'node_modules/onnxruntime-web/dist');
const PADDLE_DIST = join(ROOT, 'node_modules/@paddleocr/paddleocr-js/dist');

/** ORT 运行时实际需要的文件（实测确认，不要改成整个 dist） */
const ORT_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

function main() {
  console.log('\n🔧 打包 OCR 引擎 (@paddleocr/paddleocr-js)\n');

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(join(OUT_DIR, 'ort'), { recursive: true });

  // 1. esbuild 打包入口
  const entry = join(ROOT, 'scripts/ocr-entry.mjs');
  writeFileSync(
    entry,
    'import { PaddleOCR } from "@paddleocr/paddleocr-js";\n' +
      'window.__WeiqiOcrNs = { PaddleOCR };\n'
  );

  const outfile = join(OUT_DIR, 'bundle.js');
  console.log('  ⏳ esbuild 打包中…');
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

  // 2. 拷贝 ORT 运行时（仅实测需要的那对文件）
  for (const f of ORT_FILES) {
    const src = join(ORT_DIST, f);
    if (!existsSync(src)) {
      console.error(`  ❌ 缺少 ORT 文件: ${src}`);
      process.exit(1);
    }
    copyFileSync(src, join(OUT_DIR, 'ort', f));
    console.log(`  ✅ ort/${f}`);
  }

  // 3. 拷贝 PaddleOCR worker 资产
  //
  // bundle 内是 new URL("./assets/worker-entry-XXXX.js", import.meta.url)，
  // 即运行时会请求 <bundle所在目录>/assets/worker-entry-XXXX.js。
  // 这个文件 11MB，esbuild 不会内联（它是 URL 引用而非 import）。
  // 不发布 → 运行时 404 → OCR 直接失败。
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
  //
  // worker 是通过 new Worker(new URL("./assets/worker-entry-XXXX.js", import.meta.url))
  // 创建的 —— 走的是 Worker 加载，不是 fetch，因此无法用 fetch 拦截观测进度。
  // 该文件 11MB，若不处理会表现为"进度条卡住不动"。
  // 这里把带 hash 的文件名写进 manifest，运行时先 fetch 预热（可观测字节进度），
  // 再创建 Worker 时命中 HTTP 缓存，从而让这段也可显示真实进度。
  // （文件名带内容 hash，硬编码会随版本失效，故由构建产出。）
  const workerFiles = readdirSync(join(OUT_DIR, 'assets')).filter((f) => f.endsWith('.js'));
  const sz = (rel) => statSync(join(OUT_DIR, rel)).size;
  const bundleSize = statSync(join(OUT_DIR, 'bundle.js')).size;
  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        // 带上体积，运行时可算出确定的总字节数，进度条不会忽大忽小
        bundle: { path: 'bundle.js', size: bundleSize },
        worker: workerFiles.map((f) => ({ path: 'assets/' + f, size: sz('assets/' + f) })),
        ort: ORT_FILES.map((f) => ({ path: 'ort/' + f, size: sz('ort/' + f) })),
      },
      null,
      2
    )
  );
  console.log(`  ✅ manifest.json (worker: ${workerFiles.join(', ')})`);

  console.log(`\n✅ 完成 → clients/web/public/ocr/`);
  console.log('   bundle.js + ort/（作为 public 静态资源原样发布，不进主 chunk）\n');
}

main();
