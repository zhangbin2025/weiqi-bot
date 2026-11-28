/**
 * 锁住 2026-11-28 用户点名的「key 对不上」修复，防回归。
 *
 * 旧 workflow 配方 inputs.key 是裸 string，而 workflow 的 prompt 不进 system
 * （SkillSystemPrompt 2026-11-23 收窄），模型只看得到 `key: string`，于是拿
 * valueKey enum 里的 `watchlist` 当键存/读 prefs/watchlist，配方却读
 * weather.watchlist。v10 改成散文配方：prompt 进 system、没有自由 key 输入。
 *
 * 这里不跑 DAG、不替模型发请求，只锁三件可观察事实：
 *  1. 配方是散文（无 workflow / inputs），版本 10；
 *  2. buildSkillSystemPrompt 确实把 prefs/weather.watchlist 注入 system；
 *  3. prefs-add 链接解析出的 key 与 prompt 里的存储键、回灌消息逐字一致。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillSystemPrompt } from '@application/skill/SkillSystemPrompt';
import { parsePrefAddHref, prefAddUserMessage } from '../../../presentation/adapters/web/pages/assistant/PrefLink';
import type { SkillRecipe } from '@application/skill/SkillTypes';

const skillPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../weiqi-assets/skills/weather.wttr/skill.json',
);
const assetsAvailable = existsSync(skillPath);

describe.skipIf(!assetsAvailable)('weather.wttr v10 散文配方 key 契约', () => {
  const raw = JSON.parse(readFileSync(skillPath, 'utf8')) as SkillRecipe & {
    version: number;
    inputs?: unknown;
    workflow?: unknown;
  };

  it('无 workflow / 无 inputs，prompt 进 system 且明写存储键', () => {
    expect(raw.version).toBe(10);
    expect(raw.workflow).toBeUndefined();
    expect(raw.inputs).toBeUndefined();
    const sys = buildSkillSystemPrompt('BASE', [raw]);
    expect(sys).toContain('prefs');
    expect(sys).toContain('weather.watchlist');
    expect(sys).not.toContain('key: string');
  });

  it('prefs-add 链接 key 与配方存储键、回灌消息三者一致', () => {
    expect(raw.prompt).toContain('prefs-add:prefs:weather.watchlist:');
    const target = parsePrefAddHref(
      'prefs-add:prefs:weather.watchlist:%E8%8C%82%E5%90%8D',
    );
    expect(target).not.toBeNull();
    expect(target?.domain).toBe('prefs');
    expect(target?.key).toBe('weather.watchlist');
    expect(target?.value).toBe('茂名');
    expect(prefAddUserMessage(target!)).toContain("key='weather.watchlist'");
    expect(raw.prompt).toContain('weather.watchlist');
  });
});
