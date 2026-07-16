/**
 * 应用配置
 * 
 * 对等 Android AppConfig
 */

import { app } from 'electron';
import * as path from 'path';

export const AppConfig = {
  localHost: '127.0.0.1',
  localPort: 8765,
  
  get localServerUrl() {
    return `http://${this.localHost}:${this.localPort}`;
  },
  
  get homeUrl() {
    return `${this.localServerUrl}/index.html`;
  },
  
  remoteBase: 'https://bot.weiqi.lol',
  
  versionUrl: 'https://bot.weiqi.lol/version.json',
  
  get dataDir() {
    return path.join(app.getPath('userData'), 'data');
  },
  
  get tasksFile() {
    return path.join(this.dataDir, 'tasks.json');
  },
  
  get schedulesFile() {
    return path.join(this.dataDir, 'schedules.json');
  },
  
  get katagoDir() {
    return path.join(this.dataDir, 'katago');
  },
  
  localPageUrl(pagePath: string): string {
    const normalized = pagePath.replace(/^\//, '');
    return `${this.localServerUrl}/${normalized}`;
  },
  
  remoteUrl(resourcePath: string): string {
    const normalized = resourcePath.replace(/^\//, '');
    return `${this.remoteBase}/${normalized}`;
  },
};
