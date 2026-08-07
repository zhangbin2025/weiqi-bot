/**
 * SGF 树状解析核心
 * @module domain/sgf/SGFTreeParser
 */

import type { SGFProperties } from './types';
import { SGFNodeInternal } from './SGFNodeInternal';
import { parsePropertiesAt, parsePropertyAt, extractMoveInfo } from './SGFPropertyParser';

/**
 * 解析 SGF 树
 */
export function parseTree(
  content: string,
  errors: string[]
): SGFNodeInternal {
  const parentStack: SGFNodeInternal[] = [];
  let seqCurrent: SGFNodeInternal | null = null;
  let root: SGFNodeInternal | null = null;
  let i = 0;
  const n = content.length;
  let parenCount = 0;
  let pendingBranchProps: SGFProperties = {};

  // 如果内容不以 '(' 开头，说明缺少根括号，自动在外部包裹一层
  const needsRootParen = content.trim()[0] !== '(';
  let virtualParenClose = 0;

  if (needsRootParen) {
    // 用虚拟括号闭合下标标记，遇到文件末尾时自动补全
    virtualParenClose = n;
  }

  while (i < n) {
    const char = content[i];

    if (char === '(') {
      const rest = content.slice(i + 1).trim();
      // 如果 '(' 后直接到文件末尾或只有空白，说明是截断的残留括号，忽略
      if (rest.length === 0) {
        i++;
        continue;
      }
      i = handleOpenParen(content, i, parentStack, seqCurrent, root, errors);
      parenCount++;
      seqCurrent = null;
      // 预读并缓存 '(' 后的属性
      const branchResult = readBranchProps(content, i, errors);
      pendingBranchProps = branchResult.props;
      i = branchResult.newPos;
    } else if (char === ')') {
      if (parenCount > 0) {
        seqCurrent = parentStack.pop() || null;
        parenCount--;
      } else {
        errors.push(`位置 ${i}: 多余的右括号`);
      }
      i++;
    } else if (char === ';') {
      const newNode = new SGFNodeInternal();
      linkNode(newNode, seqCurrent, parentStack, root);
      if (root === null) root = newNode;

      // 解析属性
      const propResult = parsePropertiesAt(content, i + 1, errors);
      let props = propResult.props;
      i = propResult.newPos;

      // 合并缓存的分支属性
      if (Object.keys(pendingBranchProps).length > 0) {
        props = { ...pendingBranchProps, ...props };
        pendingBranchProps = {};
      }

      newNode.properties = props;
      extractMoveInfo(newNode);
      seqCurrent = newNode;
    } else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i++;
    } else {
      errors.push(`位置 ${i}: 意外字符 '${char}'，跳过`);
      i++;
    }
  }

  if (parenCount > 0) {
    errors.push('警告: 括号未完全闭合，已自动补全');
    // 自动补全未闭合的右括号，尽最大努力解析
    let node = seqCurrent;
    while (parenCount > 0 && node) {
      node = parentStack.pop() || null;
      parenCount--;
    }
  }

  // 如果内容没有根括号，自动补全虚拟根括号的闭合
  if (needsRootParen) {
    // 把 root 包在一个新的根节点里
    const virtualRoot = new SGFNodeInternal();
    virtualRoot.isRoot = true;
    virtualRoot.children = root ? [root] : [];
    virtualRoot.properties = {};
    root = virtualRoot;
  }

  return root || new SGFNodeInternal();
}

/**
 * 处理 '(' 开括号
 */
function handleOpenParen(
  content: string,
  pos: number,
  parentStack: SGFNodeInternal[],
  seqCurrent: SGFNodeInternal | null,
  root: SGFNodeInternal | null,
  _errors: string[]
): number {
  if (seqCurrent !== null) {
    parentStack.push(seqCurrent);
  } else if (parentStack.length > 0) {
    const parent = parentStack[parentStack.length - 1];
    if (parent) parentStack.push(parent);
  } else if (root !== null) {
    parentStack.push(root);
  }
  return pos + 1;
}

/**
 * 预读 '(' 后的属性
 */
function readBranchProps(
  content: string,
  start: number,
  errors: string[]
): { props: SGFProperties; newPos: number } {
  const props: SGFProperties = {};
  let i = start;
  const n = content.length;

  while (i < n) {
    const c = content[i];
    if (!c || c === '(' || c === ')' || c === ';') break;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c >= 'A' && c <= 'Z') {
      const propResult = parsePropertyAt(content, i, errors);
      const { name, values, newPos } = propResult;
      i = newPos;
      if (values.length > 0) {
        const val = values.length > 1 ? values : values[0];
        if (val) props[name] = val;
      }
    } else {
      errors.push(`位置 ${i}: 分支注释中意外字符 '${c}'，跳过`);
      i++;
    }
  }

  return { props, newPos: i };
}

/**
 * 将新节点链接到树中
 */
function linkNode(
  newNode: SGFNodeInternal,
  seqCurrent: SGFNodeInternal | null,
  parentStack: SGFNodeInternal[],
  root: SGFNodeInternal | null
): void {
  if (seqCurrent !== null && Object.keys(seqCurrent.properties).length === 0) {
    // seqCurrent 是空白节点，给它属性（不常见）
  } else if (seqCurrent !== null) {
    seqCurrent.children.push(newNode);
    newNode.parent = seqCurrent;
    newNode.moveNumber = seqCurrent.isRoot ? 1 : seqCurrent.moveNumber + 1;
  } else if (parentStack.length > 0) {
    const parent = parentStack[parentStack.length - 1];
    if (parent) {
      parent.children.push(newNode);
      newNode.parent = parent;
      newNode.moveNumber = parent.isRoot ? 1 : parent.moveNumber + 1;
    }
  } else if (root === null) {
    newNode.isRoot = true;
    newNode.moveNumber = 0;
  } else {
    linkToRoot(newNode, root);
  }
}

/**
 * 链接到根节点
 */
function linkToRoot(newNode: SGFNodeInternal, root: SGFNodeInternal): void {
  if (root.isRoot && root.children.length === 0 && Object.keys(root.properties).length === 0) {
    newNode.parent = root;
    newNode.moveNumber = 1;
    root.children.push(newNode);
  } else {
    // 创建包裹节点
    const wrapper = new SGFNodeInternal();
    wrapper.isRoot = true;
    wrapper.moveNumber = 0;
    root.parent = wrapper;
    root.moveNumber = 1;
    wrapper.children.push(root);
    newNode.parent = wrapper;
    newNode.moveNumber = 1;
    wrapper.children.push(newNode);
  }
}
