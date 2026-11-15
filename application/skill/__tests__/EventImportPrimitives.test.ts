/**
 * EventImportPrimitives 单元测试
 * @description 只校验两阶段原语的行为；PdfEventService / SessionStorageAdapter 全部 mock，
 * 不打真实 IndexedDB，也无需 sessionStorage。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PdfEvent } from '@services/event/PdfEventTypes';
import type { SkillPrimitive } from '@application/skill/SkillTypes';
import { EVENT_PRIMITIVES } from '../primitives/EventImportPrimitives';
import { beginUserTurn } from '../SkillTurn';

const mocks = vi.hoisted(() => ({
  importRound: vi.fn(),
  findEvent: vi.fn(),
  initialize: vi.fn(),
  write: vi.fn(),
}));

vi.mock('@services/event/PdfEventService', () => ({
  PdfEventService: vi.fn().mockImplementation(() => ({
    importRound: mocks.importRound,
    findEvent: mocks.findEvent,
  })),
}));

vi.mock('@infrastructure/storage/adapters/web/SessionStorageAdapter', () => ({
  SessionStorageAdapter: vi.fn().mockImplementation(() => ({
    initialize: mocks.initialize,
    write: mocks.write,
  })),
}));

function primitive(name: string): SkillPrimitive {
  const found = EVENT_PRIMITIVES.find((p) => p.name === name);
  if (!found) throw new Error(`缺少原语 ${name}`);
  return found;
}

const parse = primitive('event_parse_draft');
const commit = primitive('event_commit_draft');

const validDraft = {
  title: '2026 春季围棋赛',
  groupName: '公开组',
  round: 2,
  matches: [
    { p1Name: '张三', p1Score: 2, p2Name: '李四', p2Score: 0 },
    { p1Name: '王五', p1Score: 1, p2Name: '赵六', p2Score: 1 },
  ],
};

function makeEvent(): PdfEvent {
  return {
    id: 'evt-1',
    title: validDraft.title,
    groups: [{ id: 'grp-1', name: validDraft.groupName, rounds: [] }],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 从 parse 的 observation 里取出 draftToken */
function extractToken(observation: string): string {
  const m = /draftToken：(\S+)/.exec(observation);
  if (!m || !m[1]) throw new Error(`observation 里没有 draftToken：${observation}`);
  return m[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.initialize.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
  mocks.importRound.mockResolvedValue(makeEvent());
  mocks.findEvent.mockResolvedValue(makeEvent());
});

describe('event_parse_draft', () => {
  it('合法草稿返回 ok 与预览，含比赛名/分组/轮次/场数/逐场摘要/draftToken/确认提示', async () => {
    const r = await parse.execute(JSON.stringify(validDraft));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('2026 春季围棋赛');
    expect(r.observation).toContain('公开组');
    expect(r.observation).toContain('第2轮');
    expect(r.observation).toContain('共2场');
    expect(r.observation).toContain('张三');
    expect(r.observation).toContain('赵六');
    expect(r.observation).toContain('draftToken：');
    expect(r.observation).toContain('结束本轮回复');
    expect(r.observation).toContain('下一条消息明确确认');
    expect(r.observation).toContain('event_commit_draft');
    expect(extractToken(r.observation)).toBeTruthy();
    expect(mocks.importRound).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('非法比分被拒并列明 errors', async () => {
    const bad = { ...validDraft, matches: [{ p1Name: '甲', p1Score: 3, p2Name: '乙', p2Score: 0 }] };
    const r = await parse.execute(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('只允许 2/0/1');
  });

  it('空姓名被拒', async () => {
    const bad = { ...validDraft, matches: [{ p1Name: '', p1Score: 2, p2Name: '乙', p2Score: 0 }] };
    const r = await parse.execute(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('黑方姓名');
  });

  it('双方同为胜(2/2)被拒', async () => {
    const bad = { ...validDraft, matches: [{ p1Name: '甲', p1Score: 2, p2Name: '乙', p2Score: 2 }] };
    const r = await parse.execute(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('同为胜');
  });

  it('轮空（p2Name 空串 / p2Score 0）可通过', async () => {
    const bye = { title: '轮空赛', round: 1, matches: [{ p1Name: '甲', p1Score: 2, p2Name: '', p2Score: 0 }] };
    const r = await parse.execute(JSON.stringify(bye));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('轮空');
  });
});

describe('event_commit_draft', () => {
  it('同一条用户消息内自动 commit 被宿主闸门拒绝（模型无法自问自答写库）', async () => {
    const p = await parse.execute(JSON.stringify(validDraft));
    const token = extractToken(p.observation);
    const r = await commit.execute(JSON.stringify({ draftToken: token, confirm: true }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('下一条消息');
    expect(mocks.importRound).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    // 推进到用户的下一条消息后，同一份草稿才允许写入
    beginUserTurn();
    const next = await commit.execute(JSON.stringify({ draftToken: token, confirm: true }));
    expect(next.ok).toBe(true);
    expect(mocks.importRound).toHaveBeenCalledTimes(1);
  });

  it('confirm:false 不写库，返回需确认', async () => {
    const p = await parse.execute(JSON.stringify(validDraft));
    const token = extractToken(p.observation);
    beginUserTurn();
    const r = await commit.execute(JSON.stringify({ draftToken: token, confirm: false }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('明确确认');
    expect(mocks.importRound).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('commit 成功调用 importRound 且写 sessionStorage 的 pdf-event-detail', async () => {
    const p = await parse.execute(JSON.stringify(validDraft));
    const token = extractToken(p.observation);
    beginUserTurn();
    const r = await commit.execute(JSON.stringify({ draftToken: token, confirm: true }));
    expect(r.ok).toBe(true);
    expect(mocks.importRound).toHaveBeenCalledTimes(1);
    const args = mocks.importRound.mock.calls[0] as unknown[];
    expect(args[0]).toBe(validDraft.title);
    expect(args[1]).toBe(validDraft.groupName);
    expect(args[2]).toBe(validDraft.round);
    expect(args[3]).toHaveLength(2);
    expect(args[4]).toEqual({});
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledWith('pdf-event-detail', {
      eventId: 'evt-1',
      groupId: 'grp-1',
    });
    expect(r.observation).toContain('已导入《2026 春季围棋赛》');
    expect(r.observation).toContain('../event/detail.html?source=pdf&title=');
    expect(r.observation).toContain(encodeURIComponent(validDraft.title));
    expect(r.observation).toContain('赛事 → 最近');
  });

  it('写库成功后 token 一次性失效', async () => {
    const p = await parse.execute(JSON.stringify(validDraft));
    const token = extractToken(p.observation);
    beginUserTurn();
    await commit.execute(JSON.stringify({ draftToken: token, confirm: true }));
    const r = await commit.execute(JSON.stringify({ draftToken: token, confirm: true }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('不存在或已使用');
  });

  it('跨轮确认：省略 draftToken 时自动提交最近一次预览的草稿', async () => {
    // 模拟真实两阶段：用户回复「确认」是新一轮，模型看不到上一轮的观察文本，
    // 因此只输出 {confirm:true}，由宿主凭唯一待确认指针提交。
    await parse.execute(JSON.stringify(validDraft));
    beginUserTurn(); // 用户下一条消息「确认」
    const r = await commit.execute(JSON.stringify({ confirm: true }));
    expect(r.ok).toBe(true);
    expect(mocks.importRound).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledWith('pdf-event-detail', {
      eventId: 'evt-1',
      groupId: 'grp-1',
    });
    expect(r.observation).toContain('已导入《2026 春季围棋赛》');
  });

  it('提交成功后没有待确认草稿，再次确认只报明确错误而不重复写库', async () => {
    await parse.execute(JSON.stringify(validDraft));
    beginUserTurn();
    await commit.execute(JSON.stringify({ confirm: true }));
    const r = await commit.execute(JSON.stringify({ confirm: true }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('没有待确认的草稿');
    expect(mocks.importRound).toHaveBeenCalledTimes(1);
  });

  it('用户改草稿时新预览覆盖旧的，旧 token 立即失效', async () => {
    const first = await parse.execute(JSON.stringify(validDraft));
    const oldToken = extractToken(first.observation);
    const revised = { ...validDraft, title: '改过的比赛名' };
    await parse.execute(JSON.stringify(revised));
    const r = await commit.execute(JSON.stringify({ draftToken: oldToken, confirm: true }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('不存在或已使用');
    expect(mocks.importRound).not.toHaveBeenCalled();
  });

  it('未知 token 报明确错误', async () => {
    const r = await commit.execute(JSON.stringify({ draftToken: 'no-such-token', confirm: true }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('不存在');
    expect(mocks.importRound).not.toHaveBeenCalled();
  });

  it('写库异常转成 observation 而不抛穿', async () => {
    mocks.importRound.mockRejectedValueOnce(new Error('db down'));
    const p = await parse.execute(JSON.stringify(validDraft));
    const token = extractToken(p.observation);
    beginUserTurn();
    const r = await commit.execute(JSON.stringify({ draftToken: token, confirm: true }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('db down');
  });
});
