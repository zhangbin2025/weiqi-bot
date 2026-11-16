/**
 * 对阵表编辑弹框（图片导入赛事）
 * @module presentation/adapters/web/pages/assistant/EventTableDialog
 *
 * 目的：LLM 从图片读出的**全量**对阵数据不再靠自然语言复述（必然丢三落四），
 * 而是直接渲染宿主内存里的结构化草稿，用户逐格核对 / 修改。点「导入」把编辑结果
 * 经 applyTableEdits 回写草稿，再回调宿主发一条确认消息；LLM 在新一轮里调
 * event_commit_draft 写库，读到的就是改过的版本。
 *
 * 边界：
 * - 全程 createElement + value/textContent，绝不把模型读出的姓名交给 innerHTML。
 * - 不自造校验规则：编辑结果统一交给 validateEventDraft（applyTableEdits 内部调用），
 *   失败时把它的 errors 原样展示，用户改完可原地重试，草稿不被写坏。
 * - 不写库、不推进确认闸门：那两件事分别由 event_commit_draft 与 ChatUseCase.send 负责。
 * - 样式全部内联，不依赖 assistant.css，避免改动共享样式表。
 */

import {
  getTableDraft,
  applyTableEdits,
} from '../../../../../application/skill/primitives/EventImportPrimitives';
import type { EventDraftInput } from '../../../../../services/event/EventDraft';

const OVERLAY_ID = 'eventTableDialogOverlay';

/** 一行的可编辑输入引用；删除时从 rows 移除并删掉对应 tr */
interface Row {
  tr: HTMLTableRowElement;
  table: HTMLInputElement;
  p1Name: HTMLInputElement;
  p1Score: HTMLInputElement;
  p2Name: HTMLInputElement;
  p2Score: HTMLInputElement;
}

type MatchSeed = EventDraftInput['matches'][number];

const INPUT_CSS =
  'width: 100%; box-sizing: border-box; padding: 5px 6px; border: 1px solid #d9d6f5;' +
  ' border-radius: 6px; font-size: 13px; color: #333; background: #fff;';

const BTN_CSS =
  'padding: 8px 18px; border: none; border-radius: 8px; font-size: 14px; cursor: pointer;';

function makeOverlay(): { overlay: HTMLDivElement; card: HTMLDivElement } {
  // 重复点链接时先清掉上一个，避免叠两层遮罩
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 2000;' +
    ' display: flex; justify-content: center; align-items: center; padding: 16px; box-sizing: border-box;';

  const card = document.createElement('div');
  card.style.cssText =
    'background: #fff; border-radius: 12px; width: 100%; max-width: 720px;' +
    ' max-height: 88vh; display: flex; flex-direction: column; overflow: hidden;' +
    ' box-shadow: 0 12px 40px rgba(0,0,0,.28);';
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  return { overlay, card };
}

/** 草稿失效（刷新 / 切会话后 token 不在内存里）时的轻量提示 */
function showInvalidDraft(overlay: HTMLDivElement, card: HTMLDivElement): void {
  const box = document.createElement('div');
  box.style.cssText = 'padding: 22px; font-size: 14px; line-height: 1.6; color: #4a466e;';
  box.textContent =
    '这份对阵表草稿已失效（页面刷新或切换会话后草稿不会保留）。请让模型重新从图片整理一次对阵表。';
  const btn = document.createElement('button');
  btn.textContent = '关闭';
  btn.style.cssText = `${BTN_CSS} margin-top: 18px; background: #ecebff; color: #4a466e;`;
  btn.addEventListener('click', () => overlay.remove());
  box.appendChild(btn);
  card.appendChild(box);
}

/** 建一个带 label 的输入并直接挂到 parent，返回 input 本体 */
function makeLabeledInput(
  parent: HTMLElement,
  label: string,
  value: string | number,
  type: 'text' | 'number',
  step: string,
): HTMLInputElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #666; flex: 1;';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.step = step;
  input.value = String(value);
  input.style.cssText = INPUT_CSS;
  wrap.append(span, input);
  parent.appendChild(wrap);
  return input;
}

function makeCellInput(value: string | number, type: 'text' | 'number', step: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  input.step = step;
  input.value = String(value);
  input.style.cssText = INPUT_CSS + ' min-width: 72px;';
  return input;
}

/**
 * 打开弹框。
 * @param token 从 `event-table:<token>` 链接里取出的草稿令牌
 * @param onImport 校验通过并回写草稿后的回调（宿主用它发确认消息触发 LLM 写库）
 */
export function openEventTableDialog(token: string, onImport: () => void): void {
  const draft = getTableDraft(token);
  const { overlay, card } = makeOverlay();
  if (!draft) {
    showInvalidDraft(overlay, card);
    return;
  }

  // ---- 头部 ----
  const head = document.createElement('div');
  head.style.cssText = 'padding: 16px 18px 10px; border-bottom: 1px solid #eee;';
  const title = document.createElement('h3');
  title.textContent = '核对对阵表';
  title.style.cssText = 'margin: 0 0 4px; font-size: 17px; color: #333;';
  const sub = document.createElement('p');
  sub.textContent =
    '下面是模型从图片读出的全部场次。表上的分数是截至本轮的累计积分（大分），不是本轮胜负。' +
    '请逐格核对 / 修改，确认无误后点「导入」。';
  sub.style.cssText = 'margin: 0; font-size: 12px; line-height: 1.5; color: #888;';
  head.append(title, sub);
  card.appendChild(head);

  // ---- 赛事字段 ----
  const fields = document.createElement('div');
  fields.style.cssText = 'display: flex; gap: 10px; padding: 12px 18px; flex-wrap: wrap;';
  const titleInput = makeLabeledInput(fields, '比赛名称', draft.title, 'text', '');
  const groupInput = makeLabeledInput(fields, '分组', draft.groupName ?? '', 'text', '');
  const roundInput = makeLabeledInput(fields, '轮次', draft.round, 'number', '1');
  card.appendChild(fields);

  // ---- 表格（横向可滚，竖向跟随卡片内部滚动）----
  const scroll = document.createElement('div');
  scroll.style.cssText = 'flex: 1; overflow: auto; padding: 0 18px;';
  const table = document.createElement('table');
  table.style.cssText = 'width: 100%; border-collapse: collapse; min-width: 560px; font-size: 13px;';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['台号', '黑方姓名', '黑方累计分', '白方姓名', '白方累计分', '操作']) {
    const th = document.createElement('th');
    th.textContent = label;
    th.style.cssText =
      'position: sticky; top: 0; background: #f3f2ff; color: #5b4b9e; font-weight: 600;' +
      ' padding: 8px 6px; text-align: left; border-bottom: 1px solid #e3e0f3; white-space: nowrap;';
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  scroll.appendChild(table);
  card.appendChild(scroll);

  const rows: Row[] = [];

  const addRow = (seed?: MatchSeed): void => {
    const tr = document.createElement('tr');
    const cells = [
      makeCellInput(seed?.table ?? rows.length + 1, 'number', '1'),
      makeCellInput(seed?.p1Name ?? '', 'text', ''),
      makeCellInput(seed?.p1Score ?? 0, 'number', 'any'),
      makeCellInput(seed?.p2Name ?? '', 'text', ''),
      makeCellInput(seed?.p2Score ?? 0, 'number', 'any'),
    ];
    for (const input of cells) {
      const td = document.createElement('td');
      td.style.cssText = 'padding: 4px 6px; border-bottom: 1px solid #f0eef8;';
      td.appendChild(input);
      tr.appendChild(td);
    }
    const opTd = document.createElement('td');
    opTd.style.cssText = 'padding: 4px 6px; border-bottom: 1px solid #f0eef8;';
    const del = document.createElement('button');
    del.textContent = '删除';
    del.style.cssText = 'border: none; background: none; color: #d34a4a; cursor: pointer; font-size: 12px;';
    const row: Row = {
      tr,
      table: cells[0]!, p1Name: cells[1]!, p1Score: cells[2]!,
      p2Name: cells[3]!, p2Score: cells[4]!,
    };
    del.addEventListener('click', () => {
      const idx = rows.indexOf(row);
      if (idx >= 0) rows.splice(idx, 1);
      tr.remove();
    });
    opTd.appendChild(del);
    tr.appendChild(opTd);
    tbody.appendChild(tr);
    rows.push(row);
  };

  for (const m of draft.matches) addRow(m);

  // ---- 添加行 / 错误区 ----
  const toolRow = document.createElement('div');
  toolRow.style.cssText = 'padding: 10px 18px 0;';
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ 添加一场';
  addBtn.style.cssText = `${BTN_CSS} background: #f3f2ff; color: #5b4b9e; padding: 6px 12px; font-size: 13px;`;
  addBtn.addEventListener('click', () => addRow());
  toolRow.appendChild(addBtn);

  const errorBox = document.createElement('div');
  errorBox.style.cssText =
    'display: none; margin-top: 10px; padding: 8px 10px; border-radius: 8px;' +
    ' background: #fff1f1; border: 1px solid #f0d4d4; color: #b03030;' +
    ' font-size: 12px; white-space: pre-line; line-height: 1.5;';
  toolRow.appendChild(errorBox);
  card.appendChild(toolRow);

  // ---- 底部按钮 ----
  const footer = document.createElement('div');
  footer.style.cssText =
    'display: flex; justify-content: flex-end; gap: 10px; padding: 14px 18px; border-top: 1px solid #eee;';
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.style.cssText = `${BTN_CSS} background: #f0f0f0; color: #333;`;
  cancel.addEventListener('click', () => overlay.remove());

  const confirm = document.createElement('button');
  confirm.textContent = '导入';
  confirm.style.cssText =
    `${BTN_CSS} background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; font-weight: 600;`;
  confirm.addEventListener('click', () => {
    const edited: EventDraftInput = {
      title: titleInput.value,
      groupName: groupInput.value,
      round: Number(roundInput.value),
      matches: rows.map((r) => ({
        table: Number(r.table.value),
        p1Name: r.p1Name.value,
        p1Score: Number(r.p1Score.value),
        p2Name: r.p2Name.value,
        p2Score: Number(r.p2Score.value),
      })),
    };
    const result = applyTableEdits(token, edited);
    if (!result.ok) {
      // 错误来自 validateEventDraft，原样展示；草稿没被覆盖，用户可原地改
      errorBox.textContent = `无法导入，请先修正：\n${result.errors.join('\n')}`;
      errorBox.style.display = 'block';
      return;
    }
    overlay.remove();
    onImport();
  });
  footer.append(cancel, confirm);
  card.appendChild(footer);
}
