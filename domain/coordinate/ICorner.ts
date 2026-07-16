/**
 * 角标识类型
 * - 'tl' - 左上角 (Top-Left)
 * - 'tr' - 右上角 (Top-Right)
 * - 'bl' - 左下角 (Bottom-Left)
 * - 'br' - 右下角 (Bottom-Right)
 */
export type CornerKey = 'tl' | 'tr' | 'bl' | 'br';

/**
 * 角范围配置接口
 * @ai-example
 * const config: ICornerRange = { colMin: 0, colMax: 12, rowMin: 0, rowMax: 12 };
 */
export interface ICornerRange {
  /** 列最小值 */
  readonly colMin: number;
  /** 列最大值 */
  readonly colMax: number;
  /** 行最小值 */
  readonly rowMin: number;
  /** 行最大值 */
  readonly rowMax: number;
}

/**
 * 角配置接口
 * @ai-example
 * const config: ICornerConfig = { key: 'tl', range: { colMin: 0, colMax: 12, rowMin: 0, rowMax: 12 } };
 */
export interface ICornerConfig {
  /** 角标识 */
  readonly key: CornerKey;
  /** 角范围 */
  readonly range: ICornerRange;
}

/**
 * 获取指定路数的角范围配置
 * @param luSize - 路数 (9/11/13)
 * @returns 四角范围配置
 * @ai-example
 * getCornerRanges(13).tl; // { colMin: 0, colMax: 12, rowMin: 0, rowMax: 12 }
 */
export function getCornerRanges(luSize: 9 | 11 | 13): Record<CornerKey, ICornerRange> {
  const configs: Record<9 | 11 | 13, Record<CornerKey, ICornerRange>> = {
    9: {
      tl: { colMin: 0, colMax: 8, rowMin: 0, rowMax: 8 },
      tr: { colMin: 10, colMax: 18, rowMin: 0, rowMax: 8 },
      bl: { colMin: 0, colMax: 8, rowMin: 10, rowMax: 18 },
      br: { colMin: 10, colMax: 18, rowMin: 10, rowMax: 18 },
    },
    11: {
      tl: { colMin: 0, colMax: 10, rowMin: 0, rowMax: 10 },
      tr: { colMin: 8, colMax: 18, rowMin: 0, rowMax: 10 },
      bl: { colMin: 0, colMax: 10, rowMin: 8, rowMax: 18 },
      br: { colMin: 8, colMax: 18, rowMin: 8, rowMax: 18 },
    },
    13: {
      tl: { colMin: 0, colMax: 12, rowMin: 0, rowMax: 12 },
      tr: { colMin: 6, colMax: 18, rowMin: 0, rowMax: 12 },
      bl: { colMin: 0, colMax: 12, rowMin: 6, rowMax: 18 },
      br: { colMin: 6, colMax: 18, rowMin: 6, rowMax: 18 },
    },
  };
  return configs[luSize];
}

/**
 * 获取所有角配置
 * @param luSize - 路数 (默认 13)
 * @returns 角配置列表
 */
export function getCornerConfigs(luSize: 9 | 11 | 13 = 13): ICornerConfig[] {
  const ranges = getCornerRanges(luSize);
  const keys: CornerKey[] = ['tl', 'tr', 'bl', 'br'];
  return keys.map((key) => ({ key, range: ranges[key] }));
}