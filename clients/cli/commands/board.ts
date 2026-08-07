/**
 * board render 命令
 * @module clients/cli/commands/board
 */

import * as fs from 'fs';
import { SGFParser, coordToPos } from '../../../domain/sgf/SGFParser';
import { Board } from '../../../domain/board/Board';
import { CaptureRule } from '../../../domain/rules/CaptureRule';
import { TextBoardRenderer } from '../../../presentation/adapters/cli/components/TextBoardRenderer';
import { TextBoardThumbnail } from '../../../presentation/adapters/cli/components/TextBoardThumbnail';
import type { CliResult } from '../utils';

/** 顶层帮助 */
const BOARD_HELP = `
usage: board <command> [options]

SGF 棋谱解析与棋盘渲染

commands:
  render            解析 SGF 并渲染棋盘

global options:
  --format FORMAT   输出格式: json | text (default: json)
  --debug           显示网络请求调试日志

examples:
  board render --sgf "(;GM[1]FF[4]SZ[19];B[pd];W[dd])"
  board render --file game.sgf --format text
`;

/** render 子命令帮助 */
const RENDER_HELP = `
usage: board render (--sgf SGF | --file FILE)

解析 SGF 并渲染文本棋盘

required arguments:
  --sgf SGF         SGF 字符串（二选一）
  --file FILE       SGF 文件路径（二选一）

options:
  --format FORMAT   输出格式: json | text (default: json)
  --debug           显示网络请求调试日志

examples:
  board render --sgf "(;GM[1]FF[4]SZ[19];B[pd];W[dd])"
  board render --file game.sgf --format text
`;

interface BoardRenderOptions {
  sgf?: string;
  file?: string;
}

/** 解析命令行参数 */
function parseArgs(args: string[]): BoardRenderOptions {
  const opts: BoardRenderOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sgf' && args[i + 1]) {
      opts.sgf = args[++i];
    } else if (args[i] === '--file' && args[i + 1]) {
      opts.file = args[++i];
    }
  }
  return opts;
}

/** 执行 board 命令 */
export function runBoardCommand(subArgs: string[]): CliResult {
  const subCommand = subArgs[0];

  // 处理顶层帮助
  if (!subCommand || subCommand === 'help' || subCommand === '--help' || subCommand === '-h') {
    return { ok: true, command: 'board-help', data: BOARD_HELP };
  }

  if (subCommand === 'render') {
    return runBoardRender(subArgs.slice(1));
  }

  return { ok: false, command: 'board', error: `未知 board 子命令: ${subCommand}\n${BOARD_HELP}` };
}

/** 执行 board render */
function runBoardRender(args: string[]): CliResult {
  // 检查 --help
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: true, command: 'board-help', data: RENDER_HELP };
  }

  const opts = parseArgs(args);

  let sgfText: string | undefined;

  if (opts.file) {
    try {
      sgfText = fs.readFileSync(opts.file, 'utf-8');
    } catch (_e) {
      return { ok: false, command: 'board', error: `无法读取文件: ${opts.file}` };
    }
  } else if (opts.sgf) {
    sgfText = opts.sgf;
  } else {
    return { ok: false, command: 'board', error: '请提供 --sgf <SGF字符串> 或 --file <文件路径>' };
  }

  // 解析 SGF
  const parser = new SGFParser();
  const result = parser.parse(sgfText);
  if (result.errors.length > 0 && result.moves.length === 0) {
    return { ok: false, command: 'board', error: `SGF 解析失败: ${result.errors.join('; ')}` };
  }

  const size = result.gameInfo.boardSize;
  const board = new Board(size);
  const captureRule = new CaptureRule();

  // 放置让子
  for (const hs of result.gameInfo.handicapStones) {
    const color = hs.color === 'B' ? 'black' as const : 'white' as const;
    board.setStone(hs.x, hs.y, color);
  }

  // 按主变化落子
  let lastMovePos: { x: number; y: number } | undefined;
  for (const move of result.moves) {
    const pos = coordToPos(move.coord);
    if (!pos) continue;

    const color = move.color === 'B' ? 'black' as const : 'white' as const;
    board.setStone(pos.x, pos.y, color);

    // 提子
    const capResult = captureRule.capture(board, pos.x, pos.y, color);
    for (const cap of capResult.captured) {
      board.setStone(cap.x, cap.y, null);
    }

    lastMovePos = { x: pos.x, y: pos.y };
  }

  // 渲染
  const fullBoard = TextBoardRenderer.render(board, {
    size,
    lastMove: lastMovePos,
  });
  const thumbnail = TextBoardThumbnail.renderThumbnail(board, { size, lastMove: lastMovePos });
  const compact = TextBoardThumbnail.renderCompact(board);

  return {
    ok: true,
    command: 'board',
    data: {
      size,
      moveCount: result.moves.length,
      gameInfo: {
        black: result.gameInfo.black,
        white: result.gameInfo.white,
        result: result.gameInfo.result,
      },
      board: fullBoard,
      thumbnail: thumbnail.text,
      compact,
    },
  };
}