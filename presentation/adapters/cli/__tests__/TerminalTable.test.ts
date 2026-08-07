import { describe, it, expect } from 'vitest';
import { TerminalTable } from '../TerminalTable';
import { cleanName } from '../utils';
describe('TerminalTable', () => {
  it('displayWidth: ASCII = 1, CJK = 2, ANSI = 0', () => {
    expect(TerminalTable.displayWidth('abc')).toBe(3);
    expect(TerminalTable.displayWidth('你好')).toBe(4);
    expect(TerminalTable.displayWidth('\x1b[31mabc\x1b[0m')).toBe(3);
    expect(TerminalTable.displayWidth('张三')).toBe(4);
    expect(TerminalTable.displayWidth('')).toBe(0);
  });
  it('padDisplay: left/right/center', () => {
    expect(TerminalTable.padDisplay('ab', 5, 'left')).toBe('ab   ');
    expect(TerminalTable.padDisplay('ab', 5, 'right')).toBe('   ab');
    expect(TerminalDisplay_padCenter()).toBe(' ab  ');
  });
  it('render: basic table with alignment', () => {
    const table = new TerminalTable([
      { header: '排名', align: 'right', width: 4 },
      { header: '姓名', align: 'left' },
      { header: '积分', align: 'right', width: 4 },
    ]);
    table.addRow(['1', '张三', '12']);
    table.addRow(['2', '李四', '10']);
    const out = table.render();
    const lines = out.split('\n');
    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[1]).toMatch(/^─/); // separator line
  });
  it('render: auto width from content', () => {
    const table = new TerminalTable([
      { header: '名', align: 'left' },
      { header: '值', align: 'right' },
    ]);
    table.addRow(['hello', '1']);
    table.addRow(['hi', '100']);
    const out = table.render();
    expect(out).toContain('hello');
    expect(out).toContain('100');
  });
  it('render: color function wraps padded content', () => {
    const B = '\x1b[1m', R = '\x1b[0m';
    const table = new TerminalTable([
      { header: 'X', width: 4, color: (t) => `${B}${t}${R}` },
    ]);
    table.addRow(['a']);
    const out = table.render();
    // Color wraps padded text: "X   " → "\x1b[1mX   \x1b[0m"
    expect(out).toContain(`${B}X   ${R}`);
    expect(out).toContain(`${B}a   ${R}`);
  });
});
function TerminalDisplay_padCenter(): string {
  return TerminalTable.padDisplay('ab', 5, 'center');
}
describe('cleanName', () => {
  it('extracts Chinese name from pipe-suffixed string', () => {
    expect(cleanName('张三|12345')).toBe('张三');
    expect(cleanName('李四_abc')).toBe('李四');
  });
  it('returns clean name as-is', () => {
    expect(cleanName('张三')).toBe('张三');
  });
  it('handles empty', () => {
    expect(cleanName('')).toBe('');
  });
  it('strips bracket suffixes', () => {
    expect(cleanName('王五[abc]')).toBe('王五');
    expect(cleanName('赵六(xyz)')).toBe('赵六');
  });
});
