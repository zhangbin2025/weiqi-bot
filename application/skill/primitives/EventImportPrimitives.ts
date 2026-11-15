/**
 * 赛事导入两阶段原语（图片通道）
 * @description event_parse_draft 把编排表上的**累计积分**校验成草稿 + pdfScores 快照
 * 并生成预览 + draftToken（不写库）；event_commit_draft 只在预览之后的用户新消息、
 * 且 confirm 明确为 true 时才写库，写库后按 PDF 通道同一套逻辑回算胜负。
 * 所有异常都转成 observation（ok:false），绝不抛穿。
 *
 * 胜负不是模型读出来的：编排表上的得分是累计积分（大分），第 1 轮通常是 0:0，
 * 本轮胜负由「下一轮累计分 − 本轮累计分」差分反推（recalcWinLoss）。
 */

import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import {
  validateEventDraft,
  type EventDraft,
} from '@services/event/EventDraft';
import { recalcWinLoss } from '@services/event/WinLoss';
import { PdfEventService } from '@services/event/PdfEventService';
import { SessionStorageAdapter } from '@infrastructure/storage/adapters/web/SessionStorageAdapter';
import { currentUserTurn } from '../SkillTurn';

/** 会话内有效的草稿暂存：不落盘、不设过期时间 */
const DRAFT_STORE = new Map<string, EventDraft>();
let draftSeq = 0;

/**
 * 唯一「待确认草稿」。
 *
 * ToolLoop 的 role:'tool' 观察只在单次 turn 的内存里、不落会话历史：用户回复
 * 「确认」是新一轮，模型看不到上一轮 parse 返回的 draftToken。因此 commit 允许
 * 省略 draftToken，由宿主自动提交这里指向的草稿。新一次 parse 会覆盖它，
 * commit 成功后清空 —— 任何时刻最多只有一份草稿可被静默确认。
 */
let pendingToken: string | undefined;

function nextToken(): string {
  draftSeq += 1;
  return `draft-${draftSeq}-${Date.now()}`;
}

const PARSE_DEFINITION: SkillPrimitive['definition'] = {
  name: 'event_parse_draft',
  description: '把从图片读到的编排对阵表校验成规范草稿，返回预览摘要与 draftToken。不写库。表上的得分是选手截至本轮的累计积分（大分），不是本轮胜负；胜负由宿主在导入下一轮后差分回算。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '比赛名称' },
      groupName: { type: 'string', description: '分组名，可省略（默认组）' },
      round: { type: 'integer', description: '第几轮（正整数）' },
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            table: { type: 'integer', description: '台号，可省略' },
            p1Name: { type: 'string', description: '黑方姓名' },
            p1Score: { type: 'number', description: '黑方截至本轮的累计积分（大分）；第1轮通常为0，不要填胜负分' },
            p2Name: { type: 'string', description: '白方姓名，轮空填空串' },
            p2Score: { type: 'number', description: '白方截至本轮的累计积分（大分）；第1轮通常为0，轮空填0' },
          },
          required: ['p1Name', 'p1Score', 'p2Name', 'p2Score'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'round', 'matches'],
    additionalProperties: false,
  },
};

const COMMIT_DEFINITION: SkillPrimitive['definition'] = {
  name: 'event_commit_draft',
  description: '用户在下一条消息里明确确认预览后，把待确认草稿写入本地赛事库、按累计分差分回算已能确定的轮次胜负，并返回详情入口。draftToken 可省略，省略时提交最近一次预览的草稿。同一条消息内生成预览后立即调用会被宿主拒绝。',
  parameters: {
    type: 'object',
    properties: {
      draftToken: { type: 'string', description: '可选；省略则提交最近一次预览的草稿' },
      confirm: { type: 'boolean', description: '必须为用户已明确确认后的 true' },
    },
    required: ['confirm'],
    additionalProperties: false,
  },
};

function fail(observation: string, detail: string): PrimitiveResult {
  return { observation, ok: false, detail };
}

function matchSummary(draft: EventDraft): string[] {
  return draft.matches.map((m) => {
    const p2 = m.p2Name === '' ? '轮空' : m.p2Name;
    const b = draft.pdfScores[m.p1Name] ?? 0;
    const w = m.p2Name === '' ? 0 : (draft.pdfScores[m.p2Name] ?? 0);
    return `第${m.table}台：${m.p1Name}(累计${b}) vs ${p2}(累计${w})`;
  });
}

function buildPreview(draft: EventDraft, token: string): string {
  const lines = [
    `草稿校验通过：比赛《${draft.title}》/ 分组「${draft.groupName}」/ 第${draft.round}轮 / 共${draft.matches.length}场`,
    ...matchSummary(draft),
    '说明：表上为累计积分（大分），本轮胜负将从下一轮累计分差分回算；当前轮次胜负暂记为未定。',
    `draftToken：${token}`,
    '请把预览复述给用户并结束本轮回复；等用户下一条消息明确确认后，再调用 event_commit_draft（无需再传 token）。同一条消息内不能写库。',
  ];
  return lines.join('\n');
}

/** 顶层兜底：任何异常都转成 ok:false 的 observation，不让异常抛穿工具链 */
async function parseDraft(argsJson: string): Promise<PrimitiveResult> {
  try {
    return await parseDraftInner(argsJson);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(`解析赛事草稿失败：${message}`, '事件草稿解析失败');
  }
}

async function parseDraftInner(argsJson: string): Promise<PrimitiveResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(argsJson) as unknown;
  } catch {
    return fail('入参不是合法 JSON，无法解析赛事草稿', '事件草稿解析失败');
  }

  const result = validateEventDraft(raw);
  if (!result.ok) {
    const observation = [
      '赛事草稿校验失败：',
      ...result.errors.map((e) => `- ${e}`),
    ].join('\n');
    return fail(observation, '事件草稿校验失败');
  }

  const token = nextToken();
  // 用户改草稿时，旧预览立即作废，避免模型误提交了上一版。
  if (pendingToken) DRAFT_STORE.delete(pendingToken);
  DRAFT_STORE.set(token, result.draft);
  pendingToken = token;
  pendingCreatedAtSeq = currentUserTurn();
  return {
    observation: buildPreview(result.draft, token),
    ok: true,
    detail: `已生成《${result.draft.title}》第${result.draft.round}轮草稿预览（${result.draft.matches.length}场），等待确认`,
  };
}

interface CommitArgs {
  draftToken?: unknown;
  confirm?: unknown;
}

/** 顶层兜底：任何异常都转成 ok:false 的 observation，不让异常抛穿工具链 */
async function commitDraft(argsJson: string): Promise<PrimitiveResult> {
  try {
    return await commitDraftInner(argsJson);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(`提交赛事草稿失败：${message}`, '事件草稿提交失败');
  }
}

async function commitDraftInner(argsJson: string): Promise<PrimitiveResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(argsJson) as unknown;
  } catch {
    return fail('入参不是合法 JSON，无法提交赛事草稿', '事件草稿提交失败');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('入参必须是一个对象', '事件草稿提交失败');
  }
  const args = raw as CommitArgs;

  if (args.confirm !== true) {
    return fail('尚未得到用户明确确认（confirm 必须为 true），未写入赛事库', '等待用户确认');
  }

  // 确认轮模型看不到上一轮的观察文本，因此 draftToken 可省略：
  // 宿主自动提交唯一待确认草稿。显式传了仍按显式值取。
  const token = typeof args.draftToken === 'string' && args.draftToken !== ''
    ? args.draftToken
    : pendingToken;
  if (!token) {
    return fail('没有待确认的草稿（未传 draftToken 且无最近预览），请先调用 event_parse_draft 生成预览', '无待确认草稿');
  }

  const draft = DRAFT_STORE.get(token);
  if (!draft) {
    return fail('draftToken 不存在或已使用，请重新调用 event_parse_draft 生成预览', '草稿令牌失效');
  }

  // 硬闸门：预览必须来自**上一条**用户消息，本轮同一条消息内不允许自动写库。
  // 这条边界由宿主保证，不依赖模型自觉，也不依赖任何阈值/计时。
  // parse 每次都会删掉上一个 pendingToken，故 DRAFT_STORE 里唯一存活的草稿
  // 就是最近一次预览，pendingCreatedAtSeq 对任何能取到的 token 都成立；
  // 因此这里不附加「token === pendingToken」条件，显式传旧 token 也绕不过去。
  if (currentUserTurn() <= pendingCreatedAtSeq) {
    return fail(
      '预览刚在本条消息里生成，必须等用户下一条消息明确确认后才能写入赛事库；请把预览摘要复述给用户并结束本轮回复。',
      '等待用户下一条消息确认',
    );
  }

  try {
    const service = new PdfEventService();
    await service.importRound(
      draft.title,
      draft.groupName,
      draft.round,
      draft.matches,
      draft.pdfScores,
    );

    const event = await service.findEvent(draft.title);
    if (!event) {
      return fail('写入赛事库后未能读取到该赛事，无法定位详情入口', '赛事读取失败');
    }
    const group = event.groups.find((g) => g.name === draft.groupName);
    if (!group) {
      return fail('写入赛事库后未能定位到目标分组，无法定位详情入口', '分组读取失败');
    }

    // 与 PDF 通道同一套入库路径：导入新一轮后按累计分差分回算已能确定的轮次胜负，
    // 再整体保存。第 1 轮单独导入时它的胜负仍是未定（0/0），符合编排表语义。
    recalcWinLoss(group);
    await service.saveEvent(event);

    const store = new SessionStorageAdapter('weiqi-bot');
    await store.initialize();
    await store.write('pdf-event-detail', { eventId: event.id, groupId: group.id });

    // 一次性 token：写库成功后删除，并清空唯一待确认指针
    DRAFT_STORE.delete(token);
    if (pendingToken === token) pendingToken = undefined;

    const entry = `../event/detail.html?source=pdf&title=${encodeURIComponent(draft.title)}`;
    const observation = [
      `已导入《${draft.title}》/ 分组「${draft.groupName}」/ 第${draft.round}轮（${draft.matches.length}场）。`,
      `详情入口：${entry}`,
      '也可从 赛事 → 最近 打开（同标签页跳转时详情入口直达生效）。',
    ].join('\n');
    return {
      observation,
      ok: true,
      detail: `已导入《${draft.title}》第${draft.round}轮`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(`写入赛事库失败：${message}`, '事件草稿提交失败');
  }
}

/**
 * 人工确认闸门（宿主侧，模型无法绕过）。
 *
 * ToolLoop 在**同一条用户消息**里会连续决策：模型可能 parse 出草稿后立刻
 * 自动 commit，这样「等用户确认」就形同虚设。因此 parse 时记录当前用户消息
 * 序号（来自 SkillTurn），commit 只接受「之后的新一条用户消息」触发的调用。
 * 这是结构性轮次边界，不依赖任何阈值/计时，也不依赖模型自觉。
 */
let pendingCreatedAtSeq = -1;

export const EVENT_PRIMITIVES: SkillPrimitive[] = [
  { name: 'event_parse_draft', definition: PARSE_DEFINITION, execute: parseDraft },
  { name: 'event_commit_draft', definition: COMMIT_DEFINITION, execute: commitDraft },
];
