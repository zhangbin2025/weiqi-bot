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
      <div style="display:flex; gap:8px; margin-top:16px;">
        <div data-action="download" style="flex:1; background:linear-gradient(135deg,#48bb78 0%,#38a169 100%); color:white; padding:12px; border-radius:8px; text-align:center; cursor:pointer; font-size:15px;">📥 下载</div>
        <div data-action="view" style="flex:1; background:#f0f0f0; color:#333; padding:12px; border-radius:8px; text-align:center; cursor:pointer; font-size:15px;">👁️ 查看</div>
        <div data-action="share" style="flex:1; background:#f0f0f0; color:#333; padding:12px; border-radius:8px; text-align:center; cursor:pointer; font-size:15px;">📱 分享</div>
      </div>
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
   * 格式化单条收藏记录
   */
  formatBookmarkItem(entry: FetcherBookmark): string {
    const black = entry.black || '未知';
    const white = entry.white || '未知';
    const result = formatGameResult(entry.result);
    const source = this.formatSource(entry.source);
    const date = entry.date || '未知时间';
    const movesCount = entry.movesCount || 0;
    return `
      <div data-action="viewBookmark" data-id="${entry.id}" style="padding:10px 0; border-top:1px solid #eee; cursor:pointer;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="display:inline-block; background:linear-gradient(135deg,#667eea 0%,#764ba2 100%); color:white; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:500;">${source}</span>
          <span style="font-size:0.8em; color:#888;">${date}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:600; color:#333;">⚫ ${black}</span>
          <span style="color:#999;">vs</span>
          <span style="font-weight:600; color:#333;">⚪ ${white}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:0.85em; color:#666;">
          <span>${result && result !== '-' ? result : ''}</span>
          <span>${movesCount > 0 ? movesCount + '手' : ''}</span>
        </div>
      </div>
    `;
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
