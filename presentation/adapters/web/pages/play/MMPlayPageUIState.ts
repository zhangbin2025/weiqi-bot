/**
 * AI自对弈页面 UI 状态管理
 * @module presentation/pages/play/MMPlayPageUIState
 */
/**
 * UI 状态管理器
 * 负责管理草稿状态等
 */
export class MMPlayPageUIState {
  private hasDraft: boolean = false;  // 是否有未完成的对局草稿
  /** 是否有未完成的对局草稿 */
  hasDraftToRecover(): boolean {
    return this.hasDraft;
  }
  /** 设置是否有草稿 */
  setHasDraft(hasDraft: boolean): void {
    this.hasDraft = hasDraft;
  }
}
