/**
 * 实体提取器接口
 * @module domain/intent/IEntityExtractor
 */

/**
 * 实体提取器接口
 * 从用户输入文本中提取命名实体（棋手名、平台、定式等）
 */
export interface IEntityExtractor {
  /**
   * 从文本中提取实体
   * @param text 用户输入文本
   * @param intent 识别出的意图（可选）
   * @returns 提取的实体字典
   * 
   * @ai-example
   * ```typescript
   * const extractor = new EntityExtractor();
   * const entities = extractor.extract('下载柯洁在野狐的棋谱', 'download_game');
   * // entities = { player: '柯洁', source: '野狐' }
   * ```
   */
  extract(text: string, intent?: string): Record<string, any>;

  /**
   * 将实体转换为参数
   * @param entities 提取的实体
   * @returns 参数字典
   * 
   * @ai-example
   * ```typescript
   * const params = extractor.toParams({ player: '柯洁', source: '野狐' });
   * // params = { player: '柯洁', source: '野狐' }
   * ```
   */
  toParams(entities: Record<string, any>): Record<string, any>;
}
