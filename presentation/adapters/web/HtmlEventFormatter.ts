/**
 * HTML 格式化实现（Web 平台 - 赛事查询）
 */
import type { IEventFormatter } from './pages/event/IEventFormatter';
import type { EventHistoryEntry } from '../../../application/event';
import type { Event, Group, AgainstPlanResult } from '../../../services/event/types';
import type { PlayerRanking } from '../../../domain/ranking/types';
import { tokens } from '../../core/styles/tokens';
const S = {
  card: `background:white;border-radius:${tokens.radius.md}px;padding:12px 16px;margin-bottom:10px;box-shadow:${tokens.shadows.md};`,
  link: `color:${tokens.colors.primary};text-decoration:none;`,
  grad: `background:linear-gradient(135deg,${tokens.colors.primary} 0%,${tokens.colors.secondary} 100%);`,
};
export class HtmlEventFormatter implements IEventFormatter {
  formatHeaderContent(): string {
    return `<div style="${S.grad}color:white;padding:12px 15px;border-radius:${tokens.radius.md}px;display:flex;justify-content:flex-start;align-items:center;gap:10px;"><span style="font-size:1.2em;">👥</span><div data-slot="group-select"></div></div>`;
  }
  formatQueryPanel(): string {
    return `<div style="text-align:center;padding:20px;color:${tokens.colors.textSecondary};">选择地区和时间范围，点击查询</div>`;
  }
  formatRecentPanel(): string { return ''; }
  formatHistoryItem(entry: EventHistoryEntry): string {
    const time = fmtRelTime(entry.visitedAt);
    return `<div data-action="viewHistory" data-id="${esc(entry.id)}" style="background:white;border-radius:${tokens.radius.lg}px;padding:16px;margin-bottom:${tokens.spacing.xs}px;cursor:pointer;transition:transform 0.2s;box-shadow:${tokens.shadows.md};"><div style="font-weight:600;color:${tokens.colors.text};margin-bottom:4px;">🏆 ${esc(entry.title)}</div><div style="font-size:0.75em;color:${tokens.colors.textHint};">🕐 ${time}</div></div>`;
  }
  formatEmptyHistory(): string {
    return `<div style="text-align:center;padding:40px 20px;color:${tokens.colors.textHint};"><div style="font-size:3em;margin-bottom:12px;opacity:0.5;">📋</div><p>暂无访问记录</p></div>`;
  }
  formatLoading(msg: string): string {
    return `<div style="text-align:center;padding:40px 20px;"><div style="border:3px solid ${tokens.colors.border};border-top:3px solid ${tokens.colors.primary};border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:0 auto 16px;"></div><p>${esc(msg)}</p></div><style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style>`;
  }
  formatEventCard(event: Event, _i: number): string {
    return `<div data-action="selectEvent" data-id="${event.id}" data-title="${esc(event.title)}" style="padding:12px 14px;background:#fff;border:1px solid ${tokens.colors.border};border-radius:${tokens.radius.md}px;cursor:pointer;transition:all 0.2s;margin-bottom:${tokens.spacing.xs}px;"><div style="font-weight:600;font-size:0.95em;color:${tokens.colors.text};margin-bottom:4px;">${esc(event.title)}</div><div style="font-size:0.85em;color:${tokens.colors.textHint};">📅 ${event.date || '日期待定'}</div></div>`;
  }
  private cityCounter = 0;
  formatCityGroup(city: string, events: Event[]): string {
    const id = `city-${++this.cityCounter}`; ensureToggle();
    const cards = events.map((e, i) => this.formatEventCard(e, i)).join('\n');
    return `<div style="background:white;border-radius:${tokens.radius.md}px;margin-bottom:${tokens.spacing.md}px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;"><div onclick="toggleCityGroup('${id}')" style="background:${tokens.colors.bg};padding:12px 15px;font-weight:bold;color:#555;border-bottom:1px solid ${tokens.colors.border};display:flex;justify-content:space-between;align-items:center;cursor:pointer;"><span>📍 ${esc(city)} (${events.length}场)</span><span id="${id}-toggle" style="font-size:0.8em;color:${tokens.colors.textHint};">▼</span></div><div id="${id}-list" style="padding:${tokens.spacing.xs}px 12px;">${cards}</div></div>`;
  }
  formatEmptyList(tab: string): string {
    const ic: Record<string, string> = { recent: '🔥', history: '📜', future: '📅' };
    return `<div style="text-align:center;padding:40px 20px;color:${tokens.colors.textHint};background:white;border-radius:${tokens.radius.md}px;"><div style="font-size:2.5em;margin-bottom:12px;opacity:0.5;">${ic[tab] ?? '📋'}</div><p>暂无比赛</p></div>`;
  }
  formatListHeader(area: string, month: number): string { return `🏆 比赛列表 · ${area || '全国'} · 最近${month}个月`; }
  formatListHeaderContent(area: string, month: number): string {
    return `<div style="${S.grad}color:white;padding:15px;border-radius:${tokens.radius.md}px;"><h1 style="font-size:1.3em;margin:0 0 4px;">🏆 比赛列表</h1><p style="font-size:0.85em;opacity:0.9;margin:0;">${area || '全国'} · 最近${month}个月</p></div>`;
  }
  formatRankingTable(rankings: PlayerRanking[], needsOriginal?: Set<string>): string {
    const th = `padding:10px 6px;font-weight:600;color:${tokens.colors.textSecondary};font-size:0.85em;`;
    const td = 'padding:10px 6px;';
    let html = `<table style="width:100%;border-collapse:collapse;font-size:0.9em;background:white;border-radius:${tokens.radius.md}px;overflow:hidden;"><thead><tr style="background:${tokens.colors.bg};"><th style="${th}text-align:center;">排名</th><th style="${th}text-align:left;">姓名</th><th style="${th}text-align:center;">积分</th><th style="${th}text-align:center;">对手分</th><th style="${th}text-align:center;">累进分</th><th style="${th}text-align:center;">逆减</th></tr></thead><tbody>`;
    rankings.forEach((p, i) => {
      const cls = i < 3 ? `color:${tokens.colors.warning};` : `color:${tokens.colors.primary};`;
      const dn = getDispName(p.name, needsOriginal), cn = cleanName(p.name);
      html += `<tr style="border-bottom:1px solid ${tokens.colors.border};"><td style="${td}text-align:center;font-weight:600;${cls}">${p.rank}</td><td style="${td}text-align:left;font-weight:500;"><a href="../player/?name=${encodeURIComponent(cn)}" style="${S.link}" data-action="playerClick" data-name="${esc(p.name)}">${esc(dn)}</a></td><td style="${td}text-align:center;font-weight:600;color:${tokens.colors.text};">${p.score}</td><td data-action="showOpponents" data-name="${esc(p.name)}" style="${td}text-align:center;cursor:pointer;color:${tokens.colors.primary};text-decoration:underline;">${p.opponentScore ?? 0}</td><td style="${td}text-align:center;">${p.progressiveScore ?? 0}</td><td style="${td}text-align:center;">${p.reverseMinusDisplay ?? '-'}</td></tr>`;
    });
    return html + '</tbody></table>';
  }
  formatMatchCard(match: AgainstPlanResult['rows'][number], _?: Set<string>, scoreMap?: Map<string, number>): string {
    const bkRaw = match.p1Name || '轮空', whRaw = match.p2Name || '轮空';
    const bk = match.p1Name ? cleanName(bkRaw) : bkRaw, wh = match.p2Name ? cleanName(whRaw) : whRaw;
    const r = match.p1Score > match.p2Score ? '黑胜' : match.p1Score < match.p2Score ? '白胜' : '-';
    const bl = match.p1Name ? playerLink(bk) : esc(bk), wl = match.p2Name ? playerLink(wh) : esc(wh);
    const bkS = scoreMap?.get(bkRaw) ?? scoreMap?.get(bk), whS = scoreMap?.get(whRaw) ?? scoreMap?.get(wh);
    const bkSh = bkS !== undefined ? `<div style="font-size:0.75em;color:${tokens.colors.textHint};">积分:${bkS}</div>` : '';
    const whSh = whS !== undefined ? `<div style="font-size:0.75em;color:${tokens.colors.textHint};">积分:${whS}</div>` : '';
    return `<div style="${S.card}"><div style="color:${tokens.colors.primary};font-weight:600;margin-bottom:${tokens.spacing.xs}px;font-size:0.9em;">台号 ${match.bout}</div><div style="display:flex;align-items:center;justify-content:space-between;"><div style="text-align:center;flex:1;"><div style="font-size:0.8em;">⚫</div><div style="font-weight:500;">${bl}</div>${bkSh}</div><div style="color:${tokens.colors.textHint};padding:0 ${tokens.spacing.xs}px;font-size:0.9em;">VS ${r}</div><div style="text-align:center;flex:1;"><div style="font-size:0.8em;">⚪</div><div style="font-weight:500;">${wl}</div>${whSh}</div></div></div>`;
  }
  formatRoundNav(cur: number, total: number): string {
    const arrowStyle = `color:${tokens.colors.primary};font-size:2.5em;cursor:pointer;user-select:none;`;
    return `
      <div style="display:flex;align-items:baseline;justify-content:center;gap:30px;padding:3px 16px;background:white;border-radius:${tokens.radius.md}px;margin-bottom:${tokens.spacing.sm}px;box-shadow:${tokens.shadows.sm};font-size:1em;">
        <span data-action="prevRound" style="${arrowStyle}${cur <= 1 ? 'opacity:0.3;' : ''}">‹</span>
        <span style="font-weight:500;color:${tokens.colors.text};line-height:1;font-size:1.5em;">第${cur}轮 / 共${total}轮</span>
        <span data-action="nextRound" style="${arrowStyle}${cur >= total ? 'opacity:0.3;' : ''}">›</span>
      </div>`;
  }
  formatMatchTable(matches: AgainstPlanResult['rows']): string {
    return matches.map(m => this.formatMatchCard(m)).join('');
  }
  formatProgress(pct: number, msg: string): string {
    return `<div style="position:fixed;top:0;left:0;width:100%;height:100%;${S.grad}display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;color:white;"><div style="font-size:3em;margin-bottom:20px;animation:pulse 1.5s ease-in-out infinite;">⏳</div><div style="font-weight:600;font-size:1.1em;margin-bottom:16px;">${esc(msg)}</div><div style="width:60%;max-width:300px;height:8px;background:rgba(255,255,255,0.2);border-radius:4px;overflow:hidden;"><div style="height:100%;background:white;border-radius:4px;transition:width 0.3s;width:${pct}%;"></div></div><div style="font-size:0.9em;margin-top:10px;opacity:0.8;">${pct}%</div></div><style>@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1);opacity:0.7}}</style>`;
  }
  formatLoadError(msg: string): string {
    return `<div style="text-align:center;padding:40px 20px;"><div style="font-size:2.5em;margin-bottom:12px;opacity:0.5;">❌</div><div style="font-weight:600;color:${tokens.colors.error};margin-bottom:${tokens.spacing.xs}px;">${esc(msg)}</div><p style="font-size:0.85em;color:${tokens.colors.textHint};">请返回重试</p></div>`;
  }
  formatEmptyRanking(): string { return `<div style="text-align:center;padding:40px;color:${tokens.colors.textHint};">暂无排名数据</div>`; }
  formatEmptyMatches(): string { return `<div style="text-align:center;padding:40px;color:${tokens.colors.textHint};">暂无对阵数据</div>`; }
  formatGroupOption(g: Group): string { return g.name + (g.players != null ? ` (${g.players}人)` : ''); }
  formatOpponentModal(playerName: string, games: PlayerRanking['games'], rankMap?: Map<string, { rank: number; score: number }>): string {
    if (!games?.length) return '';
    const w = games.filter(g => g.result === 'win' || g.result === 'bye_win').length, l = games.filter(g => g.result === 'lose').length, d = games.filter(g => g.result === 'draw').length, b = games.filter(g => g.result === 'bye').length;
    const cn = cleanName(playerName);
    const rows = games.map(g => {
      if (g.result === 'bye_win') {
        // 对方轮空，自己轮空胜
        return `<div style="padding:12px 16px;border-bottom:1px solid ${tokens.colors.border};display:flex;align-items:center;justify-content:space-between;"><div><span style="color:${tokens.colors.textHint};">对方轮空</span><div style="font-size:0.8em;color:${tokens.colors.textHint};">第${g.bout}轮 · ${cn}${g.color === 'black' ? '执⚫' : '执⚪'}</div></div><span style="color:${tokens.colors.success};font-weight:600;">胜</span></div>`;
      }
      if (g.result === 'bye') {
        // 自己轮空
        return `<div style="padding:12px 16px;border-bottom:1px solid ${tokens.colors.border};display:flex;align-items:center;justify-content:space-between;"><div><span style="color:${tokens.colors.textHint};">轮空</span><div style="font-size:0.8em;color:${tokens.colors.textHint};">第${g.bout}轮</div></div><span style="color:${tokens.colors.textHint};font-weight:600;">—</span></div>`;
      }
      const oc = cleanName(g.opponentName), ci = g.color === 'black' ? `${cn}执⚫` : `${cn}执⚪`;
      const rs = g.result === 'win' ? `color:${tokens.colors.success};font-weight:600;` : g.result === 'lose' ? `color:${tokens.colors.error};font-weight:600;` : `color:${tokens.colors.warning};font-weight:600;`;
      const rt = g.result === 'win' ? '胜' : g.result === 'lose' ? '负' : '和';
      const ri = rankMap?.get(oc), rb = ri ? ` <span style="font-size:0.75em;color:${tokens.colors.textHint};">#${ri.rank}</span>` : '';
      return `<div style="padding:12px 16px;border-bottom:1px solid ${tokens.colors.border};display:flex;align-items:center;justify-content:space-between;"><div><a href="../player/?name=${encodeURIComponent(oc)}" style="${S.link}">${esc(oc)}</a>${rb}<div style="font-size:0.8em;color:${tokens.colors.textHint};">第${g.bout}轮 · ${ci}</div></div><span style="${rs}">${rt}</span></div>`;
    }).join('');
    const statsHtml = b > 0
      ? `<span style="color:${tokens.colors.success};font-weight:600;">${w}胜</span> <span style="color:${tokens.colors.error};font-weight:600;">${l}负</span> <span style="color:${tokens.colors.warning};font-weight:600;">${d}和</span> <span style="color:${tokens.colors.textHint};">${b}轮空</span>`
      : `<span style="color:${tokens.colors.success};font-weight:600;">${w}胜</span> <span style="color:${tokens.colors.error};font-weight:600;">${l}负</span> <span style="color:${tokens.colors.warning};font-weight:600;">${d}和</span>`;
    return `<div id="opponent-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:${tokens.colors.bgOverlay};z-index:1000;display:flex;align-items:center;justify-content:center;padding:12px;"><div style="background:white;border-radius:${tokens.radius.xl}px;width:100%;max-width:420px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.3);"><div style="${S.grad}color:white;padding:16px;display:flex;justify-content:space-between;align-items:center;"><h2 style="font-size:1.1em;margin:0;">🎯 ${esc(cn)} 的对手</h2><button data-action="closeModal" style="background:transparent;border:none;color:white;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1.2em;line-height:28px;padding:0;display:flex;align-items:center;justify-content:center;">×</button></div><div style="padding:0;overflow-y:auto;flex:1;">${rows}</div><div style="padding:12px 16px;background:${tokens.colors.bg};text-align:center;font-size:0.9em;color:#555;">${statsHtml}</div></div></div>`;
  }
}
function ensureToggle(): void {
  if (typeof window !== 'undefined' && !(window as any)['toggleCityGroup']) {
    (window as any)['toggleCityGroup'] = (id: string) => {
      const l = document.getElementById(`${id}-list`), t = document.getElementById(`${id}-toggle`);
      if (!l) return;
      if (l.style.display === 'none') { l.style.display = 'block'; if (t) t.textContent = '▼'; }
      else { l.style.display = 'none'; if (t) t.textContent = '▶'; }
    };
  }
}
function playerLink(name: string): string {
  return `<a href="../player/?name=${encodeURIComponent(cleanName(name))}" style="${S.link}">${esc(name)}</a>`;
}
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtRelTime(ts: number): string {
  const d = Date.now() - ts, m = Math.floor(d / 60000);
  if (m < 1) return '刚刚'; if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}小时前`;
  const dy = Math.floor(h / 24); if (dy < 7) return `${dy}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
function cleanName(name: string): string {
  if (!name) return ''; const m = name.match(/[\u4e00-\u9fa5]{2,4}/); return m ? m[0] : name.replace(/\|[\d\w:_-]+$/, '').trim();
}
function getDispName(name: string, needsOriginal?: Set<string>): string {
  return !name ? '' : needsOriginal?.has(name) ? name : cleanName(name);
}
