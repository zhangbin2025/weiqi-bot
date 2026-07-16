import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'clients/web',
  base: '',
  publicDir: 'public',
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
    rollupOptions: {
      input: {
        'index': path.resolve(__dirname, 'clients/web/index.html'),
        'player/index': path.resolve(__dirname, 'clients/web/player/index.html'),
        'event/index': path.resolve(__dirname, 'clients/web/event/index.html'),
        'event/events': path.resolve(__dirname, 'clients/web/event/events.html'),
        'event/detail': path.resolve(__dirname, 'clients/web/event/detail.html'),
        'fetcher/index': path.resolve(__dirname, 'clients/web/fetcher/index.html'),
        'replay/index': path.resolve(__dirname, 'clients/web/replay/index.html'),
        'replay/list': path.resolve(__dirname, 'clients/web/replay/list.html'),
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
        'opponent/index': path.resolve(__dirname, 'clients/web/opponent/index.html'),
        'decision/index': path.resolve(__dirname, 'clients/web/decision/index.html'),
        'decision/list': path.resolve(__dirname, 'clients/web/decision/list.html'),
        'decision/quiz': path.resolve(__dirname, 'clients/web/decision/quiz.html'),
        'debug/index': path.resolve(__dirname, 'clients/web/debug/index.html'),
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
  esbuild: {
    target: 'es2015',
  },
});
