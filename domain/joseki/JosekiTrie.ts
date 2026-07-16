/**
 * 定式 Trie 数据结构
 * @description 完全对应 generate_joseki_tree.py 的输出结构
 */

/**
 * 胜率统计
 */
export interface IWinrateStats {
  /** 胜率变化 */
  delta: number;
  /** 标准差 */
  stddev?: number;
  /** 样本数 */
  samples?: number;
  /** 正向样本数 */
  positive?: number;
  /** 负向样本数 */
  negative?: number;
  /** 中性样本数 */
  neutral?: number;
}

/**
 * 子树引用（按需加载）
 */
export interface ISubtreeRef {
  /** 子树文件名 */
  file: string;
  /** 定式数量 */
  josekiCount?: number;
}

/**
 * 定式 Trie 节点
 * @description 对应 generate_joseki_tree.py 的 serialize_trie 输出
 */
export interface IJosekiTrieNode {
  /** 着法坐标 (SGF 格式，如 'pd', 'qc') */
  coord: string | null;
  /** 颜色 */
  color?: 'black' | 'white';
  /** 热度（后序遍历累加） */
  heat?: number;
  /** 手数（定式节点） */
  moves?: number;
  /** 频率（定式节点） */
  freq?: number;
  /** 概率（定式节点） */
  prob?: number;
  /** 胜率统计（定式节点） */
  winrate?: IWinrateStats;
  /** 子树引用（裁剪节点） */
  subtree?: ISubtreeRef;
  /** 子节点 */
  children?: Record<string, IJosekiTrieNode>;
}

/**
 * 定式 Trie 结构
 */
export interface IJosekiTrie {
  /** 根节点 */
  root: IJosekiTrieNode;
  /** 总定式数 */
  total?: number;
  /** 版本号 */
  version?: string;
  /** 更新时间 */
  updatedAt?: string;
}

/**
 * 反序列化 JSON 为 Trie
 * @description 直接解析，不需要转 Map（数据已经是 Record 结构）
 */
export function deserializeTrie(json: string): IJosekiTrie {
  const parsed = JSON.parse(json);
  return {
    root: parsed,
    total: parsed.heat,
  };
}
