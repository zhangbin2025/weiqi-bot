/**
 * 配方 secrets 声明的解析 / 汇总契约：模型拿不到的边界全靠这一层。
 */
import { describe, it, expect } from 'vitest';
import {
  parseSecretSpec, parseSecretSpecs, collectSecretSpecs, type SecretSpec,
} from '../SecretSpec';
import { parseSkillRecipe } from '../SkillRecipe';

const GH: SecretSpec = {
  key: 'github_token',
  label: 'GitHub Personal Access Token',
  setupUrl: 'https://github.com/settings/tokens',
  allowedHosts: ['api.github.com'],
  header: { name: 'Authorization', prefix: 'Bearer ' },
};

describe('parseSecretSpec', () => {
  it('合法声明原样通过，缺省 setupUrl / hint / reauthStatuses 不塞 undefined', () => {
    const s = parseSecretSpec({
      key: 'github_token', label: 'GitHub Token',
      allowedHosts: ['api.github.com'], header: { name: 'Authorization', prefix: 'Bearer ' },
    }, 0);
    expect(s).toEqual({
      key: 'github_token', label: 'GitHub Token',
      allowedHosts: ['api.github.com'], header: { name: 'Authorization', prefix: 'Bearer ' },
    });
  });

  it('host 归一化小写并去重；带协议 / 端口 / 通配 / 路径一律拒绝', () => {
    const s = parseSecretSpec({
      key: 'k', label: 'L', allowedHosts: ['API.GitHub.com', 'api.github.com'],
      header: { name: 'X-Api-Key', prefix: '' },
    }, 0);
    expect(s.allowedHosts).toEqual(['api.github.com']);
    for (const bad of ['https://api.github.com', 'api.github.com:443', '*.github.com', 'api.github.com/user', 'localhost']) {
      expect(() => parseSecretSpec({
        key: 'k', label: 'L', allowedHosts: [bad], header: { name: 'X', prefix: '' },
      }, 0)).toThrow();
    }
  });

  it('header 名按 HTTP token 规则，prefix 禁止换行（防头注入）', () => {
    expect(() => parseSecretSpec({
      key: 'k', label: 'L', allowedHosts: ['a.example.com'],
      header: { name: 'Bad Header', prefix: '' },
    }, 0)).toThrow(/header\.name/);
    expect(() => parseSecretSpec({
      key: 'k', label: 'L', allowedHosts: ['a.example.com'],
      header: { name: 'X-Key', prefix: 'x\r\nX-Evil: 1' },
    }, 0)).toThrow(/不允许换行/);
  });

  it('key 只收小写标识符；reauthStatuses 只收 4xx/5xx 整数', () => {
    expect(() => parseSecretSpec({ ...GH, key: 'GitHub_Token' }, 0)).toThrow(/key/);
    expect(() => parseSecretSpec({ ...GH, reauthStatuses: [200] }, 0)).toThrow(/状态码/);
    expect(parseSecretSpec({ ...GH, reauthStatuses: [401, 403, 401] }, 0).reauthStatuses)
      .toEqual([401, 403]);
  });

  it('空 allowedHosts / 重复 key 直接拒绝，不静默放行', () => {
    expect(() => parseSecretSpec({ ...GH, allowedHosts: [] }, 0)).toThrow(/allowedHosts/);
    expect(() => parseSecretSpecs([GH, GH])).toThrow(/重复/);
  });

  it('缺省 method 的老配方逐字兼容，结果里不出现 POST 字段', () => {
    const s = parseSecretSpec(GH, 0);
    expect(s).toEqual(GH);
    expect(s).not.toHaveProperty('method');
    expect(s).not.toHaveProperty('bodyStatic');
    expect(s).not.toHaveProperty('bodyQueryParams');
  });

  it('合法 POST 声明：method / bodyStatic / bodyQueryParams 原样通过', () => {
    const s = parseSecretSpec({
      ...GH,
      key: 'tavily_api_key',
      method: 'POST',
      bodyStatic: { search_depth: 'basic', max_results: 5, include_answer: true },
      bodyQueryParams: ['query', 'query'],
    }, 0);
    expect(s.method).toBe('POST');
    expect(s.bodyStatic).toEqual({
      search_depth: 'basic', max_results: 5, include_answer: true,
    });
    expect(s.bodyQueryParams).toEqual(['query']); // 去重
  });

  it('method 只收 GET / POST；body 字段名按标识符规则', () => {
    expect(() => parseSecretSpec({ ...GH, method: 'DELETE' }, 0)).toThrow(/method/);
    // 配方真实来源是 JSON.parse，那里 '__proto__' 是 own key（对象字面量不是）
    const dirty = JSON.parse('{"__proto__":1}') as Record<string, unknown>;
    expect(() => parseSecretSpec({ ...GH, method: 'POST', bodyStatic: dirty }, 0))
      .toThrow(/bodyStatic/);
    expect(() => parseSecretSpec({ ...GH, method: 'POST', bodyStatic: { constructor: 1 } }, 0))
      .toThrow(/bodyStatic/);
    expect(() => parseSecretSpec({ ...GH, method: 'POST', bodyQueryParams: ['__proto__'] }, 0))
      .toThrow(/bodyQueryParams/);
    expect(() => parseSecretSpec({ ...GH, method: 'POST', bodyQueryParams: ['bad-key'] }, 0))
      .toThrow(/bodyQueryParams/);
    expect(() => parseSecretSpec({ ...GH, method: 'POST', bodyQueryParams: 'query' }, 0))
      .toThrow(/bodyQueryParams/);
  });

  it('POST 专属字段不能出现在 GET 里；POST 必须有 body 来源', () => {
    expect(() => parseSecretSpec({ ...GH, bodyStatic: { a: 1 } }, 0)).toThrow(/POST/);
    expect(() => parseSecretSpec({ ...GH, bodyQueryParams: ['q'] }, 0)).toThrow(/POST/);
    expect(() => parseSecretSpec({ ...GH, method: 'GET', bodyQueryParams: ['q'] }, 0)).toThrow(/POST/);
    expect(() => parseSecretSpec({ ...GH, method: 'POST' }, 0)).toThrow(/bodyStatic/);
  });

  it('bodyStatic 不可 JSON 序列化（BigInt / 循环引用）直接拒绝', () => {
    expect(() => parseSecretSpec({ ...GH, method: 'POST', bodyStatic: { n: BigInt(1) } }, 0))
      .toThrow(/序列化/);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => parseSecretSpec({ ...GH, method: 'POST', bodyStatic: cyclic }, 0))
      .toThrow(/序列化/);
  });
});

describe('collectSecretSpecs', () => {
  it('汇总已启用配方；缺省字段的老配方不产出规格', () => {
    expect(collectSecretSpecs([{}, { secrets: [GH] }, { secrets: [GH] }])).toEqual([GH]);
  });

  it('同名但不一致的声明抛错（不能静默挑一份决定 token 发往哪里）', () => {
    expect(() => collectSecretSpecs([
      { secrets: [GH] },
      { secrets: [{ ...GH, allowedHosts: ['evil.example.com'] }] },
    ])).toThrow(/不一致/);
  });
});

describe('parseSkillRecipe 与 secrets', () => {
  const base = {
    schemaVersion: 1, id: 'user.x', version: 1, name: 'X', summary: 's',
    primitives: ['http_fetch_auth'], prompt: 'p',
  };

  it('缺省字段：老配方逐字兼容，结果里不出现 secrets', () => {
    const r = parseSkillRecipe(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skill).not.toHaveProperty('secrets');
  });

  it('合法声明透传到 skill，且与原对象逐字段相等', () => {
    const r = parseSkillRecipe({ ...base, secrets: [GH] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skill.secrets).toEqual([GH]);
  });

  it('非法声明在解析阶段就拒绝，绝不带着半份规格进运行时', () => {
    const r = parseSkillRecipe({ ...base, secrets: [{ ...GH, allowedHosts: ['https://evil.com'] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('allowedHosts');
  });

  it('POST 规格透传到 skill（解析层不丢字段）', () => {
    const spec = {
      ...GH, key: 'tavily_api_key', method: 'POST',
      bodyStatic: { max_results: 5 }, bodyQueryParams: ['query'],
    };
    const r = parseSkillRecipe({ ...base, secrets: [spec] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skill.secrets).toEqual([spec]);
  });
});
