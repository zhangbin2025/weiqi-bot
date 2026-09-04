/**
 * 定式树导出器
 * 对应 Python: weiqi-joseki/src/matching/trie.py (_tree_to_sgf 等)
 *
 * 实现定式树到 SGF 格式的转换（支持多分支）
 */

import type { JosekiEndpoint } from "./JosekiMatcher";

interface TreeNode {
  next: Record<string, TreeNode>;
  freq: number;
  prob: number;
  moves?: number;
  isMain: boolean;
}

/**
 * 从定式终点列表构建树
 */
function buildTreeFromPaths(
  paths: JosekiEndpoint[],
  mainBranch: string[] | null
): TreeNode["next"] {
  const root: TreeNode["next"] = {};
  const mainSet = new Set<string>();
  if (mainBranch) {
    for (let i = 1; i <= mainBranch.length; i++) {
      mainSet.add(mainBranch.slice(0, i).join(","));
    }
  }
  for (const { path, freq, prob, moves } of paths) {
    let node = root;
    for (let i = 0; i < path.length; i++) {
      const move = path[i]!;
      if (!move) continue;
      if (!node[move]) node[move] = { next: {}, freq: 0, prob: 0, isMain: false };
      const pathSoFar = path.slice(0, i + 1).join(",");
      if (mainSet.has(pathSoFar)) node[move]!.isMain = true;
      if (i === path.length - 1) {
        node[move]!.freq = freq;
        node[move]!.prob = prob;
        if (moves !== undefined) node[move]!.moves = moves;
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
  tree: TreeNode["next"],
  depth: number,
  mainBranch: string[] | null,
  mainDepth: number
): string {
  if (!tree && !(mainBranch && mainDepth < mainBranch.length)) return "";

  let currentMove: string | null = null;
  let currentNode: TreeNode | null = null;

  if (mainBranch && mainDepth < mainBranch.length) {
    currentMove = mainBranch[mainDepth] ?? null;
    if (tree && currentMove && tree[currentMove])
      currentNode = tree[currentMove] ?? null;
  }
  if (!currentNode && tree) {
    const items = Object.entries(tree).sort((a, b) => b[1].freq - a[1].freq);
    if (items.length > 0) {
      currentMove = items[0]![0];
      currentNode = items[0]![1];
    }
  }
  if (!currentNode || !currentMove) {
    if (mainBranch && mainDepth < mainBranch.length) {
      const parts: string[] = [];
      for (let i = mainDepth; i < mainBranch.length; i++) {
        const c = i % 2 === 0 ? "B" : "W";
        parts.push(`;${c}[${mainBranch[i] ?? ""}]`);
      }
      return parts.join("");
    }
    return "";
  }

  const color = depth % 2 === 0 ? "B" : "W";
  const freq = currentNode.freq || 0;
  const nodeSgf = freq > 0
    ? `;${color}[${currentMove}]C[出现次数:${freq}]`
    : `;${color}[${currentMove}]`;

  const nextTree = currentNode.next || {};
  let mainNext: string | null = null;
  const hasMain = mainBranch && mainDepth + 1 < mainBranch.length;
  if (hasMain && mainBranch) mainNext = mainBranch[mainDepth + 1] ?? null;

  const allChildren: Array<[string, TreeNode, boolean]> = [];
  for (const [move, node] of Object.entries(nextTree)) {
    allChildren.push([move, node, move === mainNext]);
  }
  // 排序：主分支优先，然后按频率
  allChildren.sort((a, b) => {
    if (a[2] !== b[2]) return a[2] ? -1 : 1;
    return b[1].freq - a[1].freq;
  });

  const childParts: string[] = [];
  const singleMain =
    allChildren.length === 1 && allChildren[0] ? allChildren[0][2] : false;

  for (const [childMove, childNode, isMain] of allChildren) {
    const bc = (depth + 1) % 2 === 0 ? "B" : "W";
    const cf = childNode.freq || 0;
    const cont = isMain && hasMain && mainBranch
      ? treeToSgf(childNode.next || {}, depth + 2, mainBranch, mainDepth + 2)
      : treeToSgf(childNode.next || {}, depth + 2, null, 0);
    if (singleMain) {
      childParts.push(
        cf > 0
          ? `;${bc}[${childMove}]C[出现次数:${cf}]${cont}`
          : `;${bc}[${childMove}]${cont}`
      );
    } else {
      childParts.push(
        (cf > 0
          ? `(;${bc}[${childMove}]C[出现次数:${cf}]`
          : `(;${bc}[${childMove}]`) + cont + ")"
      );
    }
  }

  if (allChildren.length === 0 && hasMain && mainBranch) {
    for (let i = mainDepth + 1; i < mainBranch.length; i++) {
      const c = i % 2 === 0 ? "B" : "W";
      childParts.push(`;${c}[${mainBranch[i] ?? ""}]`);
    }
  }

  return nodeSgf + childParts.join("");
}

/**
 * 导出定式树为 SGF 格式（多分支）
 */
export function exportTreeFromEndpoints(
  endpoints: JosekiEndpoint[],
  mainBranch: string[],
  prefixStr: string = "all"
): string {
  const sorted = [...endpoints].sort((a, b) => b.freq - a.freq);
  const tree = buildTreeFromPaths(sorted, mainBranch);
  const body = treeToSgf(tree, 0, mainBranch, 0);
  return `(;FF[4]AP[WeiqiJoseki:1.0]C[定式树: ${prefixStr}]CA[UTF-8]GM[1]SZ[19]${body})`;
}

/**
 * 导出定式树为 SGF 格式（简单线性，兼容旧接口）
 */
export function exportTree(
  matchedPath: string[],
  normalized: string[],
  depth: number = 10
): string {
  const moves = normalized.length > 0 ? normalized : matchedPath;
  const limited = moves.slice(0, Math.min(depth, moves.length));
  const nodes = limited
    .filter((c) => c && c !== "tt" && c !== "pass")
    .map((c, i) => `;${i % 2 === 0 ? "B" : "W"}[${c}]`)
    .join("");
  return `(;GM[1]FF[4]SZ[19]CA[UTF-8]AP[WeiqiJoseki:1.0]${nodes})`;
}

/**
 * 导出定式树（带候选分支，兼容旧接口）
 */
export function exportTreeWithCandidates(
  mainPath: string[],
  candidates: string[][],
  depth: number = 10
): string {
  const limitedMain = mainPath.slice(0, Math.min(depth, mainPath.length));
  const mainNodes = limitedMain
    .filter((c) => c && c !== "tt" && c !== "pass")
    .map((c, i) => `;${i % 2 === 0 ? "B" : "W"}[${c}]`)
    .join("");
  const candidateParts = candidates.slice(0, 5).map((candidate) => {
    const limited = candidate.slice(0, Math.min(depth, candidate.length));
    let divPoint = 0;
    for (let i = 0; i < Math.min(limitedMain.length, limited.length); i++) {
      if (limitedMain[i] !== limited[i]) { divPoint = i; break; }
    }
    const branchNodes = limited
      .slice(divPoint)
      .filter((c) => c && c !== "tt" && c !== "pass")
      .map((c, i) => `;${(divPoint + i) % 2 === 0 ? "B" : "W"}[${c}]`)
      .join("");
    return branchNodes ? `(${branchNodes})` : "";
  }).filter(Boolean).join("");
  return `(;GM[1]FF[4]SZ[19]CA[UTF-8]AP[WeiqiJoseki:1.0]${mainNodes}${candidateParts})`;
}
