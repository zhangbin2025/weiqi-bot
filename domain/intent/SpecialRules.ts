/**
 * 特殊规则匹配
 */

import { SpecialRule } from './types';
import { PLAYER_NAMES, EVENT_NAMES, FOXWQ_NICKNAMES } from './IntentConfig';
import { EntityValidator, SURNAMES, PLAYER_BLACKLIST } from './EntityValidator';

/**
 * URL 正则
 */
const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

/**
 * SGF 内容正则
 *
 * 以 ( 开头，后跟 ; （中间可有空白/换行）
 * 标准格式 (;GM[1]，变体 (\n;GM[1]
 */
const SGF_REGEX = /^\s*\(\s*;/

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
    match: (text: string): boolean => URL_REGEX.test(text),
    intent: 'download_game',
    extractParams: (text: string): Record<string, any> => {
      const matches = text.match(URL_REGEX);
      return { url: matches ? matches[0] : '' };
    },
    description: 'URL 自动识别为下载棋谱',
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
      return EntityValidator.isValidPlayerName(trimmed);
    },
    intent: 'query_player',
    extractParams: (text: string): Record<string, any> => ({ player: text.trim() }),
    description: '姓名模式自动识别为查询棋手',
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
