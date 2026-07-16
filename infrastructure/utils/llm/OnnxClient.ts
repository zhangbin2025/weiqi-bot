/**
 * ONNX 本地模型客户端（Node.js 版本）
 * @description 使用 ONNX Runtime Node 进行本地意图识别
 *
 * 注意：需要安装 onnxruntime-node 作为可选依赖
 * npm install onnxruntime-node
 *
 * 此文件用于 Node.js 环境，浏览器环境请使用 WebOnnxClient
 */

import type { ILLMClient, IntentResult, EntityResult } from './types';

/**
 * ONNX 本地模型客户端（Node.js 版本）
 * 支持离线推理，适用于无需外部 API 的场景
 */
export class OnnxClient implements ILLMClient {
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
      // 检查是否在 Node.js 环境
      const isNodeJs = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
      if (!isNodeJs) {
        console.warn('OnnxClient not supported in browser, use WebOnnxClient instead');
        this.initialized = true;
        return;
      }

      // 暂时禁用 ONNX 功能，只使用关键词匹配
      // 避免 Vite 构建问题
      console.warn('OnnxClient temporarily disabled, using keyword matching');
      this.initialized = true;
    } catch (error) {
      console.error('Failed to load ONNX model:', error);
      this.initialized = true;
    }
  }

  /**
   * 意图分类
   * 使用关键词匹配
   */
  async classifyIntent(text: string): Promise<IntentResult> {
    return this.matchIntentByKeywords(text);
  }

  /**
   * 基于关键词的意图匹配
   */
  private matchIntentByKeywords(text: string): IntentResult {
    const keywords: Record<string, string[]> = {
      download_game: ['下载', '导出', '保存棋谱', '获取棋谱'],
      play: ['下棋', '对局', '开始', '对战', '人机'],
      query_player: ['查询', '棋手', '等级分', '段位', '战绩'],
      analyze_game: ['分析', '复盘', '讲解', '研究'],
      quiz: ['题目', '死活题', '练习', '答题'],
      joseki: ['定式', '布局', '开局'],
      record: ['记谱', '录入', '记录'],
      viewer: ['查看', '展示', '棋谱', '演示'],
      competition: ['比赛', '赛事', '竞赛', '对弈'],
      self_play: ['自我对局', '左右互搏', '自我']
    };

    let bestMatch = 'play';
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

    const confidence = bestScore > 0 ? Math.min(0.9, 0.5 + bestScore * 0.1) : 0.3;

    return {
      intent: bestMatch,
      confidence,
    };
  }

  /**
   * 实体提取
   */
  async extractEntities(text: string, intent: string): Promise<EntityResult> {
    const entities: Record<string, any> = {};

    // 提取棋手名
    const playerPatterns = [
      /查询([\u4e00-\u9fa5]{2,4})的/,
      /([\u4e00-\u9fa5]{2,4})的战绩/,
      /([\u4e00-\u9fa5]{2,4})对/,
      /棋手([\u4e00-\u9fa5]{2,4})/
    ];

    for (const pattern of playerPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        entities['player'] = match[1];
        break;
      }
    }

    // 提取平台
    const platforms = ['野狐', '弈城', '腾讯', 'OGS', 'KGS'];
    for (const platform of platforms) {
      if (text.includes(platform)) {
        entities['platform'] = platform;
        break;
      }
    }

    // 提取难度
    const difficultyPattern = /(简单|中等|困难|高级|初级|段位|级位)/;
    const difficultyMatch = text.match(difficultyPattern);
    if (difficultyMatch && difficultyMatch[1]) {
      entities['difficulty'] = difficultyMatch[1];
    }

    // 提取数字
    const numberPattern = /(\d+)/;
    const numberMatch = text.match(numberPattern);
    if (numberMatch && numberMatch[1]) {
      entities['number'] = parseInt(numberMatch[1], 10);
    }

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
