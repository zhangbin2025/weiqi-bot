/**
 * 本地静态文件服务器
 * 
 * 完全对齐 Android AssetServer + FileServer + ProxyHandler 实现
 * 
 * 结构：
 * - AssetServer: 路由分发（本类）
 * - 静态文件: 直接在本类处理
 * - 代理: 直接在本类处理
 */

import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import { AppConfig } from '../config';
import { VersionManager } from '../version-manager';
const AdmZip = require('adm-zip');

/**
 * MIME 类型映射（对齐 Android MimeTypeHelper）
 */
const MIME_TYPES: Record<string, string> = {
  'html': 'text/html',
  'htm': 'text/html',
  'css': 'text/css',
  'js': 'application/javascript',
  // .mjs 走严格 MIME 校验（ORT wasm 动态 import），不能用 octet-stream 兜底
  'mjs': 'text/javascript',
  'json': 'application/json',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'svg': 'image/svg+xml',
  'ico': 'image/x-icon',
  'woff': 'font/woff',
  'woff2': 'font/woff2',
  'ttf': 'font/ttf',
  'gz': 'application/gzip',
  'wasm': 'application/wasm',
};

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * 核心资源列表（用于检查是否存在）
 */
const CORE_RESOURCES = ['index.html', 'assistant/index.html'];

export class AssetServer {
  private server: http.Server | null = null;
  private cacheDir: string;
  private remoteBase: string;
  private versionManager: VersionManager;

  /**
   * 同一目标文件正在进行的下载（key = 目标文件绝对路径）。
   *
   * 运行时按需回源是「写 <dest>.tmp -> rename 到 <dest>」：两个业务同时首次
   * 请求同一文件会并发写同一个临时文件、互相覆盖字节流，且两次 rename 抢
   * 同一个目标（第二次 renameSync 时源文件已被移走而抛 ENOENT）。这里把同一
   * destFile 的并发请求合并到同一个 Promise —— 即「每个文件一把锁」，只有
   * 第一次真正下载，其余等待它完成后直接读缓存；不同文件仍可并发。
   */
  private readonly downloadFlights = new Map<string, Promise<void>>();

  /**
   * 内置库【库级】下载锁：同一时刻同一库只允许一个全量下载在跑。
   * 多个业务并发首次用到同一库时，其余请求共享同一个 Promise、等待首个下载
   * 完成后直接读本地缓存，不再各自发起一轮下载。不同库各自独立，互不阻塞。
   */
  private readonly libraryFlights = new Map<string, Promise<void>>();

  /**
   * 【全局】整库补齐队列：不同库的后台下载也不并发。
   * 用户 2026-11-17 实测：多库后台异步下载进行中，首次请求定式 quiz 偶发 404，
   * 重新打开（后台已结束）即成功。故所有库共用一条串行链，一次只跑一个。
   */
  private libraryQueue: Promise<void> = Promise.resolve();

  /** 库目录前缀 -> 库名。清单由 scripts/build-assets.mjs 生成，不进 web-resources.zip。 */
  private readonly libraryDirs: ReadonlyArray<{ prefix: string; name: string }> = [
    { prefix: 'shared/assets/data/joseki', name: 'joseki-trie' },
    { prefix: 'shared/assets/data/games/life-and-death', name: 'life-and-death' },
    { prefix: 'shared/assets/data/games/ai-review', name: 'ai-review' },
  ];

  private static readonly LIBRARY_MANIFEST = 'library-files.json';

  // 按需下载回调
  onDemandCallback: {
    onDownloadStart: (filename: string, sizeBytes: number) => void;
    onDownloadProgress: (filename: string, loaded: number, total: number) => void;
    onDownloadComplete: (filename: string) => void;
  } | null = null;

  constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'web');
    this.remoteBase = AppConfig.remoteBase;
    this.versionManager = new VersionManager();

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 主路由（对齐 Android AssetServer.serve）
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const reqUrl = req.url || '/';
    const uri = reqUrl.split('?')[0]; // 去掉 query string
    const method = req.method || 'GET';

    console.log(`[AssetServer] ${method} ${reqUrl}`);
    console.log(`[AssetServer] uri=${uri}, starts with /proxy=${uri.startsWith('/proxy')}`);

    // 处理 ProxyProvider 的错误转换：/proxy../xxx → 重定向到正确的静态文件
    if (uri.startsWith('/proxy../') || uri.startsWith('/proxy./') || uri.startsWith('/proxy/..')) {
      const actualPath = uri.replace(/^\/proxy\.\./, '').replace(/^\/proxy\/\.\./, '').replace(/^\/proxy\//, '');
      console.log(`[AssetServer] Redirect ${uri} -> ${actualPath}`);
      this.serveStatic(actualPath, res);
      return;
    }

    // /proxy 反向代理路由（对齐 Android）
    if (uri === '/proxy' || uri === '/proxy/' || reqUrl.includes('/proxy?') || reqUrl.includes('/proxy/?')) {
      // CORS 预检必须在进入 handleProxy 之前短路（对齐 Android AssetServer.serve()）。
      // 页面里带 Authorization + application/json 的 POST 会先发 OPTIONS；经 Electron
      // onBeforeRequest 重定向后预检落到本 /proxy 路由。若把 OPTIONS 转发给上游，
      // api.tavily.com 一类端点对裸 OPTIONS 直接返回 405 → 浏览器判定预检非 2xx、
      // 真正的 POST 根本发不出去（net::ERR_FAILED）。Android 就在这里先回 200。
      if (method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }
      console.log(`[AssetServer] Routing to handleProxy`);
      this.handleProxy(req, res);
      return;
    }

    // 兼容 ProxyProvider 的 bug
    if (uri.startsWith('/proxy/') && !uri.includes('?')) {
      const actualPath = uri.substring(7);
      console.log(`[AssetServer] Fixing ProxyProvider bug: ${uri} -> ${actualPath}`);
      this.serveStatic(actualPath, res);
      return;
    }

    // CORS 预检请求
    if (method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // 静态文件服务
    this.serveStatic(uri, res);
  }

  /**
   * 静态文件服务（对齐 Android FileServer）
   */
  private serveStatic(uri: string, res: http.ServerResponse): void {
    let filePath = uri.startsWith('/') ? uri.substring(1) : uri;

    if (filePath.includes('..')) {
      console.error(`[AssetServer] Invalid path with .. : ${filePath}`);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid path');
      return;
    }

    console.log(`[AssetServer] serveStatic: uri=${uri}, filePath=${filePath}`);

    if (filePath === '' || filePath === 'index.html') {
      filePath = 'index.html';
    }

    if (filePath.endsWith('/')) {
      filePath += 'index.html';
    }

    if (!path.extname(filePath)) {
      const indexPath = path.join(this.cacheDir, filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        filePath = filePath + '/index.html';
      }
    }

    const cachedFile = path.join(this.cacheDir, filePath);

    // 只认「非空」缓存：0 字节多半是上次下载中断留下的残 file，
    // 直接 serve 会让前端拿到空 gzip / 空 JSON 而报错。
    if (fs.existsSync(cachedFile) && fs.statSync(cachedFile).size > 0) {
      console.log(`[AssetServer] Cache hit: ${filePath}`);
      this.serveFile(cachedFile, res);
      return;
    }

    console.log(`[AssetServer] Cache miss: ${filePath}, downloading...`);

    // 内置库：整库补齐放【后台】串行跑，绝不阻塞/连累当前请求。
    // 原实现等整库下完才服务本文件，94 个文件里任一失败都会把本请求误判成 404。
    // 现在先立即服务触发请求的这个文件，后台补齐失败只记日志。
    const lib = this.matchLibrary(filePath);
    if (lib && !this.libraryFlights.has(lib.name)) {
      this.ensureLibrary(lib.prefix, lib.name).catch((err) => {
        console.error(`[AssetServer] Library background ensure failed (${lib.name}):`, err);
      });
    }

    this.downloadAndServe(filePath, res);
  }

  /**
   * 提供静态文件
   */
  private serveFile(filePath: string, res: http.ServerResponse): void {
    const mimeType = this.getMimeType(filePath);
    
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error(`[AssetServer] Error serving file:`, err);
      res.end();
    });
  }

  /** 请求路径是否落在某个内置库目录内（按最长前缀匹配，题库与棋谱库分开）。 */
  private matchLibrary(filePath: string): { prefix: string; name: string } | null {
    const normalized = filePath.replace(/^\/+/, '').split('?')[0].replace(/\\/g, '/');
    // 定式题库 quiz-* 与 trie 树同目录，但不纳入全量下载（用户 2026-11-17 明确排除）
    if (path.basename(normalized).startsWith('quiz-')) return null;
    const hit = this.libraryDirs
      .filter(l => normalized === l.prefix || normalized.startsWith(l.prefix + '/'))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    return hit ?? null;
  }

  /**
   * 确保某内置库已全量下载到本地（清单驱动补齐）。
   *
   * 只有缓存未命中才会走到这里，因此不能用「完成标记」短路——那样恰好会漏掉
   * 触发本次请求的那个缺失文件。改为按清单逐个检查、缺哪个补哪个：
   *   首次触发  -> 全部缺失，串行拉全（即「全量下载」）
   *   下载中断  -> 下次只补剩下的，不重复下
   *   库有新增  -> 补齐新文件
   *   已完整    -> 仅本地 stat 检查，零网络请求
   *
   * 库级锁保证同一时刻该库只有一个补齐任务在跑；并发的其它业务共享同一个
   * Promise、等待它完成后直接读本地缓存。库内【串行】await 逐个下载，绝不并发。
   * 清单由 scripts/build-assets.mjs 生成，不进 web-resources.zip。
   */
  private ensureLibrary(prefix: string, name: string): Promise<void> {
    const inFlight = this.libraryFlights.get(name);
    if (inFlight) return inFlight;

    // 全局串行：把本库补齐挂到队列尾部，前一个库补完才轮到本库。
    // 吞掉前一个任务的失败，避免一个库失败把后面全部短路。
    const flight = this.libraryQueue
      .catch(() => {})
      .then(() => {
        console.log(`[AssetServer] Library queue: start ${name}`);
        return this.doEnsureLibrary(prefix, name);
      })
      .finally(() => {
        this.libraryFlights.delete(name);
        console.log(`[AssetServer] Library queue: release ${name}`);
      });
    this.libraryFlights.set(name, flight);
    this.libraryQueue = flight;
    return flight;
  }

  private async doEnsureLibrary(prefix: string, name: string): Promise<void> {
    const libDir = path.join(this.cacheDir, prefix);
    console.log(`[AssetServer] Library ensure start: ${name}`);
    const filename = `内置库 ${name}`;
    this.onDemandCallback?.onDownloadStart(filename, -1);
    try {
      fs.mkdirSync(libDir, { recursive: true });

      // 清单本身也按需下载
      const manifestFile = path.join(libDir, AssetServer.LIBRARY_MANIFEST);
      if (!fs.existsSync(manifestFile) || fs.statSync(manifestFile).size === 0) {
        await this.downloadFileWithProgress(
          `${this.remoteBase}/${prefix}/${AssetServer.LIBRARY_MANIFEST}`, manifestFile);
      }
      const payload = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as { files?: string[] };
      const files = (payload.files ?? []).filter(
        f => f && !f.includes('..') && !f.startsWith('/'));
      console.log(`[AssetServer] Library ${name} manifest: ${files.length} files`);

      // 【关键】串行：await 逐个下载，绝不并发
      let downloaded = 0;
      for (let i = 0; i < files.length; i++) {
        const rel = files[i];
        const dest = path.join(libDir, rel);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
        const encoded = rel.split('/').map(encodeURIComponent).join('/');
        await this.downloadFileWithProgress(`${this.remoteBase}/${prefix}/${encoded}`, dest);
        downloaded++;
        console.log(`[AssetServer] Library ${name}: ${i + 1}/${files.length} ${rel}`);
      }
      console.log(`[AssetServer] Library ensure done: ${name} (${downloaded} downloaded, ${files.length} total)`);
    } catch (err) {
      console.error(`[AssetServer] Library ensure failed: ${name}`, err);
      throw err;
    } finally {
      this.onDemandCallback?.onDownloadComplete(filename);
    }
  }

  /**
   * 从远程下载并返回
   */
  private downloadAndServe(filePath: string, res: http.ServerResponse): void {
    const remoteUrl = `${this.remoteBase}/${filePath}`;
    const cachedFile = path.join(this.cacheDir, filePath);

    const filename = path.basename(filePath);
    this.onDemandCallback?.onDownloadStart(filename, -1);

    const progress = (loaded: number, total: number) =>
      this.onDemandCallback?.onDownloadProgress(filename, loaded, total);

    const attempt = (retryLeft: number): void => {
      this.downloadFileWithProgress(remoteUrl, cachedFile, progress)
        .then(() => {
          this.onDemandCallback?.onDownloadComplete(filename);
          this.serveFile(cachedFile, res);
        })
        .catch((err) => {
          console.error(`[AssetServer] Download failed (${filePath}, retryLeft=${retryLeft}):`, err);
          // 清掉可能损坏的缓存残 file 后重试一次，覆盖本地状态异常 / 瞬时网络
          if (retryLeft > 0) {
            try {
              if (fs.existsSync(cachedFile)) fs.unlinkSync(cachedFile);
            } catch (e) {
              console.warn(`[AssetServer] Cannot clean ${cachedFile}:`, e);
            }
            attempt(retryLeft - 1);
            return;
          }
          this.onDemandCallback?.onDownloadComplete(filename);
          if (!res.headersSent) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`404 Not Found: ${filePath}`);
          } else {
            res.end();
          }
        });
    };
    attempt(1);
  }

  /**
   * 带进度的下载文件
   */
  private async downloadFileWithProgress(
    url: string,
    destFile: string,
    progressCallback?: (loaded: number, total: number) => void
  ): Promise<void> {
    // 每个目标文件一个 in-flight 下载：并发请求共享同一个 Promise，
    // 不再各写一份 <dest>.tmp、各 rename 一次（这正是冲突来源）。
    const key = path.resolve(destFile);
    const inFlight = this.downloadFlights.get(key);
    if (inFlight) return inFlight;

    const flight = this.doDownloadFileWithProgress(url, destFile, progressCallback)
      .finally(() => this.downloadFlights.delete(key));
    this.downloadFlights.set(key, flight);
    return flight;
  }

  /** 实际下载体：仅由 downloadFileWithProgress 取得「文件锁」后调用。 */
  private async doDownloadFileWithProgress(
    url: string,
    destFile: string,
    progressCallback?: (loaded: number, total: number) => void
  ): Promise<void> {
    // 二次检查：排队等待期间文件可能已被前一个下载写好，直接读缓存即可。
    // 只认「非空」的已有文件：0 字节多半是上次中断留下的残 file，必须重下。
    if (fs.existsSync(destFile) && fs.statSync(destFile).size > 0) return;
    // 0 字节多半是上次中断留下的残 file；Windows 上 renameSync 覆盖已存在文件
    // 可能失败（EPERM/EEXIST），先清掉再下。
    if (fs.existsSync(destFile)) {
      try {
        fs.unlinkSync(destFile);
        console.log(`[AssetServer] Removed stale empty file: ${destFile}`);
      } catch (err) {
        console.warn(`[AssetServer] Cannot remove stale file ${destFile}:`, err);
      }
    }

    const parentDir = path.dirname(destFile);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      // 唯一临时文件名：并发（或跨进程 / 上次崩溃残留）不会互相覆盖同一份 .tmp
      const tempFile = `${destFile}.${process.pid}.${randomUUID()}.tmp`;
      const file = fs.createWriteStream(tempFile);
      let loadedBytes = 0;
      let totalBytes = 0;

      client.get(url, { headers: { 'Accept-Encoding': 'identity' } }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const location = response.headers.location;
          if (location) {
            file.close();
            fs.unlinkSync(tempFile);
            const fullUrl = location.startsWith('http') ? location : new URL(location, url).toString();
            // 递归走实际体，绕开锁外壳：否则会命中当前 flight 自己而死锁
            this.doDownloadFileWithProgress(fullUrl, destFile, progressCallback).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(tempFile);
          reject(new Error());
          return;
        }

        totalBytes = parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk: Buffer) => {
          loadedBytes += chunk.length;
          if (progressCallback && totalBytes > 0) {
            progressCallback(loadedBytes, totalBytes);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          try {
            fs.renameSync(tempFile, destFile);
          } catch (err) {
            // 并发（或另一进程刚写好）时 rename 可能失败；若目标已是完整文件
            // 则视为成功，避免把一个本可正常服务的请求误判为下载失败。
            try {
              if (!(fs.existsSync(destFile) && fs.statSync(destFile).size > 0)) throw err;
              try { fs.unlinkSync(tempFile); } catch {}
              console.log(`[AssetServer] rename lost race, target already present: ${destFile}`);
            } catch (e2) {
              reject(e2);
              return;
            }
          }
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(tempFile); } catch {}
        reject(err);
      });
    });
  }

  /** 不带进度的下载：直接复用带锁的下载路径，避免两套临时文件逻辑各自为政。 */
  private async downloadFile(url: string, destFile: string): Promise<void> {
    return this.downloadFileWithProgress(url, destFile);
  }

  /**
   * 处理代理请求
   */
  private handleProxy(req: http.IncomingMessage, res: http.ServerResponse): void {
    const query = url.parse(req.url || '', true).query;
    const targetUrl = query.url as string;

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing url parameter' }));
      return;
    }

    if (targetUrl.startsWith('http://127.0.0.1:8765') || targetUrl.startsWith('http://localhost:8765')) {
      const localPath = targetUrl.replace(/^https?:\/\/127\.0\.0\.1:8765/, '').replace(/^https?:\/\/localhost:8765/, '');
      console.log(`[AssetServer] Proxy target is local, serving directly: ${localPath}`);
      this.serveStatic(localPath, res);
      return;
    }

    console.log(`[AssetServer] Proxy -> ${targetUrl}`);

    const client = targetUrl.startsWith('https') ? https : http;

    const urlObj = new URL(targetUrl);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: req.method,
      headers: {} as Record<string, string>,
    };

    const userAgent = req.headers['x-user-agent'] || req.headers['user-agent'];
    if (userAgent) (options.headers as Record<string, string>)['User-Agent'] = userAgent as string;

    const referer = req.headers['x-referer'] || req.headers['referer'];
    if (referer) (options.headers as Record<string, string>)['Referer'] = referer as string;

    const cookie = req.headers['x-cookie'] || req.headers['cookie'];
    if (cookie) (options.headers as Record<string, string>)['Cookie'] = cookie as string;

    const contentType = req.headers['content-type'];
    if (contentType) (options.headers as Record<string, string>)['Content-Type'] = contentType as string;

    // 透传其他自定义请求头（签名头等，如 AppKey, CheckSum, accesstoken, Nonce, timestamp 等）
    const passthroughHeaders = [
      'appkey', 'checksum', 'accesstoken', 'nonce', 'curtime',
      'timestamp', 'usertoken', 'version', 'platform', 'uuid',
      'accept', 'accept-language', 'authorization',
    ];
    for (const h of passthroughHeaders) {
      const value = req.headers[h];
      if (value) (options.headers as Record<string, string>)[h] = value as string;
    }

    const proxyReq = client.request(options, (proxyRes) => {
      const headers: Record<string, string> = {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': 'X-Set-Cookie',
      };

      const setCookies = proxyRes.headers['set-cookie'];
      if (setCookies) {
        headers['X-Set-Cookie'] = setCookies.join('; ');
      }

      res.writeHead(proxyRes.statusCode || 200, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[AssetServer] Proxy error:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy_failed' }));
      } else {
        res.end();
      }
    });

    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  }

  /**
   * 检查并更新版本，然后预下载核心资源
   */
  async checkAndUpdateVersion(progressCallback?: (stage: string, progress: number) => void): Promise<boolean> {
    const flagFile = path.join(app.getPath('userData'), 'allow-upgrade.txt');
    const hasUpgradeFlag = fs.existsSync(flagFile);

    if (hasUpgradeFlag) {
      fs.unlinkSync(flagFile);
      console.log('[AssetServer] Upgrade flag found, checking version...');
    } else {
      console.log('[AssetServer] No upgrade flag, checking if resources exist...');
    }

    // 阶段1：版本检查 + 缓存清理（仅升级标记触发）
    let versionChanged = false;
    let remoteVersion: string | null = null;

    if (hasUpgradeFlag) {
      progressCallback?.('检查版本更新', 5);

      const localVersion = this.versionManager.readLocalVersion();
      
      try {
        remoteVersion = await this.versionManager.fetchRemoteVersion();
      } catch (err) {
        console.warn('[AssetServer] Failed to fetch remote version:', err);
      }

      console.log(`[AssetServer] Local version: ${localVersion}, Remote version: ${remoteVersion}`);

      versionChanged = localVersion !== remoteVersion;

      if (versionChanged) {
        console.log("[AssetServer] Version changed, clearing cache (preserving models/*.gz)");
        
        let deletedCount = 0;
        let preservedCount = 0;
        
        if (fs.existsSync(this.cacheDir)) {
          deletedCount = this.deleteFilesRecursively(this.cacheDir, this.cacheDir, (relativePath: string) => {
            const shouldPreserve = relativePath.replace(/\\/g, "/").startsWith("models/") && relativePath.endsWith(".gz");
            if (shouldPreserve) {
              console.log(`[AssetServer] Preserving: ${relativePath}`);
              preservedCount++;
            }
            return !shouldPreserve;
          });
          
          console.log(`[AssetServer] Cache cleared: deleted ${deletedCount} files, preserved ${preservedCount} files`);
        }
      } else {
        console.log('[AssetServer] Version up to date');
      }
    }

    // 阶段2：预下载资源
    // - 有升级标记：必须预下载
    // - 无升级标记：检查资源是否存在，不存在才预下载
    const needPreload = hasUpgradeFlag || !this.hasCoreResources();

    if (needPreload) {
      console.log('[AssetServer] Preloading resources...');
      await this.preloadCoreAssets(progressCallback);

      // 预下载成功后，保存版本号
      if (versionChanged && remoteVersion) {
        console.log(`[AssetServer] Preload success, saving new version: ${remoteVersion}`);
        this.versionManager.saveLocalVersion(remoteVersion);
      }
    } else {
      console.log('[AssetServer] Resources already exist, skipping preload');
      progressCallback?.('资源已就绪', 100);
    }

    return versionChanged;
  }

  /**
   * 递归删除文件（保留符合条件的文件）
   */
  private deleteFilesRecursively(dir: string, baseDir: string, shouldDelete: (relativePath: string) => boolean): number {
    if (!fs.existsSync(dir)) return 0;
    
    let deletedCount = 0;
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        deletedCount += this.deleteFilesRecursively(fullPath, baseDir, shouldDelete);
        
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
          console.log(`[AssetServer] Removed empty directory: ${relativePath}`);
        }
      } else {
        if (shouldDelete(relativePath)) {
          try {
            fs.unlinkSync(fullPath);
            deletedCount++;
          } catch (err) {
            console.warn(`[AssetServer] Failed to delete: ${relativePath}`, err);
          }
        }
      }
    }
    
    return deletedCount;
  }

  /**
   * 检查核心资源是否存在
   */
  private hasCoreResources(): boolean {
    for (const resource of CORE_RESOURCES) {
      const filePath = path.join(this.cacheDir, resource);
      if (!fs.existsSync(filePath)) {
        console.log(`[AssetServer] Core resource missing: ${resource}`);
        return false;
      }
    }
    return true;
  }

  /**
   * 预下载核心资源
   * 
   * 下载 web-resources.zip 并解压到缓存目录
   */
  async preloadCoreAssets(progressCallback?: (stage: string, progress: number) => void): Promise<void> {
    console.log('[AssetServer] Preloading core assets from zip...');
    await this.preloadFromZip(progressCallback);
  }

  /**
   * 下载 web-resources.zip 并解压（带详细进度）
   */
  private async preloadFromZip(progressCallback?: (stage: string, progress: number) => void): Promise<void> {
    const zipUrl = `${this.remoteBase}/web-resources.zip`;
    const zipFile = path.join(this.cacheDir, 'web-resources.zip.tmp');

    try {
      // 阶段1：下载 zip（带进度）
      await this.downloadZipWithProgress(zipUrl, zipFile, progressCallback);

      const zipSize = fs.statSync(zipFile).size;
      console.log(`[AssetServer] Downloaded web-resources.zip: ${formatMB(zipSize)}MB`);

      // 阶段2：解压（纯 JS，不调用外部命令）
      await this.extractZip(zipFile, progressCallback);

      console.log('[AssetServer] Extracted web-resources.zip');
      progressCallback?.('准备就绪', 100);

    } catch (err) {
      console.warn('[AssetServer] Failed to preload from zip:', err);
      progressCallback?.('资源加载失败', 100);
      throw err;
    } finally {
      // 清理临时 zip 文件
      try {
        if (fs.existsSync(zipFile)) {
          fs.unlinkSync(zipFile);
        }
      } catch {}
    }
  }

  /**
   * 下载 zip 文件并报告进度
   */
  private async downloadZipWithProgress(
    zipUrl: string,
    destFile: string,
    progressCallback?: (stage: string, progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = zipUrl.startsWith('https') ? https : http;
      // 唯一临时名：即便预加载被并发触发，也不会与另一路写同一份临时文件
      const tempFile = `${destFile}.${process.pid}.${randomUUID()}.downloading`;
      const file = fs.createWriteStream(tempFile);

      client.get(zipUrl, { headers: { 'Accept-Encoding': 'identity' } }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const location = response.headers.location;
          if (location) {
            file.close();
            fs.unlinkSync(tempFile);
            const fullUrl = location.startsWith('http') ? location : new URL(location, zipUrl).toString();
            this.downloadZipWithProgress(fullUrl, destFile, progressCallback).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(tempFile); } catch {}
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        const totalMB = totalBytes > 0 ? formatMB(totalBytes) : '?';

        let loadedBytes = 0;
        let lastReportTime = Date.now();

        response.on('data', (chunk: Buffer) => {
          loadedBytes += chunk.length;

          // 每 300ms 报告一次进度
          const now = Date.now();
          if (now - lastReportTime >= 300) {
            const loadedMB = formatMB(loadedBytes);
            const progress = totalBytes > 0 ? 5 + Math.round((loadedBytes / totalBytes) * 40) : 5;
            progressCallback?.(`下载资源包 (${loadedMB} / ${totalMB} MB)`, progress);
            lastReportTime = now;
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();

          // 最终进度
          const loadedMB = formatMB(loadedBytes);
          progressCallback?.(`下载资源包 (${loadedMB} / ${totalMB} MB)`, 45);

          // 重命名到正式文件
          try {
            fs.renameSync(tempFile, destFile);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(tempFile); } catch {}
        reject(err);
      });
    });
  }

  /**
   * 解压 zip 文件（纯 JS，使用 adm-zip）
   */
  private async extractZip(zipFile: string, progressCallback?: (stage: string, progress: number) => void): Promise<void> {
    progressCallback?.('解压资源', 50);

    return new Promise((resolve, reject) => {
      try {
        const zip = new AdmZip(zipFile);
        const zipEntries = zip.getEntries();
        const totalEntries = zipEntries.length;

        let extractedCount = 0;

        for (const entry of zipEntries) {
          const entryPath = entry.entryName;
          const destPath = path.join(this.cacheDir, entryPath);

          // 安全检查：防止 zip slip
          const normalizedDest = path.resolve(destPath);
          if (!normalizedDest.startsWith(path.resolve(this.cacheDir))) {
            console.warn(`[AssetServer] Zip slip detected, skipping: ${entryPath}`);
            continue;
          }

          if (entry.isDirectory) {
            // 创建目录
            fs.mkdirSync(destPath, { recursive: true });
          } else {
            // 确保父目录存在
            fs.mkdirSync(path.dirname(destPath), { recursive: true });

            // 解压文件
            zip.extractEntryTo(entry, path.dirname(destPath), false, true);
            extractedCount++;
          }

          const progress = 50 + Math.round((extractedCount / totalEntries) * 45);
          progressCallback?.(`解压资源 (${extractedCount}/${totalEntries})`, progress);
        }

        console.log(`[AssetServer] Extracted ${extractedCount} files`);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(AppConfig.localPort, AppConfig.localHost, () => {
        console.log(`[AssetServer] Server running at ${AppConfig.localServerUrl}`);
        console.log(`[AssetServer] Cache directory: ${this.cacheDir}`);
        console.log(`[AssetServer] Remote base: ${this.remoteBase}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  /**
   * 停止服务器
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      console.log('[AssetServer] Server stopped');
    }
  }

  /**
   * 获取 MIME 类型
   */
  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return MIME_TYPES[ext] || 'application/octet-stream';
  }
}
