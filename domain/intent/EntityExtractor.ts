/**
 * 实体提取器实现
 * @module domain/intent/EntityExtractor
 */

import type { IEntityExtractor } from './IEntityExtractor';
import { ENTITY_DICTS, PROVINCES } from './entity-dicts';
import { EntityValidator } from './EntityValidator';

/**
 * 实体提取器
 * 从用户输入文本中提取命名实体（棋手名、平台、定式等）
 */
export class EntityExtractor implements IEntityExtractor {
  /**
   * 从文本中提取实体
   * @param text 用户输入文本
   * @param intent 识别出的意图（可选）
   * @returns 提取的实体字典
   */
  extract(text: string, intent?: string): Record<string, any> {
    const entities: Record<string, any> = {};

    // 优先提取 SGF 内容（无论什么意图）
    const sgf = EntityValidator.extractSgf(text);
    if (sgf) {
      entities['sgf'] = sgf;
    }

    // 提取平台
    for (const source of ENTITY_DICTS.sources) {
      if (text.includes(source)) {
        entities['source'] = source;
        break;
      }
    }

    // 提取定式
    for (const opening of ENTITY_DICTS.openings) {
      if (text.includes(opening)) {
        entities['opening'] = opening;
        break;
      }
    }

    // 提取难度
    for (const diff of ENTITY_DICTS.difficulties) {
      if (text.includes(diff)) {
        entities['difficulty'] = diff;
        break;
      }
    }

    // 提取数量
    const countMatch = text.match(/(\d+)道/);
    if (countMatch) {
      entities['count'] = countMatch[1];
    }

    // 提取 URL
    const url = EntityValidator.extractUrl(text);
    if (url) {
      entities['url'] = url;
    }

    // 提取对弈模式
    if (text.includes('真人') || text.includes('双人') || text.includes('和朋友')) {
      entities['mode'] = 'hh';
    } else if (text.includes('人机') || text.includes('AI下棋') || text.includes('和AI下')) {
      entities['mode'] = 'hm';
    } else if (text.includes('观摩') || text.includes('AI对弈') || text.includes('机机') || text.includes('AI自己')) {
      entities['mode'] = 'mm';
    }

    // 提取任务 ID
    const taskId = EntityValidator.extractTaskId(text);
    if (taskId) {
      entities['taskId'] = taskId;
    }
    
    // 提取赛事查询参数
    if (intent === 'search_event') {
      this.extractEventParams(text, entities);
    }

    // 提取对手分析参数
    if (intent === 'analyze_opponent' || intent === 'bg_analyze_opponent') {
      this.extractOpponentParams(text, entities);
    }

    // 提取棋手查询参数
    if (intent === 'query_player') {
      this.extractPlayerParams(text, entities);
    }

    // 提取复盘参数
    if (intent === 'start_review' || intent === 'start_replay') {
      this.extractReviewParams(text, entities);
    }

    return entities;
  }

  /**
   * 将实体转换为参数
   * @param entities 提取的实体
   * @returns 参数字典
   */
  toParams(entities: Record<string, any>): Record<string, any> {
    const params: Record<string, any> = {};

    // 直接复制所有实体
    for (const [key, value] of Object.entries(entities)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }

    return params;
  }

  /**
   * 提取赛事查询参数
   */
  private extractEventParams(text: string, entities: Record<string, any>): void {
    // 提取省份或全国
    if (text.includes('全国')) {
      entities['area'] = '全国';
    } else {
      for (const p of PROVINCES) {
        if (text.includes(p)) {
          // 添加"省"字（除了直辖市）
          const municipalities = ['北京', '上海', '天津', '重庆'];
          if (municipalities.includes(p)) {
            entities['area'] = p + '市';
          } else {
            entities['area'] = p + '省';
          }
          break;
        }
      }
    }

    // 提取期限（月数）
    const timePatterns = [
      { pattern: /最近一个月|最近1个月/, value: 1 },
      { pattern: /最近三个月|最近3个月/, value: 3 },
      { pattern: /最近半年|最近六个月|最近6个月/, value: 6 },
      { pattern: /最近一年|最近1年|最近一年内/, value: 12 },
      { pattern: /最近(\d+)天/, value: (m: RegExpMatchArray) => Math.ceil(parseInt(m[1]!) / 30) }, // 天数转月数
      { pattern: /(\d+)个月内/, value: (m: RegExpMatchArray) => parseInt(m[1]!) },
      { pattern: /最近/, value: 1 }, // 默认最近一个月
    ];

    for (const { pattern, value } of timePatterns) {
      const match = text.match(pattern);
      if (match) {
        if (typeof value === 'function') {
          entities['month'] = value(match);
        } else {
          entities['month'] = value;
        }
        break;
      }
    }

    // 提取关键词
    const keywords = ['业余', '职业', '青少年', '成人', '女子', '男子'];
    let foundKeyword = false;
    
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        entities['keyword'] = keyword;
        foundKeyword = true;
        break;
      }
    }
    
    // 如果没有找到预定义关键词，尝试提取具体赛事名称
    if (!foundKeyword) {
      // 1. 检查是否包含EVENT_NAMES中的词
      const EVENT_NAMES = [
        'LG杯', '应氏杯', '三星杯', '春兰杯', '梦百合杯', '烂柯杯',
        '农心杯', '天府杯', '百灵杯', '穹窿山杯', '威孚房开杯',
        '世界围棋锦标赛', '世界公开赛', '世界大师赛',
        '联赛', '围甲', '围乙', '业余联赛',
      ];
      
      for (const event of EVENT_NAMES) {
        if (text.includes(event)) {
          entities['keyword'] = event;
          foundKeyword = true;
          break;
        }
      }
      
      // 2. 如果还没有找到，尝试从文本中提取赛事名称
      if (!foundKeyword) {
        // 分词并提取关键词
        // 步骤1: 简单分词（按常见词分割）
        let words = text;
        
        // 步骤2: 排除区域词
        const regionWords = [
          '全国', '北京', '上海', '天津', '重庆', 
          '广东', '浙江', '江苏', '四川', '湖北', '山东', '福建', '陕西',
          '省', '市', '区', '县'
        ];
        for (const region of regionWords) {
          words = words.replace(new RegExp(region, 'g'), ' ');
        }
        
        // 步骤3: 排除时间词
        const timeWords = [
          '最近', '最近一个月', '最近三个月', '最近半年', '最近一年',
          '一个月', '三个月', '半年', '一年',
          '本周', '本月', '这周', '这个月'
        ];
        for (const time of timeWords) {
          words = words.replace(new RegExp(time, 'g'), ' ');
        }
        
        // 步骤4: 排除常见词
        const commonWords = ['的', '了', '在', '有', '和', '与', '或', '要', '想', '看', '查', '找', '搜', '问'];
        for (const common of commonWords) {
          words = words.replace(new RegExp(common, 'g'), ' ');
        }
        
        // 步骤5: 排除赛事词
        const eventWords = ['比赛', '赛事', '大赛', '联赛', '杯赛', '杯', '赛', '活动'];
        for (const event of eventWords) {
          words = words.replace(new RegExp(event, 'g'), ' ');
        }
        
        // 步骤6: 提取剩余的词（连续的中文字符）
        const remainingWords = words.match(/[\u4e00-\u9fa5]{2,8}/g);
        
        if (remainingWords && remainingWords.length > 0) {
          // 步骤7: 挑选一个较不常见的词（通常是第一个，因为前面的是修饰词）
          // 或者选择最长的词（赛事名通常是专有名词，长度适中）
          const keyword = remainingWords.reduce((a, b) => a.length >= b.length ? a : b);
          
          // 最后再检查一下是否是常见词
          const finalExclude = ['围棋', '象棋', '棋类'];
          if (!finalExclude.some(ex => keyword.includes(ex))) {
            entities['keyword'] = keyword;
            foundKeyword = true;
          }
        }
      }
    }
  }

  /**
   * 提取对手分析参数
   */
  private extractOpponentParams(text: string, entities: Record<string, any>): void {
    // 提取野狐昵称（如果还没提取到棋手名）
    if (!entities['player']) {
      // 匹配模式："分析对手XXX"、"对手XXX"、"分析XXX"
      const patterns = [
        /分析对手["']?([^\s"',，。！？]+)["']?/,
        /对手["']?([^\s"',，。！？]+)["']?/,
        /分析["']?([^\s"',，。！？]+)["']?的?对手/,
      ];
      
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          entities['player'] = match[1];
          break;
        }
      }
    }

    // 提取分析类型
    if (text.includes('棋风') || text.includes('风格')) {
      entities['analyzeType'] = 'style';
    } else if (text.includes('战绩') || text.includes('胜率')) {
      entities['analyzeType'] = 'record';
    } else if (text.includes('强弱') || text.includes('实力')) {
      entities['analyzeType'] = 'strength';
    }

    // 提取时间范围
    const timePatterns = [
      /最近(\d+)盘/,
      /(\d+)天内/,
      /(\d+)个月/
    ];

    for (const pattern of timePatterns) {
      const match = text.match(pattern);
      if (match) {
        entities['timeRange'] = match[0];
        break;
      }
    }
  }

  /**
   * 提取棋手查询参数
   */
  private extractPlayerParams(text: string, entities: Record<string, any>): void {
    // 如果已有 player 实体，直接返回（可能来自特殊规则）
    if (entities['player']) return;
    
    // 匹配模式（排除“的”字，避免提取到“申真谞的等级分”）
    const patterns = [
      /查询棋手["']?([^\s"',，。！？的]+)["']?/,
      /查询["']?([^\s"',，。！？的]+)["']?/,
      /查["']?([^\s"',，。！？的]+)["']?/,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = match[1];
        // 关键：验证是否是真实姓名（百家姓验证）
        if (EntityValidator.isValidPlayerName(name)) {
          entities['player'] = name;
        }
        break;
      }
    }
  }

  /**
   * 提取复盘参数
   */
  private extractReviewParams(text: string, entities: Record<string, any>): void {
    // 如果文本中已有 SGF，直接使用
    if (entities['url'] && entities['url'].includes('.sgf')) {
      entities['sgf'] = entities['url'];
    }

    // 提取复盘类型
    if (text.includes('深度') || text.includes('详细')) {
      entities['reviewType'] = 'deep';
    } else if (text.includes('快速') || text.includes('简单')) {
      entities['reviewType'] = 'quick';
    }

    // 提取 archiveId（支持多种格式）
    const archivePatterns = [
      /复盘棋谱\s*([a-zA-Z0-9_-]+)/,  // "复盘棋谱 xxx"
      /复盘\s*([a-zA-Z0-9_-]+)/,  // "复盘 xxx"
      /归档id[:\s]*([a-zA-Z0-9_-]+)/i,  // "归档id: xxx" 或 "归档id xxx"
      /archiveid[:\s]*([a-zA-Z0-9_-]+)/i,  // "archiveId: xxx" 或 "archiveId xxx"
      /棋谱id[:\s]*([a-zA-Z0-9_-]+)/i,  // "棋谱id: xxx" 或 "棋谱id xxx"
    ];

    for (const pattern of archivePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        entities['archiveId'] = match[1];
        break;
      }
    }
  }
}

/**
 * 默认实体提取器实例
 */
export const entityExtractor = new EntityExtractor();
