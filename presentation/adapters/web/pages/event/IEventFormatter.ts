/**
 * 赛事格式化接口
 * @module presentation/pages/event/IEventFormatter
 *
 * 不同平台产出不同格式：Web 用 HTML，CLI 用 ANSI 纯文本。
 * Renderer 通过此接口获取内容字符串，由适配器决定渲染方式。
 */
import type { EventHistoryEntry, EventDetail } from '../../../../../application/event';
import type { Event, Group } from '../../../../../services/event/types';
import type { RankingResult, PlayerRanking } from '../../../../../domain/ranking';
import type { AgainstPlanResult } from '../../../../../services/event/types';
/** 首页格式化方法 */
export interface IEventQueryFormatter {
  /** 查询面板内容（含地区/月份选择器说明） */
  formatQueryPanel(): string;
  /** 最近面板内容 */
  formatRecentPanel(): string;
  /** 历史条目（单个） */
  formatHistoryItem(entry: EventHistoryEntry): string;
  /** 空历史提示 */
  formatEmptyHistory(): string;
  /** 加载中 */
  formatLoading(message: string): string;
}
/** 列表页格式化方法 */
export interface IEventListFormatter {
  /** 比赛卡片 */
  formatEventCard(event: Event, index: number): string;
  /** 城市分组 */
  formatCityGroup(city: string, events: Event[]): string;
  /** 空列表提示 */
  formatEmptyList(tab: string): string;
  /** 列表头摘要 */
  formatListHeader(area: string, month: number): string;
  /** 列表页标题栏内容 */
  formatListHeaderContent(area: string, month: number): string;
}
/** 详情页格式化方法 */
export interface IEventDetailFormatter {
  /** 详情页 header 内容 */
  formatHeaderContent(): string;
  /** 排名表格 */
  formatRankingTable(rankings: RankingResult['rankings'], needsOriginal?: Set<string>): string;
  /** 对阵卡片 */
  formatMatchCard(match: AgainstPlanResult['rows'][number], needsOriginal?: Set<string>, scoreMap?: Map<string, number>): string;
  /** 批量渲染对阵表 */
  formatMatchTable(matches: AgainstPlanResult['rows']): string;
  /** 轮次导航 */
  formatRoundNav(current: number, total: number): string;
  /** 加载进度 */
  formatProgress(percent: number, message: string): string;
  /** 加载错误 */
  formatLoadError(message: string): string;
  /** 空排名提示 */
  formatEmptyRanking(): string;
  /** 空对阵提示 */
  formatEmptyMatches(): string;
  /** 分组选择项 */
  formatGroupOption(group: Group): string;
  /** 对手详情弹窗 */
  formatOpponentModal(playerName: string, games: PlayerRanking['games'], rankMap?: Map<string, { rank: number; score: number }>): string;
}
/** 完整格式化接口（三个子接口合并） */
export interface IEventFormatter extends IEventQueryFormatter, IEventListFormatter, IEventDetailFormatter {}
