import { defineConfig } from 'vite';
import path from 'path';
import fs from 'node:fs';

/**
 * 【构建产物 CSS 顺序修正】
 *
 * 问题：源码里 `<link rel="stylesheet" href="../shared/shell.css">` 写在 `<style>` 之前，
 *       页面内联样式依赖「后写覆盖先写」来覆盖 shell.css 的同名规则（.glass-content / .card 等）。
 *       但 Vite 构建时会把外链 CSS 打包成 `<link rel="stylesheet" href="../assets/xxx.css">`
 *       并追加到 </head> 前——也就是**排在内联 <style> 之后**。
 *       同优先级下后加载者胜出，于是内联样式被 shell.css 反向覆盖：
 *       dev（3000）正常宽度 vs dist 宽度缩水、竖向留白变大，棋盘无法占满。
 *
 * 修复：构建末尾把每个 HTML 里内联的 `<style>` 统一挪到所有 `<link rel="stylesheet">` 之后，
 *       恢复源码中的「外链在前、内联在后」顺序，使内联覆盖始终生效。
 */
function inlineStyleAfterLinkedCss() {
  return {
    name: 'inline-style-after-linked-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (!fileName.endsWith('.html') || typeof asset.source !== 'string') continue;
        const html = asset.source;
        const styles = html.match(STYLE_RE);
        if (!styles || styles.length === 0) continue;

        // 定位最后一个 stylesheet link（Vite 注入的打包 CSS）
        const LINK_RE = /<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi;
        const lastLink = [...html.matchAll(LINK_RE)].pop();
        if (!lastLink || lastLink.index === undefined) continue;
        const insertAt = lastLink.index + lastLink[0].length;

        // 剔除原有的内联 style，再插到 link 之后
        const stripped = html.replace(STYLE_RE, '');
        // 剔除后插入点会前移，按「被删掉的 style 中位于插入点之前的总长度」校正
        let shift = 0;
        for (const m of html.matchAll(STYLE_RE)) {
          if (m.index !== undefined && m.index < insertAt) shift += m[0].length;
        }
        const pos = insertAt - shift;
        asset.source = stripped.slice(0, pos) + styles.join('\n') + stripped.slice(pos);
      }
    },
  };
}

/**
 * 【禁用页面缩放】
 *
 * 背景：各页面 <meta viewport> 早已写了 user-scalable=no，但现代浏览器
 *       （iOS Safari 10+ / Chrome Android）出于无障碍考虑故意忽略它，
 *       双指捏合、双击、Ctrl+滚轮照样能缩。要真正禁掉只能拦事件。
 *
 * 为什么走插件注入而不是手改 29 个 HTML：
 *       · 一处注入，dev（3000）与构建产物同时生效；
 *       · 新增页面自动覆盖，不会再漏；
 *       · 不污染源码，回滚只删插件。
 *
 * 为什么内联而不是 <script src="../shared/no-zoom.js">：
 *       外链要同时满足「dev 下 /shared/ 可达」+「构建后 dist-web/shared 被拷贝」，
 *       后者由 build-assets.mjs 单独负责，而 vite build 的 emptyOutDir 会先清空
 *       dist-web —— 构建顺序一变就是 404（本次已实测踩到）。内联则零路径依赖。
 *       脚本不到 4KB，29 个页面多出的体积可忽略，且省一次请求。
 *
 * 内联位置：最后一个 </head> 之前。必须取**最后一处** —— String.replace 只换第一处，
 *           而部分页面的内联 CSS 注释里就写着「追加到 </head> 前」这类说明文字，
 *           换到那里会把脚本塞进注释里永不执行（puzzle 页实测踩到）。
 */
function disablePageZoom() {
  // 延迟到插件执行时读取：构建期只读一次，dev 下每次请求都会走 handler
  const SRC = path.resolve(__dirname, 'clients/web/shared/no-zoom.js');
  return {
    name: 'disable-page-zoom',
    // dev 与 build 都要（不设 apply 即默认两者生效）
    transformIndexHtml: {
      // pre：早于 Vite 自身的脚本注入，保证监听挂得够早（用户一进页面就能拦住）
      order: 'pre',
      handler(html: string) {
        // 幂等：HMR 会反复走 handler，重复注入等于重复挂监听
        if (html.includes('__noZoomInstalled__')) return html;
        const code = fs.readFileSync(SRC, 'utf8');
        // 防线：脚本正文里若出现闭合脚本标签，HTML 解析器会提前闭合，
        // 脚本被截断 → 语法错误 → 整个页面的 JS 全挂。构建期直接报错，
        // 好过上线后才发现页面白屏。
        if (/<\/script/i.test(code)) {
          throw new Error(
            '[disable-page-zoom] no-zoom.js 正文含闭合脚本标签字面量，会导致内联脚本被截断',
          );
        }
        const at = html.lastIndexOf('</head>');
        if (at === -1) return html; // 没有 </head> 的畸形文档：宁可不注入也不瞎塞
        // 闭合标签用拼接写成，避免本文件自身踩同一个坑
        const tag = '<script id="no-zoom">' + code + '<' + '/script>';
        return html.slice(0, at) + tag + '\n  ' + html.slice(at);
      },
    },
  };
}

export default defineConfig({
  root: 'clients/web',
  base: '',
  publicDir: 'public',
  plugins: [disablePageZoom(), inlineStyleAfterLinkedCss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    fs: {
      allow: ['..'],  // 允许访问父目录（weiqi-worker）
    },
    headers: {
      // Required for SharedArrayBuffer (enables threaded WASM backend)
      // Also required for WebGPU in Worker context
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    target: 'chrome61',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Node.js 内置模块在浏览器端不需要，但保留 npm 同名 polyfill 包（如 buffer）
      // 只 externalize 纯 Node 内置模块，不处理有 npm polyfill 的
      external: ['fs', 'crypto', 'http', 'path', 'os', 'url', 'stream', 'zlib', 'util'],

      input: {
        'index': path.resolve(__dirname, 'clients/web/index.html'),
        'player/index': path.resolve(__dirname, 'clients/web/player/index.html'),
        'event/index': path.resolve(__dirname, 'clients/web/event/index.html'),
        'event/events': path.resolve(__dirname, 'clients/web/event/events.html'),
        'event/detail': path.resolve(__dirname, 'clients/web/event/detail.html'),
        'fetcher/index': path.resolve(__dirname, 'clients/web/fetcher/index.html'),
        'replay/index': path.resolve(__dirname, 'clients/web/replay/index.html'),
        'replay/list': path.resolve(__dirname, 'clients/web/replay/list.html'),
        'replay/print-preview': path.resolve(__dirname, 'clients/web/replay/print-preview.html'),
        'replay/favorites': path.resolve(__dirname, 'clients/web/replay/favorites.html'),
        'recorder/index': path.resolve(__dirname, 'clients/web/recorder/index.html'),
        'review/index': path.resolve(__dirname, 'clients/web/review/index.html'),
        'play/hh': path.resolve(__dirname, 'clients/web/play/hh.html'),
        'play/hm': path.resolve(__dirname, 'clients/web/play/hm.html'),
        'play/mm': path.resolve(__dirname, 'clients/web/play/mm.html'),
        'play/index': path.resolve(__dirname, 'clients/web/play/index.html'),
        'assistant/index': path.resolve(__dirname, 'clients/web/assistant/index.html'),
        'joseki/index': path.resolve(__dirname, 'clients/web/joseki/index.html'),
        'joseki/list': path.resolve(__dirname, 'clients/web/joseki/list.html'),
        'joseki/explore': path.resolve(__dirname, 'clients/web/joseki/explore.html'),
        'joseki/discover': path.resolve(__dirname, 'clients/web/joseki/discover.html'),
        'joseki/quiz': path.resolve(__dirname, 'clients/web/joseki/quiz.html'),
        'puzzle/index': path.resolve(__dirname, 'clients/web/puzzle/index.html'),
        'opponent/index': path.resolve(__dirname, 'clients/web/opponent/index.html'),
        'decision/index': path.resolve(__dirname, 'clients/web/decision/index.html'),
        'decision/list': path.resolve(__dirname, 'clients/web/decision/list.html'),
        'decision/quiz': path.resolve(__dirname, 'clients/web/decision/quiz.html'),
        'debug/index': path.resolve(__dirname, 'clients/web/debug/index.html'),
        'remote/index': path.resolve(__dirname, 'clients/web/remote/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  preview: {
    headers: {
      // Required for SharedArrayBuffer (enables threaded WASM backend)
      // Also required for WebGPU in Worker context
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  resolve: {
    alias: {
      '@presentation': path.resolve(__dirname, 'presentation'),
      '@application': path.resolve(__dirname, 'application'),
      '@services': path.resolve(__dirname, 'services'),
      '@infrastructure': path.resolve(__dirname, 'infrastructure'),
      '@domain': path.resolve(__dirname, 'domain'),
      '@weiqi/worker': path.resolve(__dirname, '../weiqi-worker/src'),
      '@ui': path.resolve(__dirname, 'clients/web/shared/ui'),
    },
  },
  define: {
    __ENABLE_AI_AUTO_PLAY__: JSON.stringify(process.env.VITE_AI_AUTO_PLAY === "true"),
  },
  esbuild: {
    target: 'es2015',
  },
});
