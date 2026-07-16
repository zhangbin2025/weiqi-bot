/**
 * 棋手查询结果格式化接口
 * @module presentation/pages/player/IPlayerFormatter
 *
 * 不同平台产出不同格式：Web 用 HTML，CLI 用 ANSI 纯文本。
 * Renderer 通过此接口获取内容字符串，由适配器决定渲染方式。
 */
import type { PlayerQueryResultWithBookmark, PlayerBookmark } from '../../../../../application/player';
export interface IPlayerFormatter {
  /** 初始欢迎内容 */
  formatWelcome(): string;
  /** 加载中内容 */
  formatLoading(name: string): string;
  /** 查询结果内容 */
  formatResult(result: PlayerQueryResultWithBookmark): string;
  /** 收藏条目内容（单个） */
  formatBookmarkItem(bookmark: PlayerBookmark): string;
  /** 空收藏提示 */
  formatEmptyBookmarks(): string;
}
