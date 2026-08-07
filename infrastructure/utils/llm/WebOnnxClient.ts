/**
 * ONNX Runtime Web 客户端
 * @description 用于浏览器环境的 ONNX 模型推理
 */

import type { ILLMClient, IntentResult, EntityResult } from './types';

/**
 * ONNX Runtime Web 客户端
 * 使用 ONNX Runtime Web 在浏览器中进行本地推理
 */
export class WebOnnxClient implements ILLMClient {
  private modelPath: string;
  private session: any = null;
  private initialized = false;
  private ort: any = null;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  /**
   * 初始化模型
   * 加载 ONNX 模型到内存
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // 动态加载 ONNX Runtime Web
      console.log('Loading ONNX Runtime Web...');
      
      // 尝试从 CDN 或全局获取
      if (typeof window !== 'undefined' && (window as any).ort) {
        this.ort = (window as any).ort;
        console.log('Using global ONNX Runtime Web from window');
      } else {
        console.warn('ONNX Runtime Web not available, using keyword matching fallback');
        this.initialized = true;
        return;
      }

      // 创建 ONNX 推理会话
      console.log('Loading ONNX model:', this.modelPath);
      this.session = await this.ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all'
      });
      
      this.initialized = true;
      console.log('ONNX model loaded successfully');
    } catch (error) {
      console.error('Failed to load ONNX model:', error);
      // 即使加载失败，也标记为已初始化（使用降级模式）
      this.initialized = true;
    }
  }

  /**
   * 意图分类
   * 使用 ONNX 模型进行本地推理，或降级到关键词匹配
   */
  async classifyIntent(text: string): Promise<IntentResult> {
    if (!this.initialized) {
      await this.init();
    }

    // 如果有 ONNX session，使用模型推理
    if (this.session && this.ort) {
      try {
        // TODO: 实际的 ONNX 模型推理
        // 需要根据模型的输入格式进行处理
        // 这里暂时先用关键词匹配
        console.log('ONNX model available, but inference not implemented yet');
      } catch (error) {
        console.error('ONNX inference failed:', error);
      }
    }

    // 使用关键词匹配
    return this.matchIntentByKeywords(text);
  }

  /**
   * 基于关键词的意图匹配
   * 提供基本的意图识别能力
   */
  private matchIntentByKeywords(text: string): IntentResult {
    const keywords: Record<string, string[]> = {
      download_game: ['下载', '导出', '保存棋谱', '获取棋谱', '抓棋谱', '下载棋谱'],
      start_play: ['下棋', '对局', '开始', '对战', '人机', '真人', '自我', '开始对局', '我要下', '开始对弈'],
      query_player: ['查询', '棋手', '等级分', '段位', '战绩', '查一下', '查询棋手'],
      analyze_game: ['分析', '复盘', '讲解', '研究', '分析棋谱', '帮我复盘', '分析对手'],
      start_joseki_quiz: ['题目', '死活题', '练习', '答题', '出题', '选点', '生成题', '出几道', '给我出', '生成选点', '我要做题', '定式做题'],
      explore_joseki: ['定式', '星位', '小目', '三三', '学习定式', '查定式', '定式探索'],
      discover_joseki: ['发现定式', '从棋谱发现', '挖掘定式'],
      analyze_opponent: ['分析对手', '对手分析', '研究对手'],
      start_review: ['复盘', '开始复盘', 'AI复盘'],
      generate_decision: ['实战选点', '决策题', '生成题目'],
      start_recorder: ['记谱', '录入', '记录', '记谱工具', '开始记谱'],
      subscribe_daily_games: ['订阅', '每日棋谱', '订阅赛事'],
      subscribe_event: ['订阅比赛', '赛事订阅']
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

    console.log(`Intent classification: "${bestMatch}" (confidence: ${confidence.toFixed(2)})`);

    return {
      intent: bestMatch,
      confidence,
    };
  }

  /**
   * 实体提取
   * 基于规则的实体识别
   */
  async extractEntities(text: string, intent: string): Promise<EntityResult> {
    const entities: Record<string, any> = {};

    // 提取棋手名
    const players = [
      '柯洁', '申真谞', '朴廷桓', '丁浩', '辜梓豪',
      '芈昱廷', '杨鼎新', '李轩豪', '范廷钰', '谢尔豪',
      '连笑', '陈耀烨', '时越', '唐韦星', '柁嘉熹',
      '江维杰', '周睿羊', '王檄', '古力', '孔杰'
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
    else if (text.includes('自我') || text.includes('AI自己')) entities['mode'] = 'mm';

    console.log('Extracted entities:', entities);

    return { entities };
  }

  /**
   * 检查是否可用
   */
  async isAvailable(): Promise<boolean> {
    return this.initialized && this.session !== null;
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
      this.initialized = false;
    }
  }
}
