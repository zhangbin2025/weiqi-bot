/**
 * 赛事导入原语（图片通道）
 * @description
 * - event_parse_draft：把编排表上的**累计积分**校验成草稿 + pdfScores 快照，返回文本
 *   预览 + draftToken（不写库）。保留旧契约，供未同步的在线配方继续引用。
 * - event_edit_table：同样的全量草稿，但返回**表格链接**而不是文本预览。LLM 只把
 *   链接贴给用户，不复述逐台数据；用户点链接在弹框里查看/修改全量表格，点「导入」
 *   回灌一条确认消息，宿主再触发 LLM 调 event_commit_draft 写库。
 * - event_commit_draft：只在预览/表格之后的用户新消息、且 confirm 明确为 true 时写库，
 *   写库后按 PDF 通道同一套逻辑回算胜负。读的是弹框改过的那份草稿。
 * 所有异常都转成 observation（ok:false），绝不抛穿。
 *
 * 胜负不是模型读出来的：编排表上的得分是累计积分（大分），第 1 轮通常是 0:0，
 * 本轮胜负由「下一轮累计分 − 本轮累计分」差分反推（recalcWinLoss）。
 *
 * 为什么草稿放模块内存而不是 sessionStorage / 独立页面：
 * 弹框与 ChatUseCase 装配的是同一个 ESM 模块实例（同一 SPA 页），共享这两个 Map。
 * 跨页面就是另一个实例，反而要把全量数据序列化搬来搬去。草稿本来就不落盘
 * （与 role:'tool' 观察只在单轮内存一致），刷新即失效是预期行为。
 */

import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import {
  validateEventDraft,
  type EventDraft,
  type EventDraftInput,
} from '@services/event/EventDraft';
import { recalcWinLoss } from '@services/event/WinLoss';
import { PdfEventService } from '@services/event/PdfEventService';
import { SessionStorageAdapter } from '@infrastructure/storage/adapters/web/SessionStorageAdapter';
import { currentUserTurn } from '../SkillTurn';

/** 会话内有效的草稿暂存：不落盘、不设过期时间 */
const DRAFT_STORE = new Map<string, EventDraft>();
/**
 * 表格弹框用的**原始逐场数据**：每行都带累计积分（大分），未收成 pdfScores。
 * 与 DRAFT_STORE 用同一个 token；弹框编辑后由 applyTableEdits 重校验覆盖两份。
 */
const TABLE_STORE = new Map<string, EventDraftInput>();
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

/** 人工确认闸门序号：生成预览/表格时记录，commit 只接受之后的新一条用户消息 */
let pendingCreatedAtSeq = -1;

function nextToken(): string {
  draftSeq += 1;
  return `draft-${draftSeq}-${Date.now()}`;
}

/**
 * 把已通过校验的原始入参还原成「可编辑草稿」：逐场保留表上的累计积分。
 * DRAFT_STORE 里的 EventDraft.matches[].p1Score/p2Score 是**胜负分**（已置 0），
 * 累计分只按姓名收在 pdfScores 里，无法逐台显示；所以弹框必须另存一份原始形态。
 * table 的缺省规则与 validateEventDraft 一致（下标 +1）。
 */
function toEditableDraft(raw: unknown, draft: EventDraft): EventDraftInput {
  const rec = raw as Record<string, unknown>;
  const items: readonly unknown[] = Array.isArray(rec['matches']) ? rec['matches'] : [];
  const matches = items.map((item, index) => {
    const m = (item ?? {}) as Record<string, unknown>;
    const rawTable = m['table'];
    const table = typeof rawTable === 'number' && Number.isInteger(rawTable) && rawTable > 0
      ? rawTable
      : index + 1;
    return {
      table,
      p1Name: typeof m['p1Name'] === 'string' ? m['p1Name'] : '',
      p1Score: typeof m['p1Score'] === 'number' ? m['p1Score'] : 0,
      p2Name: typeof m['p2Name'] === 'string' ? m['p2Name'] : '',
      p2Score: typeof m['p2Score'] === 'number' ? m['p2Score'] : 0,
    };
  });
  return {
    title: draft.title,
    groupName: draft.groupName,
    round: draft.round,
    matches,
  };
}

/** 校验全量草稿并同时写入「写库用」与「弹框用」两份 store；设置唯一待确认指针 */
function storeDraft(raw: unknown):
  | { ok: true; token: string; draft: EventDraft }
  | { ok: false; errors: string[] } {
  const result = validateEventDraft(raw);
  if (!result.ok) return { ok: false, errors: result.errors };

  const token = nextToken();
  // 用户改草稿时，旧预览立即作废，避免模型误提交了上一版。
  if (pendingToken) {
    DRAFT_STORE.delete(pendingToken);
    TABLE_STORE.delete(pendingToken);
  }
  DRAFT_STORE.set(token, result.draft);
  TABLE_STORE.set(token, toEditableDraft(raw, result.draft));
  pendingToken = token;
  pendingCreatedAtSeq = currentUserTurn();
  return { ok: true, token, draft: result.draft };
}

/** 弹框读取：按 token 取全量逐场数据（含累计积分）。无此草稿时返回 undefined。 */
export function getTableDraft(token: string): EventDraftInput | undefined {
  return TABLE_STORE.get(token);
}

/**
 * 弹框「导入」前回写编辑结果：重校验后覆盖 DRAFT_STORE（commit 因此读到改过的版本）
 * 与 TABLE_STORE。只改数据、不写库、不碰确认闸门序号（写库闸门仍在 commit）。
 */
export function applyTableEdits(token: string, edited: unknown):
  | { ok: true }
  | { ok: false; errors: string[] } {
  if (!pendingToken || token !== pendingToken || !TABLE_STORE.has(token)) {
    return { ok: false, errors: ['草稿不存在或已失效，请重新让模型生成对阵表'] };
  }
  const result = validateEventDraft(edited);
  if (!result.ok) return { ok: false, errors: result.errors };
  DRAFT_STORE.set(token, result.draft);
  TABLE_STORE.set(token, toEditableDraft(edited, result.draft));
  return { ok: true };
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

/**
 * 「表格编辑」工具：与 event_parse_draft 同一份全量入参，但产出**链接**而不是文本预览。
 *
 * 现状痛点：全量对阵数据一直只在 tool 的入参/观察里，让模型用自然语言复述必然丢三落四，
 * 用户无法全量确认。这里把全量数据留在宿主内存（TABLE_STORE），只给模型一个短链接，
 * 明确禁止它逐台复述 —— 用户点链接在弹框里看的是**数据本身**，不是模型对数据的描述。
 *
 * 链接用自定义 scheme「event-table:」，与既有 schedule-run: / schedule-delete: 同一套路；
 * marked 会渲染成 <a>，beautifyLinks 只处理 http/lib/katago，不会把它变成 URL 卡片。
 */
const EDIT_TABLE_DEFINITION: SkillPrimitive['definition'] = {
  name: 'event_edit_table',
  description: '把从图片读到的**全部**编排对阵表整理成可编辑草稿，返回一个表格链接。不写库。表上的得分是选手截至本轮的累计积分（大分），不是本轮胜负；胜负由宿主在导入下一轮后差分回算。调用后只需把返回的链接原样贴给用户，禁止逐台复述姓名或分数。',
  parameters: PARSE_DEFINITION.parameters,
};

/** 顶层兜底：任何异常都转成 ok:false 的 observation，不让异常抛穿工具链 */
async function editTable(argsJson: string): Promise<PrimitiveResult> {
  try {
    return await editTableInner(argsJson);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(`生成对阵表失败：${message}`, '对阵表生成失败');
  }
}

async function editTableInner(argsJson: string): Promise<PrimitiveResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(argsJson) as unknown;
  } catch {
    return fail('入参不是合法 JSON，无法生成对阵表', '对阵表生成失败');
  }

  const stored = storeDraft(raw);
  if (!stored.ok) {
    const observation = [
      '对阵表草稿校验失败（请按图片内容修正后重新调用）：',
      ...stored.errors.map((e) => `- ${e}`),
    ].join('\n');
    return fail(observation, '对阵表草稿校验失败');
  }

  const link = `[📋 打开对阵表核对 / 修改 / 导入](event-table:${stored.token})`;
  const observation = [
    `对阵表已生成：《${stored.draft.title}》/ 分组「${stored.draft.groupName}」/ 第${stored.draft.round}轮 / 共${stored.draft.matches.length}场，全部数据已存入可编辑表格。`,
    '',
    '本轮回复只做一件事：把下面这一行链接**原样**贴给用户（不要改写、不要放进代码块、不要加引号）：',
    link,
    '',
    '硬性规则：',
    '- 禁止在本条消息里逐台复述姓名或分数：全量数据已在表格里，用文字复述必然遗漏，用户要在表格中核对。',
    '- 不要再输出其它预览摘要，也不要解释表格内容。',
    '- 禁止现在就调用 event_commit_draft（同一条消息内写库会被宿主拒绝）。',
    '- 用户点开链接、核对或修改后按「导入」，宿主会自动发来一条新的确认消息；**到那时**再调用 event_commit_draft（无需传 draftToken）写库。',
  ].join('\n');
  return {
    observation,
    ok: true,
    detail: `已生成《${stored.draft.title}》第${stored.draft.round}轮可编辑对阵表（${stored.draft.matches.length}场），等待用户在表格中确认`,
  };
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

  const stored = storeDraft(raw);
  if (!stored.ok) {
    const observation = [
      '赛事草稿校验失败：',
      ...stored.errors.map((e) => `- ${e}`),
    ].join('\n');
    return fail(observation, '事件草稿校验失败');
  }
  return {
    observation: buildPreview(stored.draft, stored.token),
    ok: true,
    detail: `已生成《${stored.draft.title}》第${stored.draft.round}轮草稿预览（${stored.draft.matches.length}场），等待确认`,
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
    TABLE_STORE.delete(token);
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

export const EVENT_PRIMITIVES: SkillPrimitive[] = [
  { name: 'event_parse_draft', definition: PARSE_DEFINITION, execute: parseDraft },
  { name: 'event_edit_table', definition: EDIT_TABLE_DEFINITION, execute: editTable },
  { name: 'event_commit_draft', definition: COMMIT_DEFINITION, execute: commitDraft },
];
