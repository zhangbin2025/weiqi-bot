/**
 * 定式自动构建状态管理
 * @module infrastructure/storage/JosekiAutoState
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AutoStateData {
  mode: 'auto';
  config: {
    cmsWidth: number;
    cmsDepth: number;
    firstN: number;
    minFreq: number;
    globalTopK: number;
    rebuildThresholdDays: number;
  };
}

export function getAdaptiveCMSConfig(estimatedGames: number): { width: number; depth: number } {
  if (estimatedGames < 100_000) {
    return { width: 1_048_576, depth: 4 };
  } else if (estimatedGames < 1_000_000) {
    return { width: 4_194_304, depth: 4 };
  } else {
    return { width: 16_777_216, depth: 4 };
  }
}

export class JosekiAutoState {
  private stateFile: string;

  constructor(private autoDir: string) {
    this.stateFile = path.join(autoDir, 'state.json');
  }

  load(): AutoStateData {
    if (fs.existsSync(this.stateFile)) {
      try {
        const content = fs.readFileSync(this.stateFile, 'utf-8');
        return JSON.parse(content);
      } catch {}
    }
    return this.emptyState();
  }

  save(data: AutoStateData): void {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  private emptyState(): AutoStateData {
    return {
      mode: 'auto',
      config: {
        cmsWidth: 4_194_304,
        cmsDepth: 4,
        firstN: 80,
        minFreq: 10,
        globalTopK: 100_000,
        rebuildThresholdDays: 0,
      },
    };
  }

  reset(): void {
    if (fs.existsSync(this.stateFile)) {
      fs.unlinkSync(this.stateFile);
    }
    if (fs.existsSync(this.autoDir)) {
      const files = fs.readdirSync(this.autoDir);
      for (const file of files) {
        const filePath = path.join(this.autoDir, file);
        try {
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          } else {
            fs.rmSync(filePath, { recursive: true, force: true });
          }
        } catch {}
      }
    }
  }

  getCMSPath(): string {
    return path.join(this.autoDir, 'cms.json');
  }

  getTempDir(): string {
    return path.join(this.autoDir, 'temp');
  }

  ensureDirs(): void {
    if (!fs.existsSync(this.autoDir)) {
      fs.mkdirSync(this.autoDir, { recursive: true });
    }
    const tempDir = this.getTempDir();
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  }
}
