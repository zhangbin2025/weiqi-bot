/**
 * 本地关键词匹配客户端
 * @description 纯浏览器环境可用的意图识别实现
 */

import type { ILLMClient, IntentResult, EntityResult } from './types';

/**
 * 本地关键词匹配客户端
 * 不需要任何外部依赖，直接在浏览器中运行
 */
export class LocalKeywordClient implements ILLMClient {
  constructor() {
    // 不需要任何初始化
  }

  /**
   * 意图分类
   * 纯关键词匹配
   */
  async classifyIntent(text: string): Promise<IntentResult> {
    const keywords: Record<string, string[]> = {
      download_game: ['下载', '导出', '保存棋谱', '获取棋谱', '抓棋谱', '下载棋谱'],
      start_play: ['下棋', '对局', '开始', '对战', '人机', '真人', '自我', '开始对弈', '我要下棋'],
      query_player: ['查询', '棋手', '等级分', '段位', '战绩', '查一下'],
      analyze_game: ['分析', '复盘', '讲解', '研究', '分析棋谱', '帮我复盘'],
      start_joseki_quiz: ['题目', '死活题', '练习', '答题', '出几道题', '我要做题', '定式做题'],
      explore_joseki: ['定式', '布局', '开局', '探索定式', '学习定式'],
      discover_joseki: ['发现定式', '从棋谱发现', '挖掘定式'],
      analyze_opponent: ['分析对手', '对手分析', '研究对手'],
      start_review: ['复盘', '开始复盘', 'AI 复盘'],
      generate_decision: ['实战选点', '决策题', '生成题目'],
      start_recorder: ['记谱', '录入', '记录', '开始记谱'],
      subscribe_daily_games: ['订阅', '每日棋谱', '订阅赛事'],
      subscribe_event: ['订阅比赛', '赛事订阅'],
    };

    let bestMatch = 'start_play';
    let bestScore = 0;

    for (const [intent, words] of Object.entries(keywords)) {
      const score = words.reduce((acc, word) => {
        return acc + (text.includes(word) ? 1 : 0);
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = intent;
      }
    }

    // 计算置信度
    const confidence = bestScore > 0 ? Math.min(0.95, 0.5 + bestScore * 0.15) : 0.3;

    console.log(`[LocalKeywordClient] Intent: ${bestMatch}, confidence: ${confidence}`);

    return {
      intent: bestMatch,
      confidence,
    };
  }

  /**
   * 实体提取
   * 简单的规则匹配
   */
  async extractEntities(text: string, intent: string): Promise<EntityResult> {
    const entities: Record<string, any> = {};

    // 提取棋手名
    const players = [
      '柯洁', '申真谞', '朴廷桓', '丁浩', '辜梓豪',
      '芈昱廷', '杨鼎新', '李轩豪', '范廷钰', '谢尔豪',
      '连笑', '陈耀烨', '时越', '唐韦星', '柁嘉熹',
      '江维杰', '周睿羊', '王檄', '古力', '孔杰',
    ];
    for (const player of players) {
      if (text.includes(player)) {
        entities['player'] = player;
        break;
      }
    }

    // 提取平台
    const sources = ['野狐', 'OGS', '101围棋', '弈客', '腾讯围棋', '新浪围棋', '棋魂'];
    for (const source of sources) {
      if (text.includes(source)) {
        entities['source'] = source;
        break;
      }
    }

    // 提取难度
    const difficulties = ['简单', '中等', '困难', '入门', '进阶', '高级'];
    for (const difficulty of difficulties) {
      if (text.includes(difficulty)) {
        entities['difficulty'] = difficulty;
        break;
      }
    }

    // 提取定式
    const openings = ['星位', '小目', '三三', '中国流', '宇宙流', '三连星'];
    for (const opening of openings) {
      if (text.includes(opening)) {
        entities['opening'] = opening;
        break;
      }
    }

    // 提取 URL
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) entities['url'] = urlMatch[0];

    // 提取数量
    const countMatch = text.match(/(\d+)(盘|局|道|题|个)/);
    if (countMatch) entities['count'] = parseInt(countMatch[1]!);

    // 提取模式
    if (text.includes('真人')) entities['mode'] = 'hh';
    else if (text.includes('人机')) entities['mode'] = 'hm';
    else if (text.includes('自我') || text.includes('AI') || text.includes('左右')) entities['mode'] = 'mm';

    console.log(`[LocalKeywordClient] Extracted entities:`, entities);

    return { entities };
  }

  /**
   * 检查是否可用
   */
  async isAvailable(): Promise<boolean> {
    return true; // 总是可用
  }
}
