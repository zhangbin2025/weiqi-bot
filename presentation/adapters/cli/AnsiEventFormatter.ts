/**
 * ANSI 赛事格式化器
 * @description 产出 ANSI 纯文本格式，用于终端环境
 * @module presentation/adapters/cli/AnsiEventFormatter
 */
import type { IEventFormatter } from '../../pages/event/IEventFormatter';
import type { EventHistoryEntry } from '../../../application/event';
import type { Event, Group } from '../../../services/event/types';
import type { PlayerRanking } from '../../../domain/ranking/types';
import type { AgainstPlanResult } from '../../../services/event/types';
import { TerminalTable } from './TerminalTable';
import { cleanName } from './utils';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const RED = '\x1b[31m';
export class AnsiEventFormatter implements IEventFormatter {
  formatHeaderContent(): string { return '👥 分组选择'; }
  formatQueryPanel(): string { return ''; }
  formatRecentPanel(): string { return ''; }
  formatHistoryItem(entry: EventHistoryEntry): string {
    const time = this.relativeTime(entry.visitedAt);
    return `  🏆 ${entry.title}  🕐 ${time}`;
  }
  formatEmptyHistory(): string { return `${GRAY}暂无访问记录${RESET}`; }
  formatLoading(message: string): string { return `${YELLOW}⏳ ${message}...${RESET}`; }
  formatEventCard(event: Event, index: number): string {
    const num = TerminalTable.padDisplay(String(index + 1), 3, 'right');
    const date = event.date ? `${GRAY}${event.date}${RESET} ` : '';
    return ` ${BOLD}${num}.${RESET} ${date}${event.title}`;
  }
  formatCityGroup(city: string, events: Event[]): string {
    return `${CYAN}📍 ${city}${RESET} ${GRAY}(${events.length}场)${RESET}`;
  }
  formatEmptyList(_tab: string): string { return `${GRAY}暂无比赛${RESET}`; }
  formatListHeader(area: string, month: number): string {
    return `${BOLD}${BLUE}📋 ${area} · 最近${month}个月${RESET}`;
  }
  formatListHeaderContent(area: string, month: number): string {
    return `🏆 比赛列表 · ${area || '全国'} · 最近${month}个月`;
  }
  formatRankingTable(rankings: PlayerRanking[], _needsOriginal?: Set<string>): string {
    const table = new TerminalTable([
      { header: '排名', align: 'right', width: 4, color: (t) => `${BOLD}${t}${RESET}` },
      { header: '姓名', align: 'left' },
      { header: '积分', align: 'right', width: 4 },
      { header: '对手分', align: 'right', width: 6 },
      { header: '累进分', align: 'right', width: 6 },
      { header: '逆减', align: 'left', width: 8 },
    ]);
    for (const r of rankings) {
      table.addRow([
        String(r.rank), cleanName(r.name), String(r.score),
        String(r.opponentScore), String(r.progressiveScore),
        r.reverseMinusDisplay || '-',
      ]);
    }
    return table.render();
  }
  formatMatchCard(match: AgainstPlanResult['rows'][number], _needsOriginal?: Set<string>, _scoreMap?: Map<string, number>): string {
    const result = match.p1Score > match.p2Score ? `${GREEN}黑胜${RESET}` : match.p2Score > match.p1Score ? `${CYAN}白胜${RESET}` : '和棋';
    return `${TerminalTable.padDisplay(String(match.bout), 2, 'right')}. ${BOLD}⚫${cleanName(match.p1Name)}${RESET} VS ${BOLD}⚪${cleanName(match.p2Name)}${RESET}  ${result}`;
  }
  /** 批量渲染对阵表 */
  formatMatchTable(matches: AgainstPlanResult['rows']): string {
    const table = new TerminalTable([
      { header: '台', align: 'right', width: 3, color: (t) => `${BOLD}${t}${RESET}` },
      { header: '黑方', align: 'left', color: (t) => `${BOLD}⚫${t}${RESET}` },
      { header: '白方', align: 'left', color: (t) => `${BOLD}⚪${t}${RESET}` },
      { header: '结果', align: 'center', width: 5 },
    ]);
    for (const m of matches) {
      const result = m.p1Score > m.p2Score ? `${GREEN}黑胜${RESET}` : m.p2Score > m.p1Score ? `${CYAN}白胜${RESET}` : '和棋';
      table.addRow([String(m.bout), cleanName(m.p1Name), cleanName(m.p2Name), result]);
    }
    return table.render();
  }
  formatRoundNav(current: number, total: number): string {
    return `${YELLOW}第${current}轮/共${total}轮${RESET}`;
  }
  formatProgress(percent: number, message: string): string {
    return `${YELLOW}⏳ ${message}... ${percent}%${RESET}`;
  }
  formatLoadError(message: string): string { return `${RED}❌ ${message}${RESET}`; }
  formatEmptyRanking(): string { return `${GRAY}暂无排名数据${RESET}`; }
  formatEmptyMatches(): string { return `${GRAY}暂无对阵数据${RESET}`; }
  formatGroupOption(group: Group): string {
    const p = group.players ?? '?';
    return `${group.name}(${p}人)`;
  }
  formatOpponentModal(playerName: string, games: PlayerRanking['games']): string {
    if (!games?.length) return '';
    const cn = cleanName(playerName);
    const lines: string[] = [`${BOLD}${CYAN}🎯 ${cn} 的对手${RESET}`];
    const table = new TerminalTable([
      { header: '轮次', align: 'right', width: 4 },
      { header: '执色', align: 'center', width: 6 },
      { header: '对手', align: 'left' },
      { header: '结果', align: 'center', width: 4 },
    ]);
    for (const g of games) {
      if (g.result === 'bye_win') {
        table.addRow([String(g.bout), g.color === 'black' ? '⚫执黑' : '⚪执白', '对方轮空', `${GREEN}胜${RESET}`]);
        continue;
      }
      if (g.result === 'bye') {
        table.addRow([String(g.bout), '—', '轮空', `${GRAY}—${RESET}`]);
        continue;
      }
      const ci = g.color === 'black' ? '⚫执黑' : '⚪执白';
      const rt = g.result === 'win' ? `${GREEN}胜${RESET}` : g.result === 'lose' ? `${RED}负${RESET}` : `${YELLOW}和${RESET}`;
      table.addRow([String(g.bout), ci, cleanName(g.opponentName), rt]);
    }
    lines.push(table.render());
    const w = games.filter(g => g.result === 'win' || g.result === 'bye_win').length;
    const l = games.filter(g => g.result === 'lose').length;
    const d = games.filter(g => g.result === 'draw').length;
    const b = games.filter(g => g.result === 'bye').length;
    const byeStr = b > 0 ? `${b}轮空` : '';
    lines.push(`${GRAY}${w}胜${l}负${d}和${byeStr}${RESET}`);
    return lines.join('\n');
  }
  private relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return `${Math.floor(diff / 86400000)}天前`;
  }
}
