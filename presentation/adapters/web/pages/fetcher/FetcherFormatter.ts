/**
 * 棋谱下载页面格式化器
 * @module presentation/pages/fetcher/FetcherFormatter
 */
import type { FetcherResult, FetcherBookmark } from '../../../../../application/fetcher';
import { formatGameResult } from '../../../../../domain/game/GameResult';
/**
 * 格式化器配置
 */
export interface FetcherFormatterConfig {
  locale?: string;
}
/**
 * 棋谱下载页面格式化器
 */
export class FetcherFormatter {
  private readonly locale: string;
  constructor(config?: FetcherFormatterConfig) {
    this.locale = config?.locale ?? 'zh-CN';
  }
  // ==================== 加载与错误 ====================
  /**
   * 格式化加载状态
   */
  formatLoading(message?: string): string {
    return `
      <div style="text-align:center; padding:40px 20px;">
        <div style="
          width:40px; height:40px; border:3px solid #e0e0e0; border-top-color:#667eea;
          border-radius:50%; margin:0 auto 12px;
          animation: fetcher-spin 1s linear infinite;
        "></div>
        <p style="color:#888;">${message || '正在抓取棋谱，请稍候...'}</p>
      </div>
      <style>
        @keyframes fetcher-spin { to { transform: rotate(360deg); } }
      </style>
    `;
  }
  /**
   * 格式化错误信息
   */
  formatError(title: string, message: string): string {
    return `
      <div style="background:#fff5f5; border:1px solid #feb2b2; border-radius:8px; padding:16px;">
        <div style="color:#c53030; font-weight:600; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          <span>⚠️</span>
          <span>${title}</span>
        </div>
        <div style="color:#742a2a; font-size:14px;">${message}</div>
      </div>
    `;
  }
  // ==================== 结果展示 ====================
  /**
   * 格式化结果信息（紧凑风格）
   */
  formatResultInfo(result: FetcherResult, isLive: boolean = false): string {
    const black = result.metadata.black || '未知';
    const white = result.metadata.white || '未知';
    const date = result.metadata.date || '未知';
    const movesCount = result.metadata.movesCount || 0;
    const gameResult = formatGameResult(result.metadata.result);
    const source = this.formatSource(result.source);
    const btnStyle = 'flex:1;background:#f0f0f0;color:#333;padding:12px;border-radius:8px;text-align:center;cursor:pointer;font-size:15px;';
    const buttons = isLive
      ? `<div style="display:flex; gap:8px; margin-top:16px;">
        <div data-action="view" style="${btnStyle}">👁️ 查看</div>
        <div data-action="live" style="${btnStyle}color:#e53e3e;font-weight:600;">🔴 直播</div>
        <div data-action="share" style="${btnStyle}">📱 分享</div>
      </div>`
      : `<div style="display:flex; gap:8px; margin-top:16px;">
        <div data-action="download" style="${btnStyle}">📥 下载</div>
        <div data-action="view" style="${btnStyle}">👁️ 查看</div>
        <div data-action="share" style="${btnStyle}">📱 分享</div>
      </div>`;
    return `
      <span style="display:inline-block; background:linear-gradient(135deg,#667eea 0%,#764ba2 100%); color:white; padding:2px 10px; border-radius:12px; font-size:12px; font-weight:500; margin-bottom:12px;">${source}</span>
      <div style="background:#f8f9fa; border-radius:8px; padding:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0;">
          <span style="font-weight:600; color:#333;">⚫ ${black}</span>
          <span style="color:#999;">vs</span>
          <span style="font-weight:600; color:#333;">⚪ ${white}</span>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0 4px 0; border-top:1px solid #e0e0e0; font-size:0.9em; color:#666;">
          <span>${gameResult}</span>
          <span>${movesCount}手</span>
        </div>
      </div>
      ${buttons}
    `;
  } 
  // ==================== 收藏列表 ====================
  /**
   * 格式化空状态
   */
  formatEmptyState(): string {
    return `
      <div style="text-align:center; padding:40px 20px; color:#888;">
        <div style="font-size:3em; margin-bottom:12px; opacity:0.5;">📭</div>
        <div>暂无收藏记录</div>
        <div style="font-size:0.85em; margin-top:4px;">粘贴分享链接开始抓取棋谱</div>
      </div>
    `;
  }
  /**
   * 格式化单条收藏记录（与"最新"标签页条目统一样式）
   * - 右上角三点扩展菜单：打开收藏 + 查看链接（可打开外链时）+ 直播来源额外项
   * - 卡片主体按来源呈现不同内容；未在"最新"标签页出现的来源回退为"归档棋谱"展示
   */
  formatBookmarkItem(entry: FetcherBookmark): string {
    const sourceLabels: Record<string, string> = {
      foxwq: '🏆 野狐', weiqi101: '📝 101围棋', 'ogs-live': '🎬 OGS', 'yike-live': '📹 弈客',
      goproblems: '🧩 GoProblems', 'ogs-puzzle': '🧩 OGS死活题', katago: '🤖 KataGo',
    };
    const sourceLabel = sourceLabels[entry.source] || this.formatSource(entry.source);
    const date = entry.date || '未知时间';
    const title = this.formatBookmarkTitle(entry);
    const subtitle = this.formatBookmarkSubtitle(entry);
    const isLiveSource = entry.source === 'ogs-live' || entry.source === 'yike-live';

    const liveMenu = isLiveSource
      ? `<div data-action="viewLatest" data-url="${entry.url}" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#2d3748;white-space:nowrap;">👁\ufe0f 查看棋谱</div>
         <div data-action="selectLatest" data-url="${entry.url}" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#c53030;font-weight:600;white-space:nowrap;">🔴 直播棋谱</div>`
      : '';
    const linkUrl = this.bookmarkViewUrl(entry);
    const linkMenuItem = linkUrl
      ? `<div data-action="viewUrl" data-url="${linkUrl}" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#2d3748;white-space:nowrap;">🔗 查看链接</div>`
      : '';

    const menu = `
      <div class="bookmark-dots" data-action="openBookmarkMenu" data-id="${entry.id}"
           style="position:absolute;top:8px;right:8px;width:24px;height:24px;line-height:22px;text-align:center;border-radius:50%;color:#999;font-size:16px;cursor:pointer;user-select:none;"
           onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background=''">⋮</div>
      <div data-menu-template style="display:none;position:absolute;top:34px;right:8px;min-width:96px;background:white;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.15);z-index:50;overflow:hidden;">
        <div data-action="viewBookmark" data-id="${entry.id}" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#2d3748;white-space:nowrap;">📂 打开收藏</div>
        ${liveMenu}
        ${linkMenuItem}
      </div>`;

    return `<div data-action="viewBookmark" data-id="${entry.id}" style="position:relative;padding:10px 30px 10px 0;border-top:1px solid #eee;cursor:pointer;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
      ${menu}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:0.8em;font-weight:500;color:#667eea;">${sourceLabel}</span>
        <span style="font-size:0.8em;color:#888;">${date}</span>
      </div>
      <div style="font-weight:500;color:#333;font-size:0.95em;">${title}</div>
      ${subtitle}
    </div>`;
  }

  /**
   * 收藏卡片标题：统一以"归档棋谱"样式呈现（黑 vs 白）
   * 直播/死活题等仅在菜单与副标题上区分；未在"最新"标签页出现的来源同样回退此样式
   */
  private formatBookmarkTitle(entry: FetcherBookmark): string {
    const black = entry.black || '黑方';
    const white = entry.white || '白方';
    return '⚫ ' + black + ' vs ⚪ ' + white;
  }

  /**
   * 收藏"查看链接"目标：与"最新"标签页一致
   * KataGo 指向归档压缩包；其余来源若有 http(s) 可打开链接则直接用，否则返回空（不显示"查看链接"）
   */
  private bookmarkViewUrl(entry: FetcherBookmark): string {
    const m = entry.url.match(/^katago:\/\/date\/(\d{4}-\d{2}-\d{2})/);
    if (entry.source === 'katago' && m) {
      return 'https://katagoarchive.org/kata1/ratinggames/' + m[1] + 'rating.tar.bz2';
    }
    if (entry.viewUrl && /^https?:\/\//i.test(entry.viewUrl)) return entry.viewUrl;
    if (/^https?:\/\//i.test(entry.url)) return entry.url;
    return '';
  }

  /**
   * 收藏卡片副标题：来源专属展示
   * - 直播来源：显示"直播棋谱 · 可观看战况"
   * - 死活题来源：显示"死活题"
   * - 其余（含未在"最新"出现的来源）：结果 + 手数（归档棋谱样式）
   */
  private formatBookmarkSubtitle(entry: FetcherBookmark): string {
    const liveSources = ['ogs-live', 'yike-live'];
    const puzzleSources = ['goproblems', 'ogs-puzzle'];
    if (liveSources.includes(entry.source)) {
      return `<div style="font-size:0.85em;color:#c53030;margin-top:4px;">🔴 直播棋谱 · 可观看战况</div>`;
    }
    if (puzzleSources.includes(entry.source)) {
      return `<div style="font-size:0.85em;color:#666;margin-top:4px;">🧩 死活题</div>`;
    }
    const result = formatGameResult(entry.result);
    const movesCount = entry.movesCount || 0;
    let extra = '';
    if (result && result !== '-') extra += result;
    if (movesCount > 0) extra += (extra ? ' · ' : '') + movesCount + '手';
    if (!extra) return '';
    return `<div style="font-size:0.85em;color:#666;margin-top:4px;">${extra}</div>`;
  }
  // ==================== 通用格式化 ====================
  /**
   * 格式化来源
   */
  formatSource(source: string): string {
    const sourceMap: Record<string, string> = {
      'foxwq': '野狐',
      'eweiqi': '弈城',
      'ogs': 'OGS',
      '101weiqi': '101围棋',
      'yikeweiqi': '弈客',
      'yuanluobo': '元萝卜',
      'goproblems': 'GoProblems',
      'katago': 'KataGo',
      'txwq': '腾讯围棋',
      'unknown': '未知',
    };
    return sourceMap[source] || source;
  }
  /**
   * 格式化相对时间
   */
  formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 7) return this.formatDate(timestamp);
    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  }
  /**
   * 格式化日期
   */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString(this.locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  /**
   * 生成对局名称（下载文件名）
   */
  generateGameName(result: FetcherResult): string {
    const black = result.metadata.black || '未知';
    const white = result.metadata.white || '未知';
    return `${black}_vs_${white}`;
  }
}
