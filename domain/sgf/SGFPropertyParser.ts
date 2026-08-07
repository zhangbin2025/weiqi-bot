/**
 * SGF 属性解析
 * @module domain/sgf/SGFPropertyParser
 */

import type { SGFProperties, SGFPropValue } from './types';

/**
 * 解析节点属性
 */
export function parsePropertiesAt(
  content: string,
  start: number,
  errors: string[]
): { props: SGFProperties; newPos: number } {
  const props: SGFProperties = {};
  let i = start;
  const n = content.length;

  while (i < n) {
    const char = content[i];

    if (!char || char === '(' || char === ')' || char === ';') break;

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i++;
      continue;
    }

    if (char >= 'A' && char <= 'Z') {
      const propResult = parsePropertyAt(content, i, errors);
      const { name, values, newPos } = propResult;
      i = newPos;
      if (values.length > 0) {
        const val = values.length > 1 ? values : values[0];
        if (val) props[name] = val;
      } else {
        props[name] = '';
      }
    } else {
      errors.push(`位置 ${i}: 属性名应为大写字母，跳过 '${char}'`);
      i++;
    }
  }

  return { props, newPos: i };
}

/**
 * 解析单个属性
 */
export function parsePropertyAt(
  content: string,
  start: number,
  errors: string[]
): { name: string; values: string[]; newPos: number } {
  let i = start;
  const n = content.length;

  // 解析属性名
  let name = '';
  while (i < n) {
    const c = content[i];
    if (c && c >= 'A' && c <= 'Z') {
      name += c;
      i++;
    } else {
      break;
    }
  }

  // 解析属性值
  const values: string[] = [];
  while (i < n) {
    const c = content[i];
    if (c && c === '[') {
      const valueResult = parsePropertyValue(content, i + 1);
      values.push(valueResult.value);
      i = valueResult.newPos;
      if (!valueResult.closed) {
        errors.push(`属性 ${name} 的值未闭合`);
      }
    } else {
      break;
    }
  }

  return { name, values, newPos: i };
}

/**
 * 解析属性值（处理转义）
 */
export function parsePropertyValue(
  content: string,
  start: number
): { value: string; newPos: number; closed: boolean } {
  const valueParts: string[] = [];
  let i = start;
  const n = content.length;

  while (i < n) {
    const char = content[i];

    if (char === '\\' && i + 1 < n) {
      const nextChar = content[i + 1];
      // SGF 转义规则
      if (nextChar === ']') {
        valueParts.push(']');
        i += 2;
      } else if (nextChar === '\\') {
        valueParts.push('\\');
        i += 2;
      } else if (nextChar === 'n') {
        valueParts.push('\n');
        i += 2;
      } else if (nextChar === 'r') {
        valueParts.push('\r');
        i += 2;
      } else if (nextChar === 't') {
        valueParts.push('\t');
        i += 2;
      } else {
        valueParts.push(nextChar || '');
        i += 2;
      }
    } else if (char === ']') {
      i++;
      return { value: valueParts.join(''), newPos: i, closed: true };
    } else {
      valueParts.push(char || '');
      i++;
    }
  }

  return { value: valueParts.join(''), newPos: i, closed: false };
}

/**
 * 提取着法信息
 */
export function extractMoveInfo(
  node: { properties: SGFProperties; color?: 'B' | 'W' | null; coord?: string | null }
): void {
  if ('B' in node.properties) {
    node.color = 'B';
    node.coord = normalizeCoord(node.properties['B']);
  } else if ('W' in node.properties) {
    node.color = 'W';
    node.coord = normalizeCoord(node.properties['W']);
  }
}

/**
 * 规范化坐标值
 */
export function normalizeCoord(val: SGFPropValue): string | null {
  if (Array.isArray(val) && val.length > 0) {
    const first = val[0];
    return first || null;
  }
  return val ? String(val) : null;
}