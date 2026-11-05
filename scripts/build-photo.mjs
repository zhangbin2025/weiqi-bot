#!/usr/bin/env node
/**
 * 拍照摆子资源拷贝脚本
 *
 * 把 weiqi-photo 编译好的 opencv 资产拷到 clients/web/public/photo/：
 *   opencv.stripped.js  223KB —— 预剥离版，内嵌的 base64 wasm 已换成独立文件
 *   opencv.wasm         7.6MB —— 让 emscripten 走 instantiateStreaming（流式编译）
 *
 * 为什么必须预剥离版而不是原始 opencv.js：
 *   原始版把 7.6MB wasm 以 data: URI 内嵌，emscripten 的 instantiateAsync()
 *   判断 isDataURI() 恒为真 → 永远走 instantiateArrayBuffer（先备齐全部字节
 *   再一次性编译）→ 主线程被同步冻住，浏览器弹「页面无响应」。
 *   换成真实 URL 后走流式编译，边下边编。
 *
 * 为什么不进仓库：
 *   7.8MB 二进制，与 clients/web/public/ocr/ 同策略（.gitignore 已忽略）。
 *   public/photo/ 缺失时运行时自动回退到 CDN 内嵌版（见 PhotoImportService）。
 *
 * 用法: node scripts/build-photo.mjs
 *       node scripts/build-photo.mjs --prepare-force   # 强制重编上游
 * 前置依赖由 prepare-photo.mjs 自动补齐，缺 node_modules / dist / opencv 资产
 * 时无需手工干预。
 */

import { existsSync, mkdirSync, copyFileSync, statSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, 'clients/web/public/photo');
const PHOTO_DIST = join(ROOT, '..', 'weiqi-photo', 'dist');

const FILES = ['opencv.stripped.js', 'opencv.wasm'];
const FORCE_PREPARE = process.argv.includes('--prepare-force');

// 前置链：dist/ 需要 tsc 产物 + extract-wasm.mjs 剥离出的 opencv 资产。
// 缺任一项时自动跑 prepare-photo.mjs（幂等，只补缺失），避免手工漏步骤。
// 详见 prepare-photo.mjs 顶部注释 —— 单跑 npm run build 并不会生成这两个文件。
if (FORCE_PREPARE || !existsSync(PHOTO_DIST) || FILES.some((f) => !existsSync(join(PHOTO_DIST, f)))) {
  console.log('⚙️  weiqi-photo/dist 未就绪，先执行 prepare-photo.mjs …\n');
  execFileSync(
    process.execPath,
    [join(ROOT, 'scripts', 'prepare-photo.mjs')],
    { cwd: ROOT, stdio: 'inherit' },
  );
  console.log('');
}

// ⚠️ 不要 rmSync 整个目录再重建：vite dev server 在启动时缓存了 public/ 的
// 文件清单，目录被删除再重建后缓存失效，所有 /photo/* 请求都会拿到 SPA 回退的
// 首页 HTML（content-type: text/html）。浏览器把 HTML 当 wasm 编译就报
//   expected magic word 00 61 73 6d, found 3c 21 44 4f
// 判据：磁盘上文件是好的（魔数 0061736d），但 HTTP 返回 text/html → 必是此坑。
// 原地覆盖写不会触发，故只 mkdir -p。
mkdirSync(OUT_DIR, { recursive: true });

/**
 * 预剥离版里的 wasm 路径是 weiqi-photo demo 的绝对路径 /dist/opencv.wasm。
 *
 * 直接搬到 weiqi-bot 下会炸：站点上没有 /dist/ 这个路径，dev server（以及多数
 * SPA 部署）对未知路径回退成 200 + text/html 的首页 HTML，于是浏览器把 HTML
 * 当 wasm 编译 —— 魔数变成 "<!DO"：
 *   abort(CompileError: WebAssembly.instantiate(): expected magic word
 *         00 61 73 6d, found 3c 21 44 4f @+0)
 *
 * 而 loadCv 的 localizeWasm 只认两种形态：占位符 "__WASM_URL__"，或内嵌的
 * data: base64。预剥离版两者都不是，所以传进去的 wasmUrl 会被静默忽略。
 * 这里在拷贝时把它改回占位符，运行时由 PhotoImportService 按实际部署路径替换
 * （支持子目录部署），同时顺带解决「换域名/换路径就要重新打包」的问题。
 */
function localizeWasmPath(jsPath) {
  const raw = readFileSync(jsPath, 'utf8');

  // 已经是占位符说明上游 extract-wasm.mjs 这次直接产出了占位符版本，
  // 无需再改 —— 早先这里会误报「预剥离版格式变了」，实际只是幂等重跑。
  if (/wasmBinaryFile\s*=\s*"__WASM_URL__"/.test(raw)) return false;

  const patched = raw.replace(
    /wasmBinaryFile\s*=\s*"[^"]*opencv\.wasm"/g,
    'wasmBinaryFile="__WASM_URL__"',
  );
  if (patched === raw) {
    throw new Error(
      '未在 opencv.stripped.js 中找到 wasmBinaryFile 赋值 —— 预剥离版格式变了，' +
      '请同步更新本正则（或重新用 weiqi-photo 的 tools/extract-wasm.mjs 生成）',
    );
  }
  writeFileSync(jsPath, patched);
  return true;
}

const copied = [];
for (const f of FILES) {
  const src = join(PHOTO_DIST, f);
  if (!existsSync(src)) {
    console.error(`❌ 缺少 ${f}（prepare-photo.mjs 未能生成，请检查上游输出）`);
    process.exit(1);
  }
  const dest = join(OUT_DIR, f);
  copyFileSync(src, dest);
  if (f === 'opencv.stripped.js') {
    const replaced = localizeWasmPath(dest);
    if (!replaced) console.log('  \u2139\ufe0f  opencv.stripped.js 已是占位符版本，跳过路径替换');
  }
  const size = statSync(src).size;
  copied.push({ file: f, size });
  console.log(`  ✅ ${f}  ${(size / 1048576).toFixed(2)} MB`);
}

writeFileSync(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify({ version: 1, files: copied }, null, 2),
);

const totalMb = copied.reduce((s, c) => s + c.size, 0) / 1048576;
console.log(`\n✅ 完成 → clients/web/public/photo/  (${totalMb.toFixed(2)} MB，不入仓库)\n`);
