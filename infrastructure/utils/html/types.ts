/**
 * @fileoverview HTML 解析器类型定义
 */

/**
 * 解析器配置
 */
export interface ParserConfig {
  /** 是否严格模式 */
  strict?: boolean;
  /** 自定义属性映射 */
  attrMap?: Record<string, string>;
}

/**
 * 匹配结果
 */
export type MatchResult = string[];

/**
 * 属性键值对
 */
export type AttrMap = Record<string, string>;
