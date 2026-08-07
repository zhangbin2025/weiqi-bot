/**
 * @fileoverview 房间对话框渲染器 - 渲染房间相关对话框
 * @description 负责渲染开始、创建、加入、确认加入等对话框
 */
import { Select } from '@ui';
/**
 * 房间对话框渲染器
 * @description 封装房间相关对话框的 HTML 渲染逻辑
 */
export class HHRoomDialogRenderer {
  private container: HTMLElement;
  constructor(container: HTMLElement) {
    this.container = container;
  }
  /**
   * 生成随机名称
   */
  private generateRandomName(): string {
    const p = ['天','地','风','云','雷','电','山','水','星','月','龙','虎','鹰','狼','狐','熊','鹏','麟','鹤','雀'];
    const s = ['弈','棋','客','士','仙','圣','王','君','子','灵','影','魂','心','剑','刃'];
    return (p[Math.floor(Math.random() * p.length)] ?? '天') + (s[Math.floor(Math.random() * s.length)] ?? '弈');
  }
  /**
   * 显示开始对话框
   */
  showStartDialog(onCreate: () => void, onJoin: () => void): void {
    this.container.innerHTML = `
      <div class="dialog-overlay show">
        <div class="dialog">
          <div class="dialog-title">真人对弈</div>
          <button class="btn btn-primary" id="createRoomBtn">创建房间</button>
          <button class="btn btn-secondary" id="joinRoomBtn">加入房间</button>
        </div>
      </div>
    `;
    document.getElementById('createRoomBtn')?.addEventListener('click', onCreate);
    document.getElementById('joinRoomBtn')?.addEventListener('click', onJoin);
  }
  /**
   * 显示创建房间对话框
   */
  showCreateDialog(
    defaultName: string,
    onConfirm: (name: string, color: 'black' | 'white' | 'random', handicap: number, timeLimit: number) => void,
    onCancel: () => void
  ): void {
    this.container.innerHTML = `
      <div class="dialog-overlay show" id="createOverlay">
        <div class="dialog">
          <div class="dialog-title">创建房间</div>
          <div class="form-group">
            <label>你的名称</label>
            <div class="form-row">
              <input type="text" id="createName" value="${defaultName}">
              <button class="btn-small" id="randomNameBtn">随机</button>
            </div>
          </div>
          <div class="form-group">
            <label>执棋</label>
            <div class="radio-group">
              <input type="radio" name="color" id="cB" value="black" checked><label for="cB">执黑</label>
              <input type="radio" name="color" id="cW" value="white"><label for="cW">执白</label>
              <input type="radio" name="color" id="cR" value="random"><label for="cR">猜先</label>
            </div>
          </div>
          <div class="form-group">
            <label>让子</label>
            <div data-ui="select" id="handicap"
                 data-value="0"
                 data-options='[{"value":"0","label":"不让子"},{"value":"2","label":"2 子"},{"value":"3","label":"3 子"},{"value":"4","label":"4 子"},{"value":"5","label":"5 子"},{"value":"6","label":"6 子"},{"value":"7","label":"7 子"},{"value":"8","label":"8 子"},{"value":"9","label":"9 子"}]'></div>
          </div>
          <div class="form-group">
            <label>每方用时</label>
            <div data-ui="select" id="timeLimit"
                 data-value="30"
                 data-options='[{"value":"5","label":"5 分钟"},{"value":"10","label":"10 分钟"},{"value":"30","label":"30 分钟"},{"value":"60","label":"60 分钟"}]'></div>
          </div>
          <div class="btn-group">
            <button class="btn btn-primary" id="confirmCreateBtn">创建</button>
            <button class="btn btn-secondary" id="cancelCreateBtn">取消</button>
          </div>
        </div>
      </div>
    `;
    // 挂载自定义下拉框
    Select.mountAll(this.container);
    document.getElementById('createOverlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) onCancel();
    });
    document.getElementById('randomNameBtn')?.addEventListener('click', () => {
      const input = document.getElementById('createName') as HTMLInputElement;
      if (input) input.value = this.generateRandomName();
    });
    document.getElementById('confirmCreateBtn')?.addEventListener('click', () => {
      const name = (document.getElementById('createName') as HTMLInputElement)?.value || this.generateRandomName();
      const color = (document.querySelector('input[name="color"]:checked') as HTMLInputElement)?.value as 'black' | 'white' | 'random';
      const handicap = parseInt(Select.get('#handicap')?.getValue() || '0');
      const timeLimit = parseInt(Select.get('#timeLimit')?.getValue() || '30');
      onConfirm(name, color, handicap, timeLimit);
    });
    document.getElementById('cancelCreateBtn')?.addEventListener('click', onCancel);
  }
  /**
   * 显示加入房间对话框
   */
  showJoinDialog(
    defaultName: string,
    onConfirm: (roomId: string, name: string) => void,
    onCancel: () => void
  ): void {
    this.container.innerHTML = `
      <div class="dialog-overlay show" id="joinOverlay">
        <div class="dialog">
          <div class="dialog-title">加入房间</div>
          <div class="form-group">
            <label>房间ID</label>
            <input type="text" id="joinRoomId" placeholder="输入6位房间ID" style="text-transform:uppercase">
          </div>
          <div class="form-group">
            <label>你的名称</label>
            <div class="form-row">
              <input type="text" id="joinName" value="${defaultName}">
              <button class="btn-small" id="randomJoinNameBtn">随机</button>
            </div>
          </div>
          <div class="btn-group">
            <button class="btn btn-primary" id="confirmJoinBtn">加入</button>
            <button class="btn btn-secondary" id="cancelJoinBtn">取消</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('joinOverlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) onCancel();
    });
    document.getElementById('randomJoinNameBtn')?.addEventListener('click', () => {
      const input = document.getElementById('joinName') as HTMLInputElement;
      if (input) input.value = this.generateRandomName();
    });
    document.getElementById('confirmJoinBtn')?.addEventListener('click', () => {
      const roomId = (document.getElementById('joinRoomId') as HTMLInputElement)?.value.trim().toUpperCase();
      const name = (document.getElementById('joinName') as HTMLInputElement)?.value.trim() || this.generateRandomName();
      onConfirm(roomId, name);
    });
    document.getElementById('cancelJoinBtn')?.addEventListener('click', onCancel);
  }
  /**
   * 显示加入确认对话框
   */
  showJoinConfirmDialog(
    roomInfo: {
      creatorName: string;
      creatorColor: 'black' | 'white';
      handicap: number;
      timeLimit: number;
    },
    defaultName: string,
    onConfirm: (name: string) => void,
    onCancel: () => void
  ): void {
    const opponentColor = roomInfo.creatorColor;
    const myColorText = opponentColor === 'black' ? '你执白' : '你执黑';
    const handicapText = roomInfo.handicap === 0 ? '不让子' : `让 ${roomInfo.handicap} 子`;
    this.container.innerHTML = `
      <div class="dialog-overlay show" id="confirmOverlay">
        <div class="dialog">
          <div class="dialog-title">加入确认</div>
          <div style="margin-bottom:12px">
            <div style="font-size:13px;color:#666">对手</div>
            <div style="font-size:16px;font-weight:500">${roomInfo.creatorName}</div>
          </div>
          <div class="form-group">
            <label>你的名称</label>
            <div class="form-row">
              <input type="text" id="confirmName" value="${defaultName}">
              <button class="btn-small" id="randomConfirmNameBtn">随机</button>
            </div>
          </div>
          <div style="margin-bottom:12px">
            <div style="font-size:13px;color:#666;margin-bottom:8px">对局条件</div>
            <ul class="condition-list">
              <li>${myColorText}</li>
              <li>${handicapText}</li>
              <li>每方 ${roomInfo.timeLimit} 分钟</li>
            </ul>
          </div>
          <button class="btn btn-primary" id="confirmJoinBtn">确认加入</button>
          <button class="btn btn-secondary" id="cancelJoinBtn">取消</button>
        </div>
      </div>
    `;
    document.getElementById('confirmOverlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) onCancel();
    });
    document.getElementById('randomConfirmNameBtn')?.addEventListener('click', () => {
      const input = document.getElementById('confirmName') as HTMLInputElement;
      if (input) input.value = this.generateRandomName();
    });
    document.getElementById('confirmJoinBtn')?.addEventListener('click', () => {
      const name = (document.getElementById('confirmName') as HTMLInputElement)?.value.trim() || this.generateRandomName();
      onConfirm(name);
    });
    document.getElementById('cancelJoinBtn')?.addEventListener('click', onCancel);
  }
}
