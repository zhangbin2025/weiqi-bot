// IntentProcessor.ts - 意图处理器
import type { ILLMClient } from '../../infrastructure/utils/llm/types';
import type { UserIntent, EntityDictionaries } from './types';
import type { ILogger } from '../../infrastructure/logger/types';
/** 默认实体词典 */
export const DEFAULT_ENTITY_DICTS: EntityDictionaries = {
  players: [
    '柯洁', '申真谞', '朴廷桓', '丁浩', '辜梓豪',
    '芈昱廷', '杨鼎新', '李轩豪', '范廷钰', '谢尔豪',
    '连笑', '陈耀烨', '时越', '唐韦星', '柁嘉熹',
    '江维杰', '周睿羊', '王檄', '古力', '孔杰',
  ],
  sources: ['野狐', 'OGS', '101围棋', '弈客', '腾讯围棋', '新浪围棋', '棋魂'],
  difficulties: ['简单', '中等', '困难', '入门', '进阶', '高级'],
  openings: ['星位', '小目', '三三', '中国流', '宇宙流', '三连星'],
};
/**
 * 意图处理器
 * 负责意图识别和实体提取
 */
export class IntentProcessor {
  private entityDicts: EntityDictionaries;
  constructor(
    private llmClient: ILLMClient,
    private logger: ILogger,
    config?: { entityDictionaries?: Partial<EntityDictionaries> }
  ) {
    this.entityDicts = { ...DEFAULT_ENTITY_DICTS, ...config?.entityDictionaries };
  }
  /**
   * 处理用户输入，识别意图和提取实体
   */
  async process(text: string): Promise<UserIntent> {
    try {
      const { intent, confidence } = await this.llmClient.classifyIntent(text);
      const entities = this.extractEntities(text);
      this.logger.debug(`Intent: ${intent}, confidence: ${confidence}`);
      return { intent, confidence, entities, rawText: text };
    } catch (error) {
      this.logger.error('Intent processing failed', error as Error);
      return { intent: 'unknown', confidence: 0, entities: {}, rawText: text };
    }
  }
  /**
   * 更新实体词典
   */
  updateDictionaries(dict: Partial<EntityDictionaries>): void {
    Object.assign(this.entityDicts, dict);
    console.info('Entity dictionaries updated');
  }
  /**
   * 添加棋手名
   */
  addPlayer(name: string): void {
    if (!this.entityDicts.players.includes(name)) {
      this.entityDicts.players.push(name);
      this.logger.info(`Player added: ${name}`);
    }
  }
  /**
   * 获取当前实体词典
   */
  getDictionaries(): EntityDictionaries {
    return { ...this.entityDicts };
  }
  /**
   * 实体提取
   */
  private extractEntities(text: string): Record<string, any> {
    const entities: Record<string, any> = {};
    for (const player of this.entityDicts.players) {
      if (text.includes(player)) {
        entities['player'] = player;
        break;
      }
    }
    for (const source of this.entityDicts.sources) {
      if (text.includes(source)) {
        entities['source'] = source;
        break;
      }
    }
    for (const difficulty of this.entityDicts.difficulties) {
      if (text.includes(difficulty)) {
        entities['difficulty'] = difficulty;
        break;
      }
    }
    for (const opening of this.entityDicts.openings) {
      if (text.includes(opening)) {
        entities['opening'] = opening;
        break;
      }
    }
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) entities['url'] = urlMatch[0];
    const countMatch = text.match(/(\d+)(盘|局|道|题)/);
    if (countMatch) entities['count'] = parseInt(countMatch[1]!);
    const rangeMatch = text.match(/(\d+)\s*[-~至]\s*(\d+)/);
    if (rangeMatch) entities['range'] = [parseInt(rangeMatch[1]!), parseInt(rangeMatch[2]!)];
    return entities;
  }
}