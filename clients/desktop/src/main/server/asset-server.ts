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
import { AppConfig } from '../config';
import { VersionManager } from '../version-manager';

/**
 * MIME 类型映射（对齐 Android MimeTypeHelper）
 */
const MIME_TYPES: Record<string, string> = {
  'html': 'text/html',
  'htm': 'text/html',
  'css': 'text/css',
  'js': 'application/javascript',
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

export class AssetServer {
  private server: http.Server | null = null;
  private cacheDir: string;
  private remoteBase: string;
  private versionManager: VersionManager;

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
    // 原因：ProxyProvider 把相对路径 ../xxx 错误转换成 /proxy../xxx
    if (uri.startsWith('/proxy../') || uri.startsWith('/proxy./') || uri.startsWith('/proxy/..')) {
      // 提取实际路径：/proxy../shared/... → /shared/...
      const actualPath = uri.replace(/^\/proxy\.\./, '').replace(/^\/proxy\/\.\./, '').replace(/^\/proxy\//, '');
      console.log(`[AssetServer] Redirect ${uri} -> ${actualPath}`);
      this.serveStatic(actualPath, res);
      return;
    }

    // /proxy 反向代理路由（对齐 Android）
    // 匹配: /proxy、/proxy/、/proxy?xxx、/proxy/?xxx
    if (uri === '/proxy' || uri === '/proxy/' || reqUrl.includes('/proxy?') || reqUrl.includes('/proxy/?')) {
      console.log(`[AssetServer] Routing to handleProxy`);
      this.handleProxy(req, res);
      return;
    }

    // 兼容 ProxyProvider 的 bug：把相对路径转换成 /proxy/xxx 而不是 /proxy/?url=xxx
    // 例如：/proxy/katago/analysis.cfg → 实际需要的是 /katago/analysis.cfg
    if (uri.startsWith('/proxy/') && !uri.includes('?')) {
      const actualPath = uri.substring(7);  // 去掉 "/proxy/" 前缀
      console.log(`[AssetServer] Fixing ProxyProvider bug: ${uri} -> ${actualPath}`);
      this.serveStatic(actualPath, res);
      return;
    }

    // CORS 预检请求（对所有路由）
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
    // 移除开头的斜杠
    let filePath = uri.startsWith('/') ? uri.substring(1) : uri;

    // 安全检查：拒绝包含 .. 的路径，避免目录穿越攻击
    if (filePath.includes('..')) {
      console.error(`[AssetServer] Invalid path with .. : ${filePath}`);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid path');
      return;
    }

    console.log(`[AssetServer] serveStatic: uri=${uri}, filePath=${filePath}`);

    // 默认首页
    if (filePath === '' || filePath === 'index.html') {
      filePath = 'index.html';
    }

    // 目录路径自动补 index.html
    if (filePath.endsWith('/')) {
      filePath += 'index.html';
    }

    // 无扩展名的路径可能是目录，尝试补 index.html
    if (!path.extname(filePath)) {
      const indexPath = path.join(this.cacheDir, filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        filePath = filePath + '/index.html';
      }
    }

    const cachedFile = path.join(this.cacheDir, filePath);
    console.log(`[AssetServer] cachedFile path: ${cachedFile}`);

    // 缓存命中
    if (fs.existsSync(cachedFile)) {
      console.log(`[AssetServer] Cache hit: ${filePath}`);
      this.serveFile(cachedFile, res);
      return;
    }

    // 缓存未命中，从远程下载
    console.log(`[AssetServer] Cache miss: ${filePath}, downloading...`);
    this.downloadAndServe(filePath, res);
  }

  /**
   * 提供静态文件（对齐 Android FileServer.serveFile）
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

  /**
   * 从远程下载并返回（对齐 Android FileServer.downloadFile）
   */
  private downloadAndServe(filePath: string, res: http.ServerResponse): void {
    const remoteUrl = `${this.remoteBase}/${filePath}`;
    const cachedFile = path.join(this.cacheDir, filePath);
    
    const filename = path.basename(filePath);
    this.onDemandCallback?.onDownloadStart(filename, -1);

    this.downloadFileWithProgress(remoteUrl, cachedFile, (loaded, total) => {
      this.onDemandCallback?.onDownloadProgress(filename, loaded, total);
    })
      .then(() => {
        this.onDemandCallback?.onDownloadComplete(filename);
        this.serveFile(cachedFile, res);
      })
      .catch((err) => {
        console.error(`[AssetServer] Download failed:`, err);
        this.onDemandCallback?.onDownloadComplete(filename);
        // 检查响应是否已经发送
        if (!res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(`404 Not Found: ${filePath}`);
        } else {
          res.end();
        }
      });
  }

  /**
   * 下载文件（对齐 Android FileServer.downloadFile）
   */
  /**
   * 带进度的下载文件（对齐 Android FileServer.downloadFile）
   */
  private async downloadFileWithProgress(
    url: string, 
    destFile: string, 
    progressCallback?: (loaded: number, total: number) => void
  ): Promise<void> {
    const parentDir = path.dirname(destFile);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const tempFile = destFile + '.tmp';
      const file = fs.createWriteStream(tempFile);
      let loadedBytes = 0;
      let totalBytes = 0;

      client.get(url, { headers: { 'Accept-Encoding': 'identity' } }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const location = response.headers.location;
          if (location) {
            file.close();
            fs.unlinkSync(tempFile);
            const fullUrl = location.startsWith('http') ? location : new URL(location, url).toString();
            this.downloadFileWithProgress(fullUrl, destFile, progressCallback).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(tempFile);
          reject(new Error());
          return;
        }

        // 获取文件总大小
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
          fs.renameSync(tempFile, destFile);
          console.log();
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(tempFile); } catch {}
        reject(err);
      });
    });
  }

  private async downloadFile(url: string, destFile: string): Promise<void> {
    const parentDir = path.dirname(destFile);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const tempFile = destFile + '.tmp';
      const file = fs.createWriteStream(tempFile);

      client.get(url, { headers: { 'Accept-Encoding': 'identity' } }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          const location = response.headers.location;
          if (location) {
            file.close();
            fs.unlinkSync(tempFile);
            const fullUrl = location.startsWith('http') ? location : new URL(location, url).toString();
            this.downloadFile(fullUrl, destFile).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(tempFile);
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          fs.renameSync(tempFile, destFile);
          console.log(`[AssetServer] Downloaded: ${destFile}`);
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(tempFile); } catch {}
        reject(err);
      });
    });
  }

  /**
   * 处理代理请求（对齐 Android ProxyHandler.handleProxy）
   */
  private handleProxy(req: http.IncomingMessage, res: http.ServerResponse): void {
    const query = url.parse(req.url || '', true).query;
    const targetUrl = query.url as string;

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing url parameter' }));
      return;
    }

    // 如果目标 URL 是本地 AssetServer，直接从缓存读取（不走代理）
    // 避免文件被保存到错误的路径（web/proxy/xxx 而不是 web/xxx）
    if (targetUrl.startsWith('http://127.0.0.1:8765') || targetUrl.startsWith('http://localhost:8765')) {
      const localPath = targetUrl.replace(/^https?:\/\/127\.0\.0\.1:8765/, '').replace(/^https?:\/\/localhost:8765/, '');
      console.log(`[AssetServer] Proxy target is local, serving directly: ${localPath}`);
      this.serveStatic(localPath, res);
      return;
    }

    console.log(`[AssetServer] Proxy -> ${targetUrl}`);

    const client = targetUrl.startsWith('https') ? https : http;

    // 构建请求选项
    const urlObj = new URL(targetUrl);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: req.method,
      headers: {} as Record<string, string>,
    };

    // 透传请求头（优先使用 x- 前缀的自定义头）
    const userAgent = req.headers['x-user-agent'] || req.headers['user-agent'];
    if (userAgent) (options.headers as Record<string, string>)['User-Agent'] = userAgent as string;

    const referer = req.headers['x-referer'] || req.headers['referer'];
    if (referer) (options.headers as Record<string, string>)['Referer'] = referer as string;

    const cookie = req.headers['x-cookie'] || req.headers['cookie'];
    if (cookie) (options.headers as Record<string, string>)['Cookie'] = cookie as string;

    const contentType = req.headers['content-type'];
    if (contentType) (options.headers as Record<string, string>)['Content-Type'] = contentType as string;

    // 发起代理请求
    const proxyReq = client.request(options, (proxyRes) => {
      const headers: Record<string, string> = {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': 'X-Set-Cookie',
      };

      // 透传 Set-Cookie（改名为 X-Set-Cookie）
      const setCookies = proxyRes.headers['set-cookie'];
      if (setCookies) {
        headers['X-Set-Cookie'] = setCookies.join('; ');
      }

      res.writeHead(proxyRes.statusCode || 200, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[AssetServer] Proxy error:`, err);
      // 检查响应是否已经发送，避免 ERR_HTTP_HEADERS_SENT 错误
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy_failed' }));
      } else {
        // 如果响应头已发送，只能直接结束响应
        res.end();
      }
    });

    // 对于 POST 请求，转发请求体
    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  }

  /**
   * 检查并更新版本，然后预下载核心资源（对齐 Android AssetServer.checkAndUpdateVersion）
   */
  async checkAndUpdateVersion(progressCallback?: (stage: string, progress: number) => void): Promise<boolean> {
    // 检查升级标记文件
    const flagFile = path.join(app.getPath('userData'), 'allow-upgrade.txt');
    if (!fs.existsSync(flagFile)) {
      console.log('[AssetServer] No upgrade flag, skipping version check');
      return false;
    }
    
    // 删除标记（一次性）
    fs.unlinkSync(flagFile);
    console.log('[AssetServer] Upgrade flag found, checking version...');
    
    console.log('[AssetServer] Checking version...');
    
    // 阶段1：检查版本
    progressCallback?.('检查版本更新', 5);

    const localVersion = this.versionManager.readLocalVersion();
    let remoteVersion: string;
    
    try {
      remoteVersion = await this.versionManager.fetchRemoteVersion();
    } catch (err) {
      console.warn('[AssetServer] Failed to fetch remote version, using cache:', err);
      // 无法获取远程版本，跳过版本检查，直接预下载核心资源
      await this.preloadCoreAssets(progressCallback);
      return false;
    }

    console.log(`[AssetServer] Local version: ${localVersion}, Remote version: ${remoteVersion}`);

    const versionChanged = localVersion !== remoteVersion;

    if (versionChanged) {
      console.log('[AssetServer] Version changed, clearing cache');
      
      // 列出删除前的文件
      const beforeFiles = this.listFilesRecursively(this.cacheDir);
      console.log(`[AssetServer] Cache files before clear: ${beforeFiles.length} files`);
      
      // 删除缓存目录
      if (fs.existsSync(this.cacheDir)) {
        fs.rmSync(this.cacheDir, { recursive: true, force: true });
      }
      
      // 重新创建缓存目录
      fs.mkdirSync(this.cacheDir, { recursive: true });
      
      console.log('[AssetServer] Cache cleared');
    } else {
      console.log('[AssetServer] Version up to date');
    }

    // 阶段2：预下载核心资源
    await this.preloadCoreAssets(progressCallback);

    // 阶段3：预下载成功后，保存版本号
    if (versionChanged) {
      console.log(`[AssetServer] Preload success, saving new version: ${remoteVersion}`);
      this.versionManager.saveLocalVersion(remoteVersion);
    }

    return versionChanged;
  }



  /**
   * 递归列出目录下所有文件
   */
  private listFilesRecursively(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    
    const files: string[] = [];
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...this.listFilesRecursively(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  /**
   * 预下载核心资源（对齐 Android FileServer.preloadCoreAssets）
   */
  async preloadCoreAssets(progressCallback?: (stage: string, progress: number) => void): Promise<void> {
    console.log('[AssetServer] Preloading core assets...');
    
    const coreAssets = ['index.html', 'assistant/index.html'];
    const total = coreAssets.length;
    
    for (let i = 0; i < total; i++) {
      const asset = coreAssets[i];
      const destFile = path.join(this.cacheDir, asset);
      
      if (!fs.existsSync(destFile)) {
        progressCallback?.('下载核心资源', Math.round((i / total) * 100));
        
        try {
          const remoteUrl = `${this.remoteBase}/${asset}`;
          await this.downloadFile(remoteUrl, destFile);
        } catch (error) {
          console.error(`[AssetServer] Failed to preload ${asset}:`, error);
        }
      }
    }

    progressCallback?.('核心资源准备完成', 100);
    console.log('[AssetServer] Core assets preloaded');
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
   * 获取 MIME 类型（对齐 Android MimeTypeHelper.getMimeType）
   */
  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return MIME_TYPES[ext] || 'application/octet-stream';
  }
}
