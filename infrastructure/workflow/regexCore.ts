/** Pure regex implementation. Used by the dedicated regex Worker; production never executes it on the main thread. */
export function executeRegex(method: string, a: Record<string, unknown>): unknown {
  if (typeof a['text'] !== 'string' || typeof a['pattern'] !== 'string') {
    throw new Error('text/pattern 必须是字符串');
  }
  const text = a['text'];
  const pattern = a['pattern'];
  const flags = a['flags'] === undefined
    ? (method === 'extract' || method === 'replace' ? 'g' : '')
    : a['flags'];
  if (typeof flags !== 'string' || /[^dgimsuvy]/.test(flags) || flags.includes('y')) {
    throw new Error('flags 无效或不支持 sticky 标志 y');
  }
  if (method === 'match') {
    if (flags.includes('g')) throw new Error('match 的 flags 不允许 g');
    const hit = new RegExp(pattern, flags).exec(text);
    return hit
      ? { matched: true, value: hit[0], index: hit.index, groups: hit.slice(1) }
      : { matched: false, value: null, index: -1, groups: [] };
  }
  if (method === 'extract') {
    const globalFlags = flags.includes('g') ? flags : flags + 'g';
    const group = a['group'] === undefined ? 0 : a['group'];
    const limit = a['limit'] === undefined ? 0 : a['limit'];
    if (!Number.isInteger(group) || (group as number) < 0 ||
        !Number.isInteger(limit) || (limit as number) < 0) {
      throw new Error('group/limit 必须是非负整数');
    }
    const re = new RegExp(pattern, globalFlags);
    const out: unknown[] = [];
    const seen = new Set<string>();
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(text)) !== null) {
      const value = hit[group as number] ?? '';
      if (a['unique'] !== true || !seen.has(String(value))) {
        seen.add(String(value));
        out.push(a['withIndex'] === true ? { value, index: hit.index } : value);
      }
      if ((limit as number) > 0 && out.length >= (limit as number)) break;
      if (hit[0] === '') {
        if (re.lastIndex >= text.length) break;
        const cp = text.codePointAt(re.lastIndex) ?? 0;
        re.lastIndex += cp > 0xffff ? 2 : 1;
      }
    }
    return out;
  }
  if (method === 'replace') {
    if (typeof a['replacement'] !== 'string') throw new Error('replacement 必须是字符串');
    return text.replace(new RegExp(pattern, flags), a['replacement']);
  }
  throw new Error(`不支持的 regex action：${method}`);
}
