/**
 * fetch 命令 — 棋谱下载
 * @module clients/cli/commands/fetch
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';

const FETCH_HELP = `
usage: fetch <command> [options]

棋谱下载

commands:
  download <url>    下载棋谱（支持野狐、OGS、手谈、弈城等）
  history           查看下载历史
  get <archiveId>   按归档 ID 获取已缓存的 SGF

options:
  --format FORMAT   输出格式: json | text (default: json)
  --debug           显示网络请求调试日志

examples:
  fetch download https://www.foxwq.com/qipu/share/xxx.html
  fetch history
  fetch get abc123
`;

export async function runFetchCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  const subCommand = args[0] ?? '';

  switch (subCommand) {
    case 'download': {
      const url = args[1];
      if (!url || url.startsWith('--')) {
        return { ok: false, command: 'fetch', error: '请提供棋谱 URL，如: fetch download https://www.foxwq.com/qipu/share/xxx.html' };
      }
      return fetchDownload(url, ctx);
    }
    case 'history': {
      return fetchHistory(ctx);
    }
    case 'get': {
      const archiveId = args[1];
      if (!archiveId || archiveId.startsWith('--')) {
        return { ok: false, command: 'fetch', error: '请提供归档 ID，如: fetch get abc123' };
      }
      return fetchGet(archiveId, ctx);
    }
    case 'help':
    case '--help':
    case '-h':
      return { ok: true, command: 'fetch-help', data: FETCH_HELP };
    default:
      return { ok: false, command: 'fetch', error: `未知子命令: ${subCommand}\n${FETCH_HELP}` };
  }
}

async function fetchDownload(url: string, ctx: CliContext): Promise<CliResult> {
  try {
    const result = await ctx.gameService.fetch(url);

    if (!result.success) {
      return { ok: false, command: 'fetch', error: `下载失败: ${result.error ?? '未知错误'}` };
    }

    // 将 SGF 写入文件
    const gameDir = path.join(ctx.dataDir, 'game');
    const sgfPath = path.join(gameDir, `${result.archiveId}.sgf`);
    if (result.sgfContent) {
      fs.writeFileSync(sgfPath, result.sgfContent, 'utf-8');
    }

    return {
      ok: true,
      command: 'fetch-download',
      data: {
        archiveId: result.archiveId,
        source: result.source,
        url: result.url,
        fromCache: result.fromCache,
        sgfPath: result.sgfContent ? sgfPath : null,
        metadata: result.metadata,
      },
    };
  } catch (e) {
    return { ok: false, command: 'fetch', error: `下载异常: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function fetchHistory(ctx: CliContext): Promise<CliResult> {
  try {
    const historyStorage = (ctx.gameService as any).historyStorage;
    if (!historyStorage) {
      return { ok: false, command: 'fetch', error: '历史存储不可用' };
    }

    const index = await historyStorage.getIndex();
    const entries = Object.values(index?.entries ?? {});

    return {
      ok: true,
      command: 'fetch-history',
      data: {
        total: entries.length,
        entries: entries.slice(0, 50).map((e: any) => ({
          archiveId: e.archiveId,
          gameId: e.gameId,
          black: e.black,
          white: e.white,
          date: e.date,
          result: e.result,
          source: e.source,
        })),
      },
    };
  } catch (e) {
    return { ok: false, command: 'fetch', error: `查询历史失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function fetchGet(archiveId: string, ctx: CliContext): Promise<CliResult> {
  try {
    const sgfContent = await ctx.gameService.getByArchiveId(archiveId);
    if (!sgfContent) {
      return { ok: false, command: 'fetch', error: `归档 ${archiveId} 不存在` };
    }

    return {
      ok: true,
      command: 'fetch-get',
      data: {
        archiveId,
        sgfContent,
      },
    };
  } catch (e) {
    return { ok: false, command: 'fetch', error: `获取归档失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}
