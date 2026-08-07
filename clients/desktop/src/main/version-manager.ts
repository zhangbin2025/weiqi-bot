/**
 * 版本管理器
 * 
 * 对等 Android VersionManager
 * 负责检查远程版本、读取和保存本地版本
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { app } from 'electron';
import { AppConfig } from './config';

export class VersionManager {
  private versionFile: string;

  constructor() {
    // 版本号存储在 userData 目录
    this.versionFile = path.join(app.getPath('userData'), 'version.txt');
  }

  /**
   * 从远程获取版本号
   */
  async fetchRemoteVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(AppConfig.versionUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch version: ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.version);
          } catch (err) {
            reject(new Error(`Invalid version JSON: ${data}`));
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 读取本地版本号
   */
  readLocalVersion(): string | null {
    if (fs.existsSync(this.versionFile)) {
      return fs.readFileSync(this.versionFile, 'utf-8').trim();
    }
    return null;
  }

  /**
   * 保存本地版本号
   */
  saveLocalVersion(version: string): void {
    fs.writeFileSync(this.versionFile, version, 'utf-8');
    console.log(`[VersionManager] Saved version: ${version}`);
  }
}