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
const AdmZip = require('adm-zip');

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

    if (fs.existsSync(cachedFile)) {
      console.log(`[AssetServer] Cache hit: ${filePath}`);
      this.serveFile(cachedFile, res);
      return;
    }

    console.log(`[AssetServer] Cache miss: ${filePath}, downloading...`);
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

  /**
   * 从远程下载并返回
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
        if (!res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(`404 Not Found: ${filePath}`);
        } else {
          res.end();
        }
      });
  }

  /**
   * 带进度的下载文件
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
      const tempFile = destFile + '.downloading';
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
          fs.unlinkSync(tempFile);
          reject(new Error(`HTTP ${response.statusCode}`));
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
