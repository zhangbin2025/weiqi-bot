/**
 * 定式树导出器
 * 实现定式树到 SGF 格式的转换（支持多分支）
 */

import type { JosekiEndpoint } from './JosekiMatcher';

interface TreeNode {
  next: Record<string, TreeNode>;
  freq: number;
  prob: number;
  moves?: number;
  isMain: boolean;
}

/**
 * 从定式终点列表构建树
 * @param paths - 定式终点列表 [{path, freq, prob, ids}, ...]
 * @param mainBranch - 主分支路径
 * @returns 树结构
 */
function buildTreeFromPaths(paths: JosekiEndpoint[], mainBranch: string[] | null): TreeNode['next'] {
  const root: TreeNode['next'] = {};
  const mainSet = new Set<string>();

  if (mainBranch) {
    for (let i = 1; i <= mainBranch.length; i++) {
      mainSet.add(mainBranch.slice(0, i).join(','));
    }
  }

  for (const { path, freq, prob, moves } of paths) {
    let node = root;
    for (let i = 0; i < path.length; i++) {
      const move = path[i];
      if (!move) continue;

      if (!node[move]) {
        node[move] = { next: {}, freq: 0, prob: 0, isMain: false };
      }

      // 标记是否为主分支
      const pathSoFar = path.slice(0, i + 1).join(',');
      if (mainSet.has(pathSoFar)) {
        node[move]!.isMain = true;
      }

      // 只在终点设置 freq、prob、moves
      if (i === path.length - 1) {
        node[move]!.freq = freq;
        node[move]!.prob = prob;
        if (moves !== undefined) {
          node[move]!.moves = moves;
        }
      }

      node = node[move]!.next;
    }
  }

  return root;
}

/**
 * 生成 SGF 字符串（递归）
 */
function treeToSgf(
  tree: TreeNode['next'],
  depth: number,
  mainBranch: string[] | null,
  mainDepth: number
): string {
  if (!tree && !(mainBranch && mainDepth < mainBranch.length)) {
    return '';
  }

  // 确定当前节点
  let currentMove: string | null = null;
  let currentNode: TreeNode | null = null;

  if (mainBranch && mainDepth < mainBranch.length) {
    currentMove = mainBranch[mainDepth] ?? null;
    if (tree && currentMove && tree[currentMove]) {
      currentNode = tree[currentMove] ?? null;
    }
  }

  if (!currentNode && tree) {
    const items = Object.entries(tree).sort((a, b) => b[1].freq - a[1].freq);
    if (items.length > 0) {
      const first = items[0]!;
      currentMove = first[0];
      currentNode = first[1];
    }
  }

  if (!currentNode || !currentMove) {
    // 输出剩余主分支
    if (mainBranch && mainDepth < mainBranch.length) {
      const parts: string[] = [];
      for (let i = mainDepth; i < mainBranch.length; i++) {
        const color = i % 2 === 0 ? 'B' : 'W';
        const m = mainBranch[i];
        if (m) parts.push(`;${color}[${m}]`);
      }
      return parts.join('');
    }
    return '';
  }

  // 输出当前节点
  const color = depth % 2 === 0 ? 'B' : 'W';
  const freq = currentNode.freq || 0;

  let nodeSgf: string;
  if (freq > 0) {
    nodeSgf = `;${color}[${currentMove}]C[出现次数:${freq}]`;
  } else {
    nodeSgf = `;${color}[${currentMove}]`;
  }

  // 获取子树
  const nextTree = currentNode.next || {};

  // 确定主分支下一手
  let mainNext: string | null = null;
  const hasMainRemaining = mainBranch && mainDepth + 1 < mainBranch.length;
  if (hasMainRemaining && mainBranch) {
    mainNext = mainBranch[mainDepth + 1] ?? null;
  }

  // 收集子节点
  const allChildren: Array<[string, TreeNode, boolean]> = [];
  for (const [move, node] of Object.entries(nextTree)) {
    const isMain = move === mainNext;
    allChildren.push([move, node, isMain]);
  }

  // 排序：主分支优先，然后按频率
  allChildren.sort((a, b) => {
    if (a[2] !== b[2]) return b[2] ? 1 : -1 ? -1 : 0;
    return b[1].freq - a[1].freq;
  });

  // 生成子节点 SGF
  const childParts: string[] = [];
  const singleMainChild = allChildren.length === 1 && allChildren[0] ? allChildren[0][2] : false;

  for (const [childMove, childNode, isMain] of allChildren) {
    const branchColor = (depth + 1) % 2 === 0 ? 'B' : 'W';
    const childFreq = childNode.freq || 0;

    // 递归生成分支的后续
    let branchCont: string;
    if (isMain && hasMainRemaining && mainBranch) {
      branchCont = treeToSgf(childNode.next || {}, depth + 2, mainBranch, mainDepth + 2);
    } else {
      branchCont = treeToSgf(childNode.next || {}, depth + 2, null, 0);
    }

    if (singleMainChild) {
      // 只有一个主分支子节点，直接延续不包裹括号
      if (childFreq > 0) {
        childParts.push(`;${branchColor}[${childMove}]C[出现次数:${childFreq}]${branchCont}`);
      } else {
        childParts.push(`;${branchColor}[${childMove}]${branchCont}`);
      }
    } else {
      // 多个子节点，用括号包裹
      let branchStart: string;
      if (childFreq > 0) {
        branchStart = `(;${branchColor}[${childMove}]C[出现次数:${childFreq}]`;
      } else {
        branchStart = `(;${branchColor}[${childMove}]`;
      }
      childParts.push(`${branchStart}${branchCont})`);
    }
  }

  // 如果子树为空但主分支还有剩余
  if (allChildren.length === 0 && hasMainRemaining && mainBranch) {
    for (let i = mainDepth + 1; i < mainBranch.length; i++) {
      const c = i % 2 === 0 ? 'B' : 'W';
      const m = mainBranch[i] ?? '';
      if (m) childParts.push(`;${c}[${m}]`);
    }
  }

  return nodeSgf + childParts.join('');
}

/**
 * 导出定式树为 SGF 格式（多分支）
 * @param endpoints - 定式终点列表
 * @param mainBranch - 主分支路径
 * @param prefixStr - 前缀字符串（用于注释）
 * @returns SGF 格式的定式树
 */
export function exportTreeFromEndpoints(
  endpoints: JosekiEndpoint[],
  mainBranch: string[],
  prefixStr: string = 'all'
): string {
  // 排序：频率高的优先
  const sorted = [...endpoints].sort((a, b) => b.freq - a.freq);

  // 构建树
  const tree = buildTreeFromPaths(sorted, mainBranch);

  // 生成 SGF
  const body = treeToSgf(tree, 0, mainBranch, 0);
  return `(;FF[4]AP[WeiqiJoseki:1.0]C[定式树: ${prefixStr}]CA[UTF-8]GM[1]SZ[19]${body})`;
}

/**
 * 导出定式树为 SGF 格式（简单线性）
 * @deprecated 使用 exportTreeFromEndpoints 代替
 */
export function exportTree(
  matchedPath: string[],
  normalized: string[],
  depth: number = 10
): string {
  const moves = normalized.length > 0 ? normalized : matchedPath;
  const limitedMoves = moves.slice(0, Math.min(depth, moves.length));

  const nodes: string[] = [];
  for (let i = 0; i < limitedMoves.length; i++) {
    const coord = limitedMoves[i];
    if (!coord || coord === 'tt' || coord === 'pass') continue;
    const color = i % 2 === 0 ? 'B' : 'W';
    nodes.push(`;${color}[${coord}]`);
  }

  return `(;GM[1]FF[4]SZ[19]CA[UTF-8]AP[WeiqiJoseki:1.0]${nodes.join('')})`;
}

/**
 * 导出定式树（带候选分支）
 * @deprecated 使用 exportTreeFromEndpoints 代替
 */
export function exportTreeWithCandidates(
  mainPath: string[],
  candidates: string[][],
  depth: number = 10
): string {
  const limitedMain = mainPath.slice(0, Math.min(depth, mainPath.length));

  const mainNodes: string[] = [];
  for (let i = 0; i < limitedMain.length; i++) {
    const coord = limitedMain[i];
    if (!coord || coord === 'tt' || coord === 'pass') continue;
    const color = i % 2 === 0 ? 'B' : 'W';
    mainNodes.push(`;${color}[${coord}]`);
  }

  const candidateParts: string[] = [];
  for (const candidate of candidates.slice(0, 5)) {
    const limitedCandidate = candidate.slice(0, Math.min(depth, candidate.length));

    let divergencePoint = 0;
    for (let i = 0; i < Math.min(limitedMain.length, limitedCandidate.length); i++) {
      if (limitedMain[i] !== limitedCandidate[i]) {
        divergencePoint = i;
        break;
      }
    }

    const branchNodes: string[] = [];
    for (let i = divergencePoint; i < limitedCandidate.length; i++) {
      const coord = limitedCandidate[i];
      if (!coord || coord === 'tt' || coord === 'pass') continue;
      const color = i % 2 === 0 ? 'B' : 'W';
      branchNodes.push(`;${color}[${coord}]`);
    }

    if (branchNodes.length > 0) {
      candidateParts.push(`(${branchNodes.join('')})`);
    }
  }

  return `(;GM[1]FF[4]SZ[19]CA[UTF-8]AP[WeiqiJoseki:1.0]${mainNodes.join('')}${candidateParts.join('')})`;
}
