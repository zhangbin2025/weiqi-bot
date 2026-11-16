/**
 * EventImportPrimitives 单元测试
 * @description 校验两阶段原语；PdfEventService / SessionStorageAdapter 全部 mock，
 * 不打真实 IndexedDB，也无需 sessionStorage。
 *
 * 语义回归重点：编排表上的得分是**累计积分（大分）**，第 1 轮 0:0 合法；
 * 胜负由宿主在导入下一轮后用 recalcWinLoss 差分回算，模型不提供胜负分。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PdfEvent } from '@services/event/PdfEventTypes';
import type { SkillPrimitive } from '@application/skill/SkillTypes';
import {
  EVENT_PRIMITIVES,
  getTableDraft,
  applyTableEdits,
} from '../primitives/EventImportPrimitives';
import { beginUserTurn } from '../SkillTurn';

const mocks = vi.hoisted(() => ({
  importRound: vi.fn(),
  findEvent: vi.fn(),
  saveEvent: vi.fn(),
  initialize: vi.fn(),
  write: vi.fn(),
}));

vi.mock('@services/event/PdfEventService', () => ({
  PdfEventService: vi.fn().mockImplementation(() => ({
    importRound: mocks.importRound,
    findEvent: mocks.findEvent,
    saveEvent: mocks.saveEvent,
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
const editTable = primitive('event_edit_table');
const commit = primitive('event_commit_draft');

/** 第 1 轮编排表：赛前双方累计分都是 0（这是真实图片里的形态） */
const firstRoundDraft = {
  title: '第四届孙子兵法杯',
  groupName: '公开组',
  round: 1,
  matches: [
    { table: 1, p1Name: '王可汗', p1Score: 0, p2Name: '申云豪', p2Score: 0 },
    { table: 2, p1Name: '李子恩', p1Score: 0, p2Name: '刘海洋', p2Score: 0 },
  ],
};

/** 第 2 轮编排表：累计分里已含第 1 轮结果（胜者 +2） */
const secondRoundDraft = {
  title: '第四届孙子兵法杯',
  groupName: '公开组',
  round: 2,
  matches: [
    { table: 1, p1Name: '王可汗', p1Score: 2, p2Name: '李子恩', p2Score: 2 },
    { table: 2, p1Name: '申云豪', p1Score: 0, p2Name: '刘海洋', p2Score: 0 },
  ],
};

/** 兼容旧断言用的通用草稿（第 2 轮累计分） */
const validDraft = secondRoundDraft;

function makeEvent(rounds: PdfEvent['groups'][number]['rounds'] = []): PdfEvent {
  return {
    id: 'evt-1',
    title: validDraft.title,
    groups: [{ id: 'grp-1', name: validDraft.groupName, rounds }],
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

/** 从 edit_table 的 observation 里取出表格链接里的 token */
function extractTableToken(observation: string): string {
  const m = /event-table:(\S+?)\)/.exec(observation);
  if (!m || !m[1]) throw new Error(`observation 里没有表格链接：${observation}`);
  return m[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.initialize.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
  mocks.saveEvent.mockResolvedValue(undefined);
  mocks.importRound.mockImplementation(async (
    _title: string, _group: string, round: number,
    _matches: unknown, pdfScores: Record<string, number>,
  ) => {
    // 模拟 importRound 把新轮次并入事件：带上本轮累计分快照
    return makeEvent([{ round, matches: [], pdfScores, importedAt: 0 }]);
  });
  mocks.findEvent.mockImplementation(async () => makeEvent([
    { round: 1, matches: [
      { bout: 1, table: 1, p1Id: 1, p1Name: '王可汗', p1Score: 0, p2Id: 3, p2Name: '申云豪', p2Score: 0 },
      { bout: 1, table: 2, p1Id: 2, p1Name: '李子恩', p1Score: 0, p2Id: 4, p2Name: '刘海洋', p2Score: 0 },
    ], pdfScores: { 王可汗: 0, 申云豪: 0, 李子恩: 0, 刘海洋: 0 }, importedAt: 0 },
    { round: 2, matches: [], pdfScores: { 王可汗: 2, 申云豪: 0, 李子恩: 2, 刘海洋: 0 }, importedAt: 0 },
  ]));
});

describe('event_parse_draft', () => {
  it('合法草稿返回 ok 与预览，含比赛名/分组/轮次/场数/逐场摘要/draftToken/确认提示', async () => {
    const r = await parse.execute(JSON.stringify(validDraft));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('第四届孙子兵法杯');
    expect(r.observation).toContain('公开组');
    expect(r.observation).toContain('第2轮');
    expect(r.observation).toContain('共2场');
    expect(r.observation).toContain('王可汗');
    expect(r.observation).toContain('累计2');
    expect(r.observation).toContain('draftToken：');
    expect(r.observation).toContain('结束本轮回复');
    expect(r.observation).toContain('下一条消息明确确认');
    expect(r.observation).toContain('event_commit_draft');
    expect(extractToken(r.observation)).toBeTruthy();
    expect(mocks.importRound).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('第 1 轮编排表 0:0（累计分，非胜负）可通过，不再被当成「双方同为负」', async () => {
    const r = await parse.execute(JSON.stringify(firstRoundDraft));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('累计0');
    expect(r.observation).toContain('本轮胜负将从下一轮累计分差分回算');
  });

  it('累计分允许非负小数（兼容表上 0.5 等显示）', async () => {
    const d = { ...firstRoundDraft, matches: [
      { p1Name: '甲', p1Score: 0.5, p2Name: '乙', p2Score: 0.5 },
    ] };
    const r = await parse.execute(JSON.stringify(d));
    expect(r.ok).toBe(true);
  });

  it('负累计分被拒', async () => {
    const bad = { ...validDraft, matches: [{ p1Name: '甲', p1Score: -1, p2Name: '乙', p2Score: 0 }] };
    const r = await parse.execute(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('累计积分');
    expect(r.observation).toContain('非负数字');
  });

  it('空姓名被拒', async () => {
    const bad = { ...validDraft, matches: [{ p1Name: '', p1Score: 0, p2Name: '乙', p2Score: 0 }] };
    const r = await parse.execute(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('黑方姓名');
  });

  it('轮空（p2Name 空串 / p2Score 0）可通过', async () => {
    const bye = { title: '轮空赛', round: 1, matches: [{ p1Name: '甲', p1Score: 0, p2Name: '', p2Score: 0 }] };
    const r = await parse.execute(JSON.stringify(bye));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('轮空');
  });
});

describe('event_edit_table — 可编辑表格草稿', () => {
  it('返回表格链接而非文本预览，并要求模型禁止逐台复述', async () => {
    const r = await editTable.execute(JSON.stringify(validDraft));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('event-table:');
    expect(r.observation).toContain('📋 打开对阵表核对 / 修改 / 导入');
    expect(r.observation).toContain('禁止在本条消息里逐台复述');
    // 全量数据只在表格里，不靠文字摘要；观察里不出现「第1台：」这类逐场文本
    expect(r.observation).not.toContain('第1台：');
    expect(mocks.importRound).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('全量逐场数据（含累计积分）可按 token 读出，供弹框逐格编辑', async () => {
    const r = await editTable.execute(JSON.stringify(secondRoundDraft));
    const token = extractTableToken(r.observation);
    const draft = getTableDraft(token);
    expect(draft?.title).toBe(secondRoundDraft.title);
    expect(draft?.groupName).toBe(secondRoundDraft.groupName);
    expect(draft?.round).toBe(2);
    expect(draft?.matches).toHaveLength(2);
    // 这里是累计积分（2/2、0/0），不是胜负分；与 EventDraft.matches 里的 0/0 不同
    expect(draft?.matches[0]).toEqual({
      table: 1, p1Name: '王可汗', p1Score: 2, p2Name: '李子恩', p2Score: 2,
    });
    expect(draft?.matches[1]).toEqual({
      table: 2, p1Name: '申云豪', p1Score: 0, p2Name: '刘海洋', p2Score: 0,
    });
  });

  it('省略台号时按下标 +1 补齐，与 validateEventDraft 规则一致', async () => {
    const noTable = { ...validDraft, matches: [
      { p1Name: '甲', p1Score: 0, p2Name: '乙', p2Score: 0 },
      { p1Name: '丙', p1Score: 0, p2Name: '丁', p2Score: 0 },
    ] };
    const r = await editTable.execute(JSON.stringify(noTable));
    const draft = getTableDraft(extractTableToken(r.observation));
    expect(draft?.matches.map((m) => m.table)).toEqual([1, 2]);
  });

  it('非法草稿被拒且不产生可编辑表格', async () => {
    const bad = { ...validDraft, matches: [{ p1Name: '甲', p1Score: -1, p2Name: '乙', p2Score: 0 }] };
    const r = await editTable.execute(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('非负数字');
    expect(r.observation).not.toContain('event-table:');
  });

  it('弹框编辑结果覆盖待确认草稿：commit 写入的是改过的版本', async () => {
    const r = await editTable.execute(JSON.stringify(secondRoundDraft));
    const token = extractTableToken(r.observation);
    const edited = {
      ...secondRoundDraft,
      title: '用户改过的比赛名',
      matches: [
        { table: 1, p1Name: '王可汗', p1Score: 4, p2Name: '李子恩', p2Score: 2 },
        { table: 2, p1Name: '申云豪', p1Score: 0, p2Name: '刘海洋', p2Score: 0 },
      ],
    };
    expect(applyTableEdits(token, edited).ok).toBe(true);
    expect(getTableDraft(token)?.matches[0]?.p1Score).toBe(4);

    beginUserTurn(); // 用户点「导入」→ 宿主发来新的确认消息
    const c = await commit.execute(JSON.stringify({ confirm: true }));
    expect(c.ok).toBe(true);
    const args = mocks.importRound.mock.calls[0] as unknown[];
    expect(args[0]).toBe('用户改过的比赛名');
    expect(args[4]).toEqual({ 王可汗: 4, 李子恩: 2, 申云豪: 0, 刘海洋: 0 });
  });

  it('非法编辑被拒且不写坏原草稿，用户可原地修正后重试', async () => {
    const r = await editTable.execute(JSON.stringify(validDraft));
    const token = extractTableToken(r.observation);
    const badEdit = { ...validDraft, matches: [{ p1Name: '', p1Score: 0, p2Name: '乙', p2Score: 0 }] };
    const result = applyTableEdits(token, badEdit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('黑方姓名');
    expect(getTableDraft(token)?.matches).toHaveLength(2);
    expect(mocks.importRound).not.toHaveBeenCalled();
  });

  it('失效 / 未知 token 的编辑被明确拒绝', async () => {
    const r = await editTable.execute(JSON.stringify(validDraft));
    const token = extractTableToken(r.observation);
    beginUserTurn();
    await commit.execute(JSON.stringify({ confirm: true })); // 写库后 token 一次性失效
    const result = applyTableEdits(token, validDraft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('失效');
  });

  it('新一次 edit_table 覆盖旧草稿，旧 token 的表格数据立即不可读', async () => {
    const first = await editTable.execute(JSON.stringify(validDraft));
    const oldToken = extractTableToken(first.observation);
    await editTable.execute(JSON.stringify({ ...validDraft, title: '新版' }));
    expect(getTableDraft(oldToken)).toBeUndefined();
    expect(applyTableEdits(oldToken, validDraft).ok).toBe(false);
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

  it('commit 成功调用 importRound（带累计分快照）、回算并 saveEvent、写 pdf-event-detail', async () => {
    const p = await parse.execute(JSON.stringify(secondRoundDraft));
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
    // p1Score/p2Score 是未定胜负（0），不是累计分；累计分在 args[4] 快照里
    expect(args[4]).toEqual({ 王可汗: 2, 李子恩: 2, 申云豪: 0, 刘海洋: 0 });
    const saved = mocks.saveEvent.mock.calls[0]?.[0] as PdfEvent;
    expect(saved).toBeTruthy();
    const round1 = saved.groups[0]?.rounds.find((x) => x.round === 1);
    // 第 2 轮累计分确定第 1 轮结果：王可汗/李子恩胜(2)，申云豪/刘海洋负(0)
    expect(round1?.matches.find((m) => m.p1Name === '王可汗')?.p1Score).toBe(2);
    expect(round1?.matches.find((m) => m.p1Name === '王可汗')?.p2Score).toBe(0);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledWith('pdf-event-detail', {
      eventId: 'evt-1',
      groupId: 'grp-1',
    });
    expect(r.observation).toContain('已导入《第四届孙子兵法杯》');
    expect(r.observation).toContain('../event/detail.html?source=pdf&title=');
    expect(r.observation).toContain(encodeURIComponent(validDraft.title));
    expect(r.observation).toContain('赛事 → 最近');
  });

  it('仅导入第 1 轮时胜负保持未定（0/0），不臆造结果', async () => {
    mocks.findEvent.mockImplementation(async () => makeEvent([
      { round: 1, matches: [
        { bout: 1, table: 1, p1Id: 1, p1Name: '王可汗', p1Score: 0, p2Id: 2, p2Name: '申云豪', p2Score: 0 },
      ], pdfScores: { 王可汗: 0, 申云豪: 0 }, importedAt: 0 },
    ]));
    const p = await parse.execute(JSON.stringify(firstRoundDraft));
    beginUserTurn();
    const r = await commit.execute(JSON.stringify({ confirm: true }));
    expect(r.ok).toBe(true);
    const saved = mocks.saveEvent.mock.calls[0]?.[0] as PdfEvent;
    expect(saved.groups[0]?.rounds[0]?.matches[0]?.p1Score).toBe(0);
    expect(saved.groups[0]?.rounds[0]?.matches[0]?.p2Score).toBe(0);
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
    expect(r.observation).toContain('已导入《第四届孙子兵法杯》');
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
