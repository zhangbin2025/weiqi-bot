/**
 * 意图配置
 * @module domain/intent/intent-config
 */

/**
 * 意图配置项
 */
export interface IntentConfig {
  /** 意图显示名称 */
  name: string;
  /** 跳转路径 */
  path: string;
  /** 需要的参数列表 */
  params: string[];
  /** 
   * 必要参数列表（用于后台任务判断）
   * 外层数组是“或”的关系，内层数组是“且”的关系
   * 例如：[['url'], ['sgf']] 表示：有 url 或有 sgf 即可
   */
  requiredParams?: string[][];
}

/**
 * 意图配置字典
 * 定义每个意图的名称、跳转路径和参数
 */
export const INTENT_CONFIG: Record<string, IntentConfig> = {
  download_game: {
    name: '下载棋谱',
    path: '../fetcher/index.html',
    params: ['player', 'source', 'url', 'sessionId'],
    requiredParams: [['url'], ['sgf'], ['sessionId']],  // 必须有 url 或 sgf 或 sessionId
  },
  // bg_query_player 和 bg_analyze_opponent 已移除，改用 responseType 区分
  start_play: {
    name: '开始对弈',
    path: '../play/index.html',
    params: ['mode']
  },
  query_player: {
    name: '查询棋手',
    path: '../player/index.html',
    params: ['player'],
    requiredParams: [['player']],  // 必须有 player
  },
  analyze_opponent: {
    name: '对手分析',
    path: '../opponent/index.html',
    params: ['player'],
    requiredParams: [['player']],  // 必须有 player
  },
  // bg_analyze_opponent 已移除
  query_task_progress: {
    name: '查询任务进度',
    path: '',
    params: ['taskId']
  },
  cancel_task: {
    name: '取消任务',
    path: '',
    params: ['taskId']
  },
  start_joseki_quiz: {
    name: '定式挑战',
    path: '../joseki/quiz.html',
    params: ['difficulty', 'count']
  },
  start_joseki: {
    name: '定式',
    path: '../joseki/index.html',
    params: []
  },
  explore_joseki: {
    name: '定式探索',
    path: '../joseki/explore.html',
    params: ['opening']
  },
  discover_joseki: {
    name: '定式发现',
    path: '../joseki/discover.html',
    params: ['dateOffset', 'limit', 'taskId']
  },
  generate_decision: {
    name: '实战选点',
    path: '../decision/index.html',
    params: []
  },
  start_review: {
    name: '复盘分析',
    path: '../review/index.html',
    params: ['sgf', 'sessionId', 'archiveId'],  // ← 添加 archiveId
    requiredParams: [['sgf'], ['url'], ['archiveId'], ['sessionId']],  // 必须有其中之一
  },
  start_replay: {
    name: '棋谱回放',
    path: '../replay/index.html',
    params: ['sgf', 'sessionId'] // 支持 sgf 或 sessionId
  },
  start_recorder: {
    name: '记谱工具',
    path: '../recorder/index.html',
    params: []
  },
  search_event: {
    name: '赛事查询',
    path: '../event/index.html',
    params: ['area', 'month', 'keyword']
  }
};
