/**
 * UI 模块类型定义
 */

/** 页面路由 */
export type PageRoute =
  | '/play/hm'      // 人机对弈
  | '/play/hh'      // 真人对弈
  | '/play/mm'      // 观摩对弈
  | '/fetcher'      // 棋谱下载
  | '/player'       // 棋手查询
  | '/joseki'       // 定式探索
  | '/opponent'     // 对手分析
  | '/recorder'     // 记谱工具
  | '/quiz'         // 选点题
  | '/event'        // 云比赛
  | '/games';       // 棋谱列表

/** UI 状态 */
export interface UIState {
  loading?: boolean;
  progress?: number;
  message?: string;
  data?: any;
}

/** 平台类型 */
export type Platform = 'web' | 'electron' | 'mobile' | 'miniprogram' | 'terminal';

/** UI 控制器接口 */
export interface IUIController {
  /** 打开页面 */
  openPage(page: PageRoute, params?: Record<string, any>): Promise<void>;

  /** 关闭页面 */
  closePage?(): Promise<void>;

  /** 更新状态 */
  updateState?(state: UIState): Promise<void>;

  /** 显示进度 */
  showProgress?(taskId: string, progress: number, message: string): Promise<void>;

  /** 平台标识 */
  readonly platform: Platform;

  /** 是否可用 */
  isAvailable(): Promise<boolean>;
}

/** 对弈模式 */
export type PlayMode = 'hm' | 'hh' | 'mm';

/** 页面参数映射 */
export interface PageParams {
  '/play/hm'?: { level?: number; color?: 'black' | 'white' };
  '/play/hh'?: { roomId?: string };
  '/play/mm'?: { gameId?: string };
  '/fetcher'?: { url?: string };
  '/player'?: { name?: string };
  '/joseki'?: { position?: string };
  '/opponent'?: { playerId?: string };
  '/recorder'?: { gameId?: string };
  '/quiz'?: { quizId?: string };
  '/event'?: { contestId?: string };
  '/games'?: { playerId?: string };
}
