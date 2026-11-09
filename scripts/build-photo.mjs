#!/usr/bin/env node
/**
 * 拍照摆子资源拷贝脚本（新 weiqi-photo / Plan C 库依赖方式）
 *
 * 新 weiqi-photo 的 main 分支不再是 npm 包：没有 dist/、没有 opencv 资产，
 * 只有浏览器推理 ES module（inference/src/）和离线训练脚本。weiqi-bot 以
 * Vite alias 直接 import '@weiqi/photo'（→ ../weiqi-photo/inference/src/index.mjs）。
 *
 * 唯一需要随站点分发的二进制是训练产出的 ONNX 模型：
 *   ../weiqi-photo/training/out-cnn/cnn.onnx  →  clients/web/public/photo/cnn.onnx
 * 运行时由 PhotoImportService 用 toAbsoluteUrl('photo/cnn.onnx') 取字节，传入
 * transcribe(imageData, quad, lines, onnxModel)。ONNX Runtime Web 走联网 CDN。
 *
 * 模型 / 整个 public/photo/ 都不入库（.gitignore 已忽略，与 ocr/ 同策略）。
 * 模型须先按 ../weiqi-photo/TRAINING.md 训练生成；缺失时本脚本报错退出。
 *
 * ⚠️ 不要 rmSync 整个 public/photo 目录再重建：vite dev 启动时缓存了 public
 * 文件清单，目录删后重建会让 /photo/* 请求拿到 SPA 回退 HTML（text/html），
 * 浏览器把 HTML 当模型字节解析就报错。原地 mkdir -p + 覆盖写不会触发。
 * 旧版遗留的 opencv.stripped.js / opencv.wasm 属死文件，可另行手动清理。
 *
 * 用法: node scripts/build-photo.mjs
 */

import { existsSync, mkdirSync, copyFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, 'clients/web/public/photo');
const MODEL_SRC = join(ROOT, '..', 'weiqi-photo', 'training', 'out-cnn', 'cnn.onnx');

if (!existsSync(MODEL_SRC)) {
  console.error(
    `❌ 缺少 CNN 模型: ${MODEL_SRC}\n` +
    '   请先按 ../weiqi-photo/TRAINING.md 训练生成 cnn.onnx：\n' +
    '     python3 -m training.crossfit.train_cnn --data <数据目录> --out training/out-cnn',
  );
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const dest = join(OUT_DIR, 'cnn.onnx');
copyFileSync(MODEL_SRC, dest);
const size = statSync(dest).size;

writeFileSync(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify({ version: 2, engine: 'cnn-onnx', files: [{ file: 'cnn.onnx', size }] }, null, 2) + '\n',
);

console.log(`  ✅ cnn.onnx  ${(size / 1024).toFixed(1)} KB`);
console.log(`\n✅ 完成 → clients/web/public/photo/  (不入仓库)\n`);
