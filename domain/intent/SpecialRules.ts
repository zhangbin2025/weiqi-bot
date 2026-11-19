/**
 * 特殊规则匹配
 */

import { SpecialRule } from './types';
import {
  PLAYER_NAMES, EVENT_NAMES, FOXWQ_NICKNAMES, INTENT_KEYWORDS,
} from './IntentConfig';
import { EntityValidator } from './EntityValidator';
import { ENTITY_DICTS } from './entity-dicts';
import { GAME_URL_REGEX } from './libUrl';

/**
 * 可抓取的棋谱链接（在线 http(s) + 内置棋谱库 lib:// + KataGo 归档 katago://）
 */
const GAME_URL_PATTERN = GAME_URL_REGEX;

/**
 * SGF 内容正则
 *
 * 以 ( 开头，后跟 ; （中间可有空白/换行）
 * 标准格式 (;GM[1]，变体 (\n;GM[1]
 */
const SGF_REGEX = /^\s*\(\s*;/

/**
 * 姓名模式会误判成棋手的「非姓名」词，命中即排除。
 *
 * player_query 优先级 85 高于事件/做题等规则，若不排除，这些词会被
 * 抢先判成姓名跳到棋手查询页。来源均为项目既有字典，不引入新口径：
 * - EVENT_NAMES / FOXWQ_NICKNAMES / ENTITY_DICTS.openings：赛事名、昵称、
 *   定式名里以百家姓开头的词（如「应氏杯」「农心杯」「星位」）。
 * - INTENT_KEYWORDS 的 core/variant：功能孤词（如「段位」「简单题」），
 *   它们本应由 matchExactKeyword / 评分层按功能意图处理。
 * - 围棋术语/概念词：ccecff8 修过的「双打吃」「双活」「双飞燕」等，
 *   首字恰是百家姓单姓，属知识问答，不该跳棋手查询页。
 * 只做「整句相等」排除，不影响含这些词的自然语言句子。
 */
const PLAYER_NAME_EXCLUDES: ReadonlySet<string> = new Set<string>([
  ...EVENT_NAMES,
  ...FOXWQ_NICKNAMES,
  ...ENTITY_DICTS.openings,
  ...INTENT_KEYWORDS.flatMap(c => [...c.coreKeywords, ...(c.variantKeywords ?? [])]),
  '双打吃', '双活', '双飞燕', '打吃', '征子', '倒脱靴',
  '王座', '马步', '死活', '手筋', '官子', '定式', '恶手', '选点',
]);

/**
 * 响应类型识别正则
 */
const BACKGROUND_PATTERN = /后台|后台查询|后台搜索|后台执行|后台任务/;
const PERIODIC_PATTERN = /每天|每周|定时|定期/;
const DELAYED_PATTERN = /(\d+)小时后|(\d+)分钟后|(\d+)秒后/;

/**
 * 特殊规则配置表
 */
export const SPECIAL_RULES: SpecialRule[] = [
  {
    name: 'url_download',
    priority: 100,
    match: (text: string): boolean => GAME_URL_PATTERN.test(text),
    intent: 'download_game',
    extractParams: (text: string): Record<string, any> => {
      const matches = text.match(GAME_URL_PATTERN);
      return { url: matches ? matches[0] : '' };
    },
    description: 'URL 自动识别为下载棋谱（http/https 在线链接 + lib:// 内置棋谱库 + katago:// KataGo 归档）',
  },
  {
    name: 'sgf_download',
    priority: 90,
    match: (text: string): boolean => {
      // 检测文本中是否包含 SGF 内容（不要求整个文本都是 SGF）
      return EntityValidator.extractSgf(text) !== null;
    },
    intent: 'download_game',
    extractParams: (text: string): Record<string, any> => {
      // 提取 SGF 内容（去除前面的描述文字）
      const sgf = EntityValidator.extractSgf(text);
      return { sgf: sgf || text };
    },
    description: 'SGF 内容自动识别为下载棋谱',
  },
  {
    name: 'player_query',
    priority: 85,
    match: (text: string): boolean => {
      const trimmed = text.trim();
      // 功能助手页的意图识别固定走本地流程（不再有 LLM 兜底），因此
      // 「输入任意姓名 → 跳棋手查询」必须由本地规则自己完成：
      // 已知棋手名单内的裸姓名照旧确定性命中；名单外姓名用百家姓模式
      // 识别（含业余棋手、复姓）。非姓名的围棋术语/赛事名/功能孤词由
      // PLAYER_NAME_EXCLUDES 排除，避免 ccecff8 修过的误判回归。
      // 带动作或上下文的自然语言（「查询柯洁」「帮我查查柯洁」）不满足
      // 姓名模式，仍交给评分层，不会被本规则劫持。
      if (PLAYER_NAME_EXCLUDES.has(trimmed)) return false;
      return PLAYER_NAMES.includes(trimmed) || EntityValidator.isValidPlayerName(trimmed);
    },
    intent: 'query_player',
    extractParams: (text: string): Record<string, any> => ({ player: text.trim() }),
    description: '裸姓名（名单内或百家姓模式）自动识别为查询棋手',
  },
  {
    name: 'foxwq_nickname',
    priority: 86,
    match: (text: string): boolean => {
      const trimmed = text.trim();
      return FOXWQ_NICKNAMES.includes(trimmed);
    },
    intent: 'analyze_opponent',
    extractParams: (text: string): Record<string, any> => ({ player: text.trim() }),
    description: '野狐昵称自动识别为对手分析',
  },
  {
    name: 'quiz_candidates',
    priority: 82,
    match: (text: string): boolean => {
      return ['做题', '答题', '出题', '练习', '训练', '刷题'].includes(text.trim());
    },
    intent: 'help',
    extractParams: (): Record<string, any> => ({
      candidates: ['实战选点', '死活题', '定式挑战'],
    }),
    description: '泛化做题词产生候选',
  },
  {
    name: 'tsumego_puzzle',
    priority: 80,
    match: (text: string): boolean => {
      const trimmed = text.trim();
      return trimmed === '死活' || trimmed.includes('死活题');
    },
    intent: 'start_puzzle',
    description: '死活/死活题关键词识别为进入做题页练习',
  },
  {
    name: 'live_stream',
    priority: 79,
    match: (text: string): boolean => {
      const trimmed = text.trim();
      return trimmed === '直播' || (trimmed.includes('直播') && !trimmed.includes('http'));
    },
    intent: 'download_game',
    extractParams: (): Record<string, any> => {
      const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
      return { source: isApp ? 'yike-live' : 'ogs-live' };
    },
    description: '直播关键词：App环境跳弈客直播，Web环境跳OGS在线',
  },
  {
    name: 'event_search',
    priority: 75,
    match: (text: string): boolean => {
      return EVENT_NAMES.some(event => text.includes(event));
    },
    intent: 'search_event',
    extractParams: (text: string): Record<string, any> => {
      const found = EVENT_NAMES.find(event => text.includes(event));
      return { event: found || '' };
    },
    description: '赛事名称自动识别为搜索赛事',
  },
  {
    name: 'event_by_region_time',
    priority: 74,
    match: (text: string): boolean => {
      // 检查是否包含区域关键词
      const regions = ['全国', '北京', '上海', '广东', '浙江', '江苏', '四川', '湖北', '山东', '福建', '陕西', '天津', '重庆'];
      const hasRegion = regions.some(r => text.includes(r));
      
      // 检查是否包含时间关键词
      const timeKeywords = ['最近', '一个月', '三个月', '半年', '一年', '最近一个月', '最近三个月', '最近半年', '最近一年', '本周', '本月'];
      const hasTime = timeKeywords.some(t => text.includes(t));
      
      // 检查是否包含赛事相关词（但不一定是EVENT_NAMES）
      const eventRelated = ['比赛', '赛事', '大赛', '联赛', '活动', '围棋赛', '棋赛', '对局', '下棋'];
      const hasEvent = eventRelated.some(e => text.includes(e));
      
      // 如果同时包含区域和时间，或者包含区域+赛事相关词，很可能是赛事查询
      return (hasRegion && hasTime) || (hasRegion && hasEvent);
    },
    intent: 'search_event',
    extractParams: (text: string): Record<string, any> => {
      return {};
    },
    description: '区域+时间或区域+赛事词自动识别为搜索赛事',
  },
  {
    name: 'evil_move',
    priority: 70,
    match: (text: string): boolean => text.includes('恶手题') || text.includes('最新恶手'),
    intent: 'generate_decision',
    extractParams: (text: string): Record<string, any> => ({
      type: 'evil_move',
      latest: text.includes('最新'),
    }),
    description: '恶手题自动识别为实战选点',
  },
  {
    name: 'help',
    priority: 65,
    match: (text: string): boolean => {
      const trimmed = text.trim();
      return trimmed.includes('帮助') || 
             trimmed.includes('help') || 
             trimmed === '?' || 
             trimmed === '？';
    },
    intent: 'help',
    description: '帮助关键词',
  },
];

/**
 * 按优先级排序的规则
 */
export const SORTED_RULES = [...SPECIAL_RULES].sort((a, b) => b.priority - a.priority);
