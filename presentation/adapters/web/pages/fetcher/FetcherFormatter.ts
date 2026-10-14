/**
 * 棋谱下载页面格式化器
 * @module presentation/pages/fetcher/FetcherFormatter
 */
import type { FetcherResult, FetcherBookmark } from '../../../../../application/fetcher';
import { formatGameResult } from '../../../../../domain/game/GameResult';
import {
  actionLabel,
  actionText,
  isEmphasizedAction,
  classifyGame,
  normalizeExternalUrl,
  type GameAction,
  type ClassifyInput,
} from './utils/gameKind';
/**
 * 格式化器配置
 */
/**
 * 结果卡片操作区输入
 * @description 由棋谱分类器给出：首要动作、次要动作、菜单全集、外链
 */
export interface ResultActionsInput {
  /** 首要动作（大按钮，强调色） */
  primary: GameAction;
  /** 次要动作（普通按钮，可为 null） */
  secondary: GameAction | null;
  /** 动作全集（顺序即展示顺序，首要动作排第一） */
  actions: GameAction[];
  /** 外部可打开链接（有则菜单追加「查看链接」；仅 http(s) 有效） */
  externalUrl?: string | undefined;
}

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
   * @param result 抓取结果
   * @param actions 操作区配置（由棋谱分类器给出首要动作与菜单全集）
   */
  formatResultInfo(result: FetcherResult, actions: ResultActionsInput): string {
    const black = result.metadata.black || '未知';
    const white = result.metadata.white || '未知';
    const movesCount = result.metadata.movesCount || 0;
    const gameResult = formatGameResult(result.metadata.result);
    const source = this.formatSource(result.source);
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
      ${this.formatResultActions(actions)}
    `;
  }

  /**
   * 结果卡片操作区
   * @description 首因效应：用户最想做的事放成大按钮（首要动作，强调色），
   *              次要动作并排，第三个固定为「更多 ⋯」按钮 —— 点击就地弹出
   *              菜单，展示其余全部操作（含分享）。
   *              不再在卡片右上角单独放三点按钮：那样既和「更多」重复，
   *              又容易误触。
   *
   *              按钮文案一律不换行（white-space:nowrap）：窄屏上「实战选点」
   *              这类四字标签曾被挤成两行，按钮高度参差、行也变高。
   *              改为字号随屏宽收敛（clamp），比换行更好。
   */
  formatResultActions(input: ResultActionsInput): string {
    const HOVER = "onmouseover=\"this.style.background='#f8f9fa'\" onmouseout=\"this.style.background=''\"";
    // 不换行 + 字号自适应：窄屏缩字号而不是折行，保证三个按钮一行放得下、高度一致
    const btnBase = 'flex:1;min-width:0;background:#f0f0f0;color:#333;padding:10px 6px;' +
      'border-radius:8px;text-align:center;cursor:pointer;' +
      'font-size:clamp(12px,3.4vw,15px);line-height:1.25;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const renderBtn = (a: GameAction): string =>
      '<div data-action="' + (a === 'more' ? 'openResultMenu' : a) + '"' +
      (a === 'more' ? ' class="result-more"' : '') +
      ' style="' + btnBase +
      (isEmphasizedAction(a) ? 'color:#e53e3e;font-weight:600;' : '') +
      // 「更多 ⋯」是开关按钮，不参与等分伸缩，否则会把前两个按钮挤窄
      (a === 'more' ? 'flex:0 0 auto;padding-left:12px;padding-right:12px;' : '') + '">' +
      (a === 'more' ? actionText(a) + ' <span style="font-size:1.1em;">⋯</span>' : actionLabel(a)) + '</div>';

    // 三按钮行：首要动作 / 次要动作 / 更多（⋯ 就地弹菜单，不再另设右上角三点）
    const row =
      '<div class="result-actions-row" style="display:flex; gap:6px; margin-top:16px;">' +
      renderBtn(input.primary) +
      (input.secondary ? renderBtn(input.secondary) : '') +
      renderBtn('more') +
      '</div>';

    // 菜单只放没上按钮行的动作：避免与首要/次要按钮重复
    const onRow = new Set<GameAction>([input.primary, ...(input.secondary ? [input.secondary] : [])]);
    const items = input.actions
      .filter((a) => !onRow.has(a))
      .map((a) =>
        '<div data-action="' + a + '" style="padding:6px 10px;cursor:pointer;font-size:0.85em;' +
        (isEmphasizedAction(a) ? 'color:#c53030;font-weight:600;' : 'color:#2d3748;') +
        'white-space:nowrap;" ' + HOVER + '>' + actionLabel(a) + '</div>')
      .join('');
    // 外链必须是 http(s)：lib:// / katago:// 等内置库伪协议浏览器打不开，不展示
    const externalUrl = normalizeExternalUrl(input.externalUrl);
    const link = externalUrl
      ? '<div data-action="viewUrl" data-url="' + externalUrl + '" style="padding:6px 10px;cursor:pointer;' +
        'font-size:0.85em;color:#2d3748;white-space:nowrap;" ' + HOVER + '>' + actionLabel('viewUrl') + '</div>'
      : '';

    const menu =
      '<div data-menu-template style="display:none;position:absolute;top:100%;right:0;margin-top:4px;' +
      'min-width:112px;background:white;border:1px solid #e2e8f0;border-radius:8px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,0.15);z-index:50;overflow:hidden;">' +
      items + link + '</div>';

    return '<div class="result-actions" style="position:relative;">' + row + menu + '</div>';
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
      'lib-life-death': '📚 内置题库', 'lib-ai-review': '📚 内置棋谱',
    };
    const sourceLabel = sourceLabels[entry.source] || this.formatSource(entry.source);
    // 日期统一为抓取（收藏）时间，仅显示年月日，不显示时分秒
    const date = this.formatDateOnly(entry.date);
    const title = this.formatBookmarkTitle(entry);
    const subtitle = this.formatBookmarkSubtitle(entry);
    // 三点菜单：统一走棋谱分类器（与结果卡片 / 最新列表同一套动作集）
    const HOVER = 'onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'\'"';
    const openItem = '<div data-action="viewBookmark" data-id="' + entry.id +
      '" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#2d3748;white-space:nowrap;" ' +
      HOVER + '>📂 打开收藏</div>';
    const { actions } = classifyGame({
      source: entry.source,
      url: entry.url,
      isLive: entry.isLive,
      isEnded: entry.isEnded,
    } as ClassifyInput);
    // data-id 带上收藏 ID：菜单动作要据此定位是哪条收藏
    // （只靠 url 不可靠 —— 同一对局可能在不同来源下重复收藏）
    const actionItems = actions
      .map((a: GameAction) =>
        '<div data-action="' + a + '" data-id="' + entry.id + '" data-url="' + entry.url +
        '" style="padding:6px 10px;cursor:pointer;' +
        'font-size:0.85em;' + (isEmphasizedAction(a) ? 'color:#c53030;font-weight:600;' : 'color:#2d3748;') +
        'white-space:nowrap;" ' + HOVER + '>' + actionLabel(a) + '</div>')
      .join('');
    const linkUrl = this.bookmarkViewUrl(entry);
    const linkMenuItem = linkUrl
      ? '<div data-action="viewUrl" data-url="' + linkUrl +
        '" style="padding:6px 10px;cursor:pointer;font-size:0.85em;color:#2d3748;white-space:nowrap;" ' +
        HOVER + '>' + actionLabel('viewUrl') + '</div>'
      : '';

    const menu = `
      <div class="bookmark-dots" data-action="openBookmarkMenu" data-id="${entry.id}"
           style="position:absolute;top:8px;right:8px;width:24px;height:24px;line-height:22px;text-align:center;border-radius:50%;color:#999;font-size:16px;cursor:pointer;user-select:none;"
           onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background=''">⋮</div>
      <div data-menu-template style="display:none;position:absolute;top:34px;right:8px;min-width:96px;background:white;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.15);z-index:50;overflow:hidden;">
        ${openItem}
        ${actionItems}
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
   * KataGo 指向归档压缩包；其余来源若有 http(s) 可打开链接则直接用。
   * 内置库链接（lib:// 等伪协议）一律返回空 —— 浏览器打不开，不显示"查看链接"。
   */
  private bookmarkViewUrl(entry: FetcherBookmark): string {
    const m = entry.url.match(/^katago:\/\/date\/(\d{4}-\d{2}-\d{2})/);
    if (entry.source === 'katago' && m) {
      return 'https://katagoarchive.org/kata1/ratinggames/' + m[1] + 'rating.tar.bz2';
    }
    return normalizeExternalUrl(entry.viewUrl) || normalizeExternalUrl(entry.url);
  }

  /**
   * 收藏卡片副标题：来源专属展示
   * - 直播来源：显示"直播棋谱 · 可观看战况"
   * - 其余（含死活题、未在"最新"出现的来源）：统一显示 结果 + 手数（无结果则仅手数）
   */
  private formatBookmarkSubtitle(entry: FetcherBookmark): string {
    const liveSources = ['ogs-live', 'yike-live'];
    if (liveSources.includes(entry.source)) {
      return `<div style="font-size:0.85em;color:#c53030;margin-top:4px;">🔴 直播棋谱 · 可观看战况</div>`;
    }
    // 死活题与其它来源统一：只显示手数（有结果则附带结果），不再单独标"死活题"
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
      'lib-life-death': '内置题库',
      'lib-ai-review': '内置棋谱',
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
   * 格式化日期（含时分秒，用于相对时间回退）
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
   * 格式化日期（仅年月日，不含时分秒）
   * 入参可为时间戳数值或已是 YYYY-MM-DD 字符串
   */
  formatDateOnly(value: string | number): string {
    let ts: number;
    if (typeof value === 'number') {
      ts = value;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      // 已是 YYYY-MM-DD 形式，直接返回日期部分
      return value.slice(0, 10);
    } else {
      const parsed = Date.parse(value);
      ts = Number.isNaN(parsed) ? Date.now() : parsed;
    }
    const date = new Date(ts);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
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
