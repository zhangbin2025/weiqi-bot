/**
 * fetch 命令 — 棋谱下载与浏览
 * @module clients/cli/commands/fetch
 */

import * as fs from "fs";
import * as path from "path";
import type { CliContext } from "../bootstrap";
import type { CliResult } from "../utils";

const FETCH_HELP = `
usage: fetch <command> [options]

棋谱下载与浏览

commands:
  download <url>        下载棋谱（支持野狐、OGS、手谈、弈城等）
  history               查看下载历史
  get <archiveId>       按归档 ID 获取已缓存的 SGF
  browse [source]       浏览每日最新棋谱

browse options:
  --source SOURCE       来源: foxwq | weiqi101 | ogs-live | all (default: all)
  --count N             数量 (default: 20)
  --keyword KW          关键词筛选（如棋手名）

options:
  --format FORMAT       输出格式: json | text (default: json)
  --debug               显示网络请求调试日志

examples:
  fetch download https://www.foxwq.com/qipu/share/xxx.html
  fetch history
  fetch get abc123
  fetch browse                          # 浏览所有来源最新棋谱
  fetch browse --source foxwq           # 只看野狐最新棋谱
  fetch browse --source weiqi101        # 只看101死活题
  fetch browse --source ogs-live        # 只看OGS在线对局
  fetch browse --source foxwq --count 10
  fetch browse --keyword 柯洁           # 按关键词筛选
`;

export async function runFetchCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  const subCommand = args[0] ?? "";

  switch (subCommand) {
    case "download": {
      const url = args[1];
      if (!url || url.startsWith("--")) {
        return { ok: false, command: "fetch", error: "请提供棋谱 URL，如: fetch download https://www.foxwq.com/qipu/share/xxx.html" };
      }
      return fetchDownload(url, ctx);
    }
    case "history": {
      return fetchHistory(ctx);
    }
    case "get": {
      const archiveId = args[1];
      if (!archiveId || archiveId.startsWith("--")) {
        return { ok: false, command: "fetch", error: "请提供归档 ID，如: fetch get abc123" };
      }
      return fetchGet(archiveId, ctx);
    }
    case "browse": {
      return fetchBrowse(args.slice(1), ctx);
    }
    case "help":
    case "--help":
    case "-h":
      return { ok: true, command: "fetch-help", data: FETCH_HELP };
    default:
      return { ok: false, command: "fetch", error: `未知子命令: ${subCommand}\n${FETCH_HELP}` };
  }
}

async function fetchDownload(url: string, ctx: CliContext): Promise<CliResult> {
  try {
    const result = await ctx.gameService.fetch(url);

    if (!result.success) {
      return { ok: false, command: "fetch", error: `下载失败: ${result.error ?? "未知错误"}` };
    }

    // 将 SGF 写入文件
    const gameDir = path.join(ctx.dataDir, "game");
    const sgfPath = path.join(gameDir, `${result.archiveId}.sgf`);
    if (result.sgfContent) {
      fs.writeFileSync(sgfPath, result.sgfContent, "utf-8");
    }

    return {
      ok: true,
      command: "fetch-download",
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
    return { ok: false, command: "fetch", error: `下载异常: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function fetchHistory(ctx: CliContext): Promise<CliResult> {
  try {
    const historyStorage = (ctx.gameService as any).historyStorage;
    if (!historyStorage) {
      return { ok: false, command: "fetch", error: "历史存储不可用" };
    }

    const index = await historyStorage.getIndex();
    const entries = Object.values(index?.entries ?? {});

    return {
      ok: true,
      command: "fetch-history",
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
    return { ok: false, command: "fetch", error: `查询历史失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function fetchGet(archiveId: string, ctx: CliContext): Promise<CliResult> {
  try {
    const sgfContent = await ctx.gameService.getByArchiveId(archiveId);
    if (!sgfContent) {
      return { ok: false, command: "fetch", error: `归档 ${archiveId} 不存在` };
    }

    return {
      ok: true,
      command: "fetch-get",
      data: {
        archiveId,
        sgfContent,
      },
    };
  } catch (e) {
    return { ok: false, command: "fetch", error: `获取归档失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 解析 browse 子命令参数 */
function parseBrowseArgs(args: string[]): { source: string; count: number; keyword?: string } {
  let source = "all";
  let count = 20;
  let keyword: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source" && args[i + 1]) {
      source = args[++i];
    } else if (arg === "--count" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!isNaN(n) && n > 0) count = n;
    } else if (arg === "--keyword" && args[i + 1]) {
      keyword = args[++i];
    } else if (!arg.startsWith("--")) {
      // 位置参数：第一个非 flag 当作 source
      source = arg;
    }
  }

  return { source, count, keyword };
}

async function fetchBrowse(args: string[], ctx: CliContext): Promise<CliResult> {
  const { source, count, keyword } = parseBrowseArgs(args);

  const sources = source === "all" ? ["foxwq", "weiqi101", "ogs-live"] : [source];
  const allItems: Array<{ source: string; title: string; subtitle?: string; date: string; url: string }> = [];

  for (const src of sources) {
    try {
      const items = await ctx.fetcherApp.fetchLatestGames(src, count, keyword);
      allItems.push(...items);
    } catch (e) {
      // 单个来源失败不影响其他来源
      process.stderr.write(`[browse] ${src} 获取失败: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  return {
    ok: true,
    command: "fetch-browse",
    data: {
      total: allItems.length,
      sources: sources,
      keyword: keyword ?? null,
      items: allItems,
    },
  };
}
