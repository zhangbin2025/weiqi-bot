/**
 * HTML 格式化实现（Web 平台）
 * @module presentation/pages/player/HtmlPlayerFormatter
 */
import type { IPlayerFormatter } from './pages/player/IPlayerFormatter';
import type { PlayerQueryResultWithBookmark, PlayerBookmark } from '../../../application/player';
import { tokens } from '../../core/styles/tokens';
export class HtmlPlayerFormatter implements IPlayerFormatter {
  formatWelcome(): string {
    return '输入棋手姓名开始查询';
  }
  formatLoading(name: string): string {
    return `<div style="text-align:center;padding:${tokens.spacing.lg}px ${tokens.spacing.md}px;">` +
      `<div style="border:3px solid ${tokens.colors.border};border-top:3px solid ${tokens.colors.primary};` +
      `border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;` +
      `margin:0 auto ${tokens.spacing.md}px;"></div>` +
      `<p>正在查询 "${escHtml(name)}"...</p>` +
      `<p style="font-size:0.85em;color:${tokens.colors.textHint};margin-top:${tokens.spacing.xs}px;">` +
      `手谈查询约1-3秒，易查分查询约1-2秒</p></div>` +
      `<style>@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}</style>`;
  }
  formatResult(result: PlayerQueryResultWithBookmark): string {
    return formatResultHtml(result);
  }
  formatBookmarkItem(bookmark: PlayerBookmark): string {
    const time = formatTime(bookmark.updatedAt);
    const tags: string[] = [];
    if (bookmark.result) {
      const r = bookmark.result;
      if (r.shoutan.found && r.shoutan.players.length > 0) {
        const p = r.shoutan.players[0]!;
        if (p.rating) tags.push(`📊 ${p.rating}`);
      }
      if (r.yichafen.found && r.yichafen.data?.level) {
        tags.push(`🏆 ${r.yichafen.data.level}`);
      }
    }
    const tagHtml = tags.length > 0
      ? `<div style="font-size:0.85em;color:${tokens.colors.textHint};margin-top:${tokens.spacing.xs}px;">${tags.join(' ')}</div>`
      : '';
    let summaryHtml = '';
    if (bookmark.result) {
      const r = bookmark.result;
      const bits: string[] = [];
      if (r.shoutan.found && r.shoutan.players.length > 0) {
        const p = r.shoutan.players[0]!;
        if (p.title) bits.push(p.title);
        if (p.rank) bits.push(`排名${p.rank}`);
      }
      // 段位已在 tag 中显示，summary 不再重复
      if (bits.length > 0) {
        summaryHtml = `<div style="font-size:0.8em;color:${tokens.colors.textSecondary};margin-top:10px;line-height:1.6;">${bits.join(' · ')}</div>`;
      }
    }
    return `<div data-action="viewHistory" data-name="${escAttr(bookmark.name)}" ` +
      `style="background:white;border-radius:${tokens.radius.md}px;padding:18px 20px;margin-bottom:${tokens.spacing.md}px;` +
      `cursor:pointer;transition:background 0.2s;border:1px solid ${tokens.colors.border};box-shadow:${tokens.shadows.sm};" ` +
      `onmouseover="this.style.background='${tokens.colors.bg}'" ` +
      `onmouseout="this.style.background='white'">` +
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">` +
      `<span style="font-weight:600;font-size:1.05em;">👤 ${escHtml(bookmark.name)}</span>` +
      `<span style="font-size:0.75em;color:${tokens.colors.textHint};">🕐 ${time}</span>` +
      `</div>${summaryHtml}${tagHtml}</div>`;
  }
  formatEmptyBookmarks(): string {
    return `<div style="text-align:center;padding:40px 20px;color:${tokens.colors.textHint};">` +
      '<div style="font-size:2em;margin-bottom:8px;">⭐</div>' +
      '<p>暂无收藏记录</p></div>';
  }
}
// === 内部格式化函数 ===
function formatResultHtml(result: PlayerQueryResultWithBookmark): string {
  const h: string[] = [];
  if (result.shoutan.found && result.shoutan.players.length > 0) {
    h.push(`<div style="background:#e3f2fd;border-radius:${tokens.radius.lg}px;padding:${tokens.spacing.md}px;margin-bottom:${tokens.spacing.md}px;">`);
    h.push(`<h3 style="color:#1976d2;margin-bottom:${tokens.spacing.md}px;">📊 手谈等级分</h3>`);
    for (const p of result.shoutan.players) {
      h.push(`<div style="background:white;border-radius:${tokens.radius.md}px;padding:${tokens.spacing.md}px;margin-bottom:10px;">`);
      h.push(`<div style="display:flex;justify-content:space-between;margin-bottom:${tokens.spacing.xs}px;">` +
        `<span style="font-weight:600;font-size:1.1em;">${escHtml(p.name)}</span>` +
        `${p.region ? `<span style="color:${tokens.colors.textSecondary};font-size:0.9em;">${escHtml(p.region)}</span>` : ''}</div>`);
      h.push('<div style="display:flex;flex-wrap:wrap;gap:12px;">');
      if (p.title) h.push(statBox(p.title, '段位'));
      if (p.rating) h.push(statBox(String(p.rating), '等级分'));
      if (p.rank) h.push(statBox(String(p.rank), '全国排名'));
      if (p.games) h.push(statBox(String(p.games), '对局'));
      h.push('</div>');
      if (p.detailUrl) {
        h.push(`<div style="margin-top:10px;text-align:right;">` +
          `<a href="${escAttr(extractDirectUrl(p.detailUrl))}" target="_blank" rel="noopener" ` +
          `style="color:#1976d2;font-size:0.85em;text-decoration:none;">` +
          `查看详情 ↗</a></div>`);
      }
      h.push('</div>');
    }
    h.push('</div>');
  } else {
    h.push(`<div style="text-align:center;padding:24px;color:${tokens.colors.textHint};">` +
      '<div style="font-size:2em;margin-bottom:8px;">🔍</div>未找到手谈等级分信息</div>');
  }
  if (result.yichafen.found && result.yichafen.data) {
    const d = result.yichafen.data;
    h.push(`<div style="background:#e8f5e9;border-radius:${tokens.radius.lg}px;padding:${tokens.spacing.md}px;margin-bottom:${tokens.spacing.md}px;">`);
    h.push(`<h3 style="color:#388e3c;margin-bottom:${tokens.spacing.md}px;">🏆 易查分业余段位</h3>`);
    h.push('<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">');
    if (d.level) h.push(infoItem(d.level, '段位'));
    if (d.rating) h.push(infoItem(String(d.rating), '等级分'));
    if (d.totalRank) h.push(infoItem(String(d.totalRank), '总排名'));
    if (d.provinceRank) h.push(infoItem(String(d.provinceRank), '省排名'));
    if (d.city) h.push(infoItem(d.city, '城市'));
    if (d.province) h.push(infoItem(d.province, '省份'));
    if (d.gender) h.push(infoItem(d.gender, '性别'));
    if (d.birthYear) h.push(infoItem(`${d.birthYear}年`, '出生年份'));
    h.push('</div></div>');
  } else {
    h.push(`<div style="text-align:center;padding:24px;color:${tokens.colors.textHint};">` +
      '<div style="font-size:2em;margin-bottom:8px;">🔍</div>未查询到业余段位信息</div>');
  }
  return h.length > 0 ? h.join('') : `<p style="color:${tokens.colors.textHint};text-align:center;">未找到棋手信息</p>`;
}
function statBox(val: string, label: string): string {
  return `<div style="text-align:center;"><div style="font-size:1.2em;font-weight:600;color:#1976d2;">${val}</div><div style="font-size:0.75em;color:${tokens.colors.textHint};">${label}</div></div>`;
}
function infoItem(val: string, label: string): string {
  return `<div style="background:white;padding:10px;border-radius:${tokens.radius.md}px;text-align:center;"><div style="font-size:0.75em;color:${tokens.colors.textHint};margin-bottom:4px;">${label}</div><div style="font-size:1.1em;font-weight:600;color:${tokens.colors.text};">${val}</div></div>`;
}
function extractDirectUrl(url: string): string {
  try {
    const u = new URL(url);
    const target = u.searchParams.get('url');
    return target || url;
  } catch { return url; }
}
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
