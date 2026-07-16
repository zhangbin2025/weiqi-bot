/**
 * 棋谱列表数据提供者接口
 * @description 不同 app 实现此接口，将收藏数据转换为棋谱归档 ID 列表
 */
/**
 * 棋谱列表数据提供者接口
 */
export interface IGameListProvider {
  /** 类别标识，如 'opponent' */
  readonly category: string;
  /**
   * 从收藏数据获取棋谱归档 ID 列表
   * @param key - 收藏项的 key
   * @returns 归档 ID 列表
   */
  getGameArchiveIds(key: string): Promise<string[]>;
}
