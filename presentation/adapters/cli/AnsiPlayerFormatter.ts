/**
 * ANSI 棋手查询结果格式化器
 * @description 产出 ANSI 纯文本格式，用于终端环境
 * @module presentation/adapters/cli/AnsiPlayerFormatter
 */
import type { IPlayerFormatter } from '../../pages/player/IPlayerFormatter';
import type { PlayerQueryResultWithBookmark, PlayerBookmark } from '../../../application/player';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
/**
 * ANSI 格式化器
 * 为终端环境产出彩色 ANSI 文本
 */
export class AnsiPlayerFormatter implements IPlayerFormatter {
  formatWelcome(): string {
    return `${GRAY}输入棋手姓名开始查询${RESET}`;
  }
  formatLoading(name: string): string {
    return `${YELLOW}⏳ 正在查询 "${name}"...${RESET}\n${GRAY}手谈查询约1-3秒，易查分查询约1-2秒${RESET}`;
  }
  formatResult(result: PlayerQueryResultWithBookmark): string {
    const lines: string[] = [];
    if (result.shoutan.found && result.shoutan.players.length > 0) {
      lines.push(`${BLUE}${BOLD}📊 手谈等级分${RESET}`);
      for (const p of result.shoutan.players) {
        const bits: string[] = [];
        if (p.title) bits.push(`段位: ${p.title}`);
        if (p.rating) bits.push(`等级分: ${p.rating}`);
        if (p.rank) bits.push(`排名: #${p.rank}`);
        if (p.games) bits.push(`对局: ${p.games}`);
        const detail = bits.join('  ');
        lines.push(`  ${BOLD}${p.name}${RESET}${p.region ? ` (${p.region})` : ''}`);
        lines.push(`  ${detail}`);
        if (p.detailUrl) {
          const directUrl = extractDirectUrl(p.detailUrl);
          lines.push(`  ${CYAN}→ ${directUrl}${RESET}`);
        }
      }
    } else {
      lines.push(`${GRAY}未找到手谈等级分信息${RESET}`);
    }
    if (result.yichafen.found && result.yichafen.data) {
      const d = result.yichafen.data;
      lines.push('');
      lines.push(`${GREEN}${BOLD}🏆 易查分业余段位${RESET}`);
      const bits: string[] = [];
      if (d.level) bits.push(`段位: ${d.level}`);
      if (d.rating) bits.push(`等级分: ${d.rating}`);
      if (d.totalRank) bits.push(`总排名: #${d.totalRank}`);
      if (d.provinceRank) bits.push(`省排名: #${d.provinceRank}`);
      if (d.city) bits.push(`城市: ${d.city}`);
      if (d.province) bits.push(`省份: ${d.province}`);
      if (d.gender) bits.push(`性别: ${d.gender}`);
      if (d.birthYear) bits.push(`出生: ${d.birthYear}年`);
      lines.push(`  ${bits.join('  ')}`);
    } else {
      lines.push(`${GRAY}未查询到业余段位信息${RESET}`);
    }
    return lines.join('\n');
  }
  formatBookmarkItem(entry: PlayerBookmark): string {
    const time = formatTime(entry.updatedAt);
    const parts: string[] = [`👤 ${entry.name}`];
    if (entry.result) {
      const r = entry.result;
      const bits: string[] = [];
      if (r.shoutan.found && r.shoutan.players.length > 0) {
        const p = r.shoutan.players[0]!;
        if (p.title) bits.push(p.title);
        if (p.rating) bits.push(`等级分${p.rating}`);
        if (p.rank) bits.push(`#${p.rank}`);
      }
      if (r.yichafen.found && r.yichafen.data?.level) bits.push(r.yichafen.data.level);
      if (bits.length > 0) parts.push(bits.join('·'));
    }
    return `${parts.join('  ')}  ${GRAY}${time}${RESET}`;
  }
  formatEmptyBookmarks(): string {
    return `${GRAY}暂无收藏记录${RESET}`;
  }
}
/**
 * 从代理 URL 中提取直接链接
 */
function extractDirectUrl(url: string): string {
  try {
    const u = new URL(url);
    const target = u.searchParams.get('url');
    return target ?? url;
  } catch {
    return url;
  }
}
/**
 * 格式化时间戳
 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
