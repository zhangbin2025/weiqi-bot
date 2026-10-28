import { describe, it, expect } from 'vitest';
import { parseLibUrl, describeLibUrl } from '../../../domain/intent/libUrl';

const PAT = /^lib:\/\/(life-and-death|ai-review)\/([0-9a-f]{32})/i;

describe('lib:// 新 URL 格式（内容派生 md5）', () => {
  const id = '13bb699b73bcc09b3ced3d3cdd1f9691';

  it('解析出 category + id', () => {
    expect(parseLibUrl(`lib://life-and-death/${id}`)).toEqual({
      category: 'life-and-death', id,
    });
  });

  it('棋谱分类同样可解析', () => {
    expect(parseLibUrl(`lib://ai-review/${id}`)?.id).toBe(id);
  });

  it('Provider.urlPatterns 正则能匹配', () => {
    expect(PAT.test(`lib://ai-review/${id}`)).toBe(true);
  });

  it('描述文案不含日期（内置题库 #13bb）', () => {
    expect(describeLibUrl(`lib://life-and-death/${id}`)).toBe('内置题库 #13bb');
  });

  it('源列表 URL（无 id）仍可解析', () => {
    expect(parseLibUrl('lib://life-and-death')).toEqual({ category: 'life-and-death' });
  });

  it('旧格式（日期/下标）不再被接受', () => {
    expect(parseLibUrl('lib://life-and-death/2026-10-27/0')).toBeNull();
  });

  it('非 32 位 hex 不被接受', () => {
    expect(parseLibUrl('lib://life-and-death/abc')).toBeNull();
  });
});
