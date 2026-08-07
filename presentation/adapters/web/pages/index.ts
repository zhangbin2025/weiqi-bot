/**
 * 页面控制器导出
 * @module presentation/pages
 */
// AI 助手页面
export { AssistantPage } from './assistant';
// 对弈页面
export {
  PlayIndexPage,
  HMPlayPage,
  HHPlayPage,
  MMPlayPage,
  PlayHistoryPage,
  type PlayIndexPageConfig,
  type HMPlayPageConfig,
  type HHPlayPageConfig,
  type MMPlayPageConfig,
  type PlayHistoryPageConfig,
} from './play';
// 通知中心页面
export { NotificationPage, type NotificationPageConfig } from './notification';
// 棋谱下载页面
export { FetcherPage, type FetcherPageConfig } from './fetcher';
// 对手分析页面
export { OpponentPage, type OpponentPageConfig } from './opponent';
// 公共页面
export {
  GamesListPage,
  type GamesListPageConfig,
  type GameItem,
} from './common';
export {
  JosekiListPage,
  type JosekiListPageConfig,
  type IJosekiPattern,
} from './common';
// 定式页面
export {
  JosekiExplorePage,
  type JosekiExplorePageConfig,
  } from './joseki';
// 棋谱查看器页面
export {
  ReplayPage,
} from './replay';
// 云比赛页面
export { EventPage, type EventPageConfig } from './event';
export { EventListPage, type EventListPageConfig } from './event';
export { EventDetailPage, type EventDetailPageConfig } from './event';
export type { IEventFormatter } from './event';
// 决策做题页面
export {
  DecisionIndexPage,
  DecisionQuizPage,
  DecisionHistoryPage,
  type DecisionQuizPageConfig,
  type DecisionScore,
} from './decision';
// 认证页面
export { AuthPage, type IAuthPageConfig } from './auth/AuthPage';
