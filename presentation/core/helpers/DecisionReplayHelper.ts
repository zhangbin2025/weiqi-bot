/**
 * 决策题 Replay 数据辅助模块
 *
 * 专为决策题（实战选点）页面服务，将题目位置的 SGF 转换为 replay 格式数据。
 * 注意：此模块与 clients/web/replay 页面无关——replay 页面直接调用 domain/sgf 的 sgfToReplayData()。
 *
 * @module presentation/core/helpers/DecisionReplayHelper
 */
import { sgfToReplayData, type ReplayData } from '../../../domain/sgf';
import { LocalStorageAdapter } from '../../../infrastructure/storage/adapters/web/LocalStorageAdapter';

/**
 * 决策题外部传入的游戏信息（用于覆盖 SGF 中的值）
 */
export interface DecisionGameInfo {
  game_name?: string;
  black?: string;
  white?: string;
  black_rank?: string;
  white_rank?: string;
  board_size?: number;
  handicap?: number;
  handicap_stones?: Array<{ x: number; y: number; color: 'B' | 'W' }>;
  result?: string;
  download_filename?: string;
}

/**
 * 决策题 Replay 数据生成器
 *
 * 封装 domain/sgf 的 sgfToReplayData() 调用 + gameInfo 覆盖逻辑 + localStorage 存储。
 * SGF 解析全部委托给 domain/sgf 接口，不再手写解析器。
 */
export class DecisionReplayHelper {
  /**
   * 从 SGF 内容生成 replay 数据
   *
   * @param sgfContent - SGF 内容
   * @param gameInfo - 游戏信息（可选，传入的字段将覆盖 SGF 中的值）
   * @param defaultMove - 默认跳转手数（-1 表示最后一手）
   * @returns Replay 数据
   * @throws {Error} SGF 解析失败时抛出
   */
  static generateReplayData(
    sgfContent: string,
    gameInfo: DecisionGameInfo = {},
    defaultMove: number = -1,
  ): ReplayData {
    const options: { defaultMove: number; gameName?: string; downloadFilename?: string } = {
      defaultMove,
    };
    if (gameInfo.game_name) options.gameName = gameInfo.game_name;
    if (gameInfo.download_filename) options.downloadFilename = gameInfo.download_filename;
    const result = sgfToReplayData(sgfContent, options);

    if (!result) {
      throw new Error('SGF 解析失败');
    }

    // 外部 gameInfo 覆盖 SGF 中的值（与原 ReplayHelper 行为一致）
    if (gameInfo.black) result.black = gameInfo.black;
    if (gameInfo.white) result.white = gameInfo.white;
    if (gameInfo.black_rank) result.black_rank = gameInfo.black_rank;
    if (gameInfo.white_rank) result.white_rank = gameInfo.white_rank;
    if (gameInfo.board_size) result.board_size = gameInfo.board_size;
    if (gameInfo.handicap !== undefined) result.handicap = gameInfo.handicap;
    if (gameInfo.handicap_stones) result.handicap_stones = gameInfo.handicap_stones;
    if (gameInfo.result) result.result = gameInfo.result;

    return result;
  }

  /**
   * 保存 replay 数据到 localStorage
   *
   * @param data - Replay 数据
   * @returns localStorage key
   */
  static async saveToLocalStorage(data: ReplayData): Promise<string> {
    const adapter = new LocalStorageAdapter('weiqi-bot');
    await adapter.initialize();
    const key = `${DecisionReplayHelper.STORAGE_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await adapter.write(key, data);
    // 清理过期数据（超过 1 小时）
    await DecisionReplayHelper.cleanExpiredData();
    return key;
  }

  /**
   * 清理过期的 localStorage 数据
   */
  static async cleanExpiredData(): Promise<void> {
    const adapter = new LocalStorageAdapter('weiqi-bot');
    await adapter.initialize();
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 小时
    const keys = await adapter.listKeys(`${DecisionReplayHelper.STORAGE_PREFIX}*`);
    for (const key of keys) {
      const parts = key.split('_');
      if (parts.length >= 2) {
        const timestamp = parseInt(parts[1]!);
        if (!isNaN(timestamp) && now - timestamp > maxAge) {
          await adapter.delete(key);
        }
      }
    }
  }

  private static readonly STORAGE_PREFIX = 'replay_';
}
