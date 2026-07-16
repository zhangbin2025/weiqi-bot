/**
 * joseki 命令（占位）
 * @module clients/cli/commands/joseki
 */

import type { CliResult } from '../utils';

/** 执行 joseki 命令 */
export function runJosekiCommand(_args: string[]): CliResult {
  return { ok: false, command: 'joseki', error: 'joseki 命令尚未实现' };
}
