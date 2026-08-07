/**
 * 意图配置和数据
 */

import { IntentConfig, SpecialRule } from './types';

/**
 * 意图关键词配置
 */
export const INTENT_KEYWORDS: IntentConfig[] = [
  {
    intent: 'query_player',
    page: '../player/index.html',
    coreKeywords: ['查询棋手', '查棋手', '查等级分', '等级分', '段位', '战绩', '积分'],
    description: '查询棋手信息（等级分、段位）',
  },
  {
    intent: 'search_event',
    page: '../event/index.html',
    coreKeywords: ['赛事', '比赛', '大赛', '日程', '联赛', 'LG杯', '应氏杯', '三星杯', '春兰杯', '梦百合杯', '烂柯杯'],
    description: '搜索赛事信息',
  },
  {
    intent: 'analyze_opponent',
    page: '../opponent/index.html',
    coreKeywords: ['分析对手', '对手分析', '研究对手', '对手棋谱'],
    variantKeywords: ['对手', '对战'],
    isLongRunning: true,
    description: '分析对手棋谱和定式',
  },
  // bg_analyze_opponent 已移除，改用 analyze_opponent + responseType
  {
    intent: 'start_review',
    page: '../review/index.html',
    coreKeywords: ['复盘', '分析棋谱', 'AI复盘', '帮我复盘', '胜率'],
    variantKeywords: ['评估', '恶手', '分析一下'],
    isLongRunning: true,
    description: 'AI 复盘分析',
  },
  {
    intent: 'start_replay',
    page: '../replay/index.html',
    coreKeywords: ['打谱', '回放', '查看棋谱', '棋谱回放'],
    variantKeywords: ['看棋谱', '打开棋谱'],
    description: '棋谱回放打谱',
  },
  {
    intent: 'discover_joseki',
    page: '../joseki/discover.html',
    coreKeywords: ['发现定式', '挖掘定式', '定式发现', '从棋谱发现'],
    variantKeywords: ['提取定式', '归纳定式'],
    isLongRunning: true,
    description: '从棋谱中发现定式',
  },
  {
    intent: 'start_joseki',
    page: '../joseki/index.html',
    coreKeywords: ['定式'],
    description: '定式功能入口',
  },
  {
    intent: 'explore_joseki',
    page: '../joseki/explore.html',
    coreKeywords: ['定式探索', '查定式', '学习定式'],
    variantKeywords: ['星位', '小目', '三三', '中国流', '宇宙流', '三连星'],
    description: '探索和学习定式',
  },
  {
    intent: 'start_joseki_quiz',
    page: '../joseki/quiz.html',
    coreKeywords: ['定式做题', '定式练习', '定式挑战'],
    variantKeywords: ['测验', '测试', '简单题', '困难题', '中等题'],
    description: '定式做题练习',
  },
  {
    intent: 'generate_decision',
    page: '../decision/index.html',
    coreKeywords: ['恶手题', '实战选点', '选点题', '决策题', '生成题目', '答题', '出题', '做题', '练习', '训练', '刷题'],
    variantKeywords: ['恶手', '选点', '决策', '最新'],
    isLongRunning: true,
    description: '生成实战选点题',
  },
  {
    intent: 'start_play',
    page: '../play/index.html',
    coreKeywords: ['人机对弈', 'AI下棋', '和AI下', '人机'],
    variantKeywords: ['我要下', '开始对局', '下棋', '下盘棋', '对弈', '开始对弈', '要下棋', '下棋咯'],
    description: '人机对弈',
  },
  {
    intent: 'start_recorder',
    page: '../recorder/index.html',
    coreKeywords: ['记谱', '记谱工具', '开始记谱', '录入'],
    variantKeywords: ['记录棋谱', '录入棋谱'],
    description: '记谱工具',
  },
  {
    intent: 'download_game',
    page: '../fetcher/index.html',
    coreKeywords: ['下载棋谱', '取谱', '获取棋谱', '下载', '抓取棋谱', '抓谱'],
    variantKeywords: ['帮我下载', '帮我取', '棋谱下载'],
    description: '下载棋谱',
  },
];

/**
 * 棋手姓名列表
 */
export const PLAYER_NAMES = [
  '柯洁', '申真谞', '朴廷桓', '丁浩', '辜梓豪',
  '芈昱廷', '杨鼎新', '李轩豪', '范廷钰', '谢尔豪',
  '连笑', '陈耀烨', '时越', '唐韦星', '柁嘉熹',
  '江维杰', '周睿羊', '王檄', '古力', '孔杰',
  '常昊', '马晓春', '聂卫平', '吴清源', '李昌镐',
  // 新增棋手
  '马天放', '王星昊', '许嘉阳', '廖元赫', '韩一洲',
  '陈梓健', '郭闻潮', '孙腾宇', '陶欣然', '韩国外',
  '於之莹', '周泓余', '陆敏全', '李赫',
  // 韩国棋手
  '李世石', '朴永训', '崔哲瀚', '元晟溱', '姜东润',
  '金志锡', '朴键昊', '金明训', '申旻埈', '卞相壹',
  '韩友赈', '吴侑珍', '崔精',
  // 日本棋手
  '井山裕太', '张栩', '山下敬吾', '羽根直树',
  // 中国台湾棋手
  '王元均', '林君谚', '许皓鋐',
];

/**
 * 赛事名称列表
 */
export const EVENT_NAMES = [
  'LG杯', '应氏杯', '三星杯', '春兰杯', '梦百合杯', '烂柯杯',
  '农心杯', '天府杯', '百灵杯', '穹窿山杯', '威孚房开杯',
  '世界围棋锦标赛', '世界公开赛', '世界大师赛',
  '联赛', '围甲', '围乙', '业余联赛',
];

/**
 * 野狐昵称列表
 */
export const FOXWQ_NICKNAMES = [
  '潜伏', '笑傲江湖', '剑胆琴心', '围棋少年', '棋魂',
  '天下第一', '无敌', '绝艺', '天书', '神之一手',
];

/**
 * 平台名称映射
 */
export const SOURCE_KEYWORDS: Record<string, string> = {
  '野狐': 'foxwq',
  '腾讯围棋': 'foxwq',
  'OGS': 'ogs',
  'ogs': 'ogs',
  '101围棋': '101',
  '弈客': 'yik',
  '新浪围棋': 'sina',
};

/**
 * 难度映射
 */
export const DIFFICULTY_KEYWORDS: Record<string, string> = {
  '简单': 'easy',
  '容易': 'easy',
  '简单模式': 'easy',
  '中等': 'medium',
  '普通': 'medium',
  '中等难度': 'medium',
  '困难': 'hard',
  '难': 'hard',
  '困难模式': 'hard',
  '地狱': 'hell',
  '地狱难度': 'hell',
};

/**
 * 定式名称映射
 */
export const OPENING_KEYWORDS: Record<string, string> = {
  '星位': 'star',
  '小目': 'komoku',
  '三三': 'sansan',
  '中国流': 'chinese',
  '宇宙流': 'cosmic',
  '三连星': 'sanlianxing',
};

/**
 * 围棋领域词库（用于分词匹配）
 */
export const WEIQI_VOCABULARY = {
  actions: {
    '查询': ['query_player', 'search_event'],
    '搜索': ['search_event'],
    '分析': ['analyze_opponent', 'start_review'],
    '研究': ['analyze_opponent'],
    '发现': ['discover_joseki'],
    '挖掘': ['discover_joseki'],
    '复盘': ['start_review'],
    '打谱': ['start_replay'],
    '做题': ['start_joseki_quiz', 'generate_decision'],
    '练习': ['start_joseki_quiz'],
    '下棋': ['start_play'],
    '对弈': ['start_play'],
    '下载': ['download_game'],
    '记谱': ['start_recorder'],
  },
  objects: {
    '棋手': ['query_player'],
    '对手': ['analyze_opponent'],
    '赛事': ['search_event'],
    '定式': ['explore_joseki', 'start_joseki_quiz', 'discover_joseki'],
    '棋谱': ['start_replay', 'download_game'],
  },
};
