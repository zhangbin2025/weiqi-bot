/**
 * 音效播放器接口
 * @module infrastructure/audio/IAudioPlayer
 */

/**
 * 音效类型
 */
export type SoundType = 'stone' | 'capture' | 'pass' | 'error' | 'correct' | 'wrong' | 'undo';

/**
 * 音效播放器抽象接口
 */
export interface IAudioPlayer {
  /** 播放音效 */
  play(type: SoundType): Promise<void>;

  /** 设置静音 */
  setMuted(muted: boolean): void;

  /** 获取静音状态 */
  isMuted(): boolean;

  /** 设置音量 (0-1) */
  setVolume(volume: number): void;

  /** 获取音量 */
  getVolume(): number;

  /** 预加载音效 */
  preload?(): Promise<void>;
}
