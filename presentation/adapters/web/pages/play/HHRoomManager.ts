/**
 * 真人对弈房间管理
 * @module presentation/pages/play/HHRoomManager
 */
import type { IDialog, IToast } from '../../../../core/interfaces';
import type { HHPlayApp } from '../../../../../application/play';
export interface RoomCreateResult {
  roomId: string;
  color: 'black' | 'white';
}
export class HHRoomManager {
  constructor(
    private hhPlayApp: HHPlayApp,
    private dialog: IDialog,
    private toast: IToast,
  ) {}
  async createRoom(): Promise<RoomCreateResult | null> {
    const name = await this.promptName();
    if (!name) return null;
    try {
      const roomInfo = await this.hhPlayApp.createRoom(name, {
        timeLimit: 0,
        signalingUrl: '',
        handicap: 0,
        soundEnabled: false,
      });
      this.toast.success(`房间已创建: ${roomInfo.id}`);
      return { roomId: roomInfo.id, color: roomInfo.creatorColor };
    } catch (error) {
      this.toast.error('创建房间失败');
      return null;
    }
  }
  async joinRoom(roomId: string): Promise<boolean> {
    const name = await this.promptName();
    if (!name) return false;
    try {
      await this.hhPlayApp.joinRoom(roomId, name);
      this.toast.success('已加入房间');
      return true;
    } catch (error) {
      this.toast.error('加入房间失败');
      return false;
    }
  }
  private async promptName(): Promise<string | null> {
    const result = await this.dialog.show({
      type: 'prompt',
      title: '输入昵称',
      content: '请输入你的昵称',
    });
    return result ? String(result) : null;
  }
}
