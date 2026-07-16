/**
 * Web Audio API 音效播放器实现
 * @module infrastructure/audio/WebAudioPlayer
 */

import type { IAudioPlayer, SoundType } from './IAudioPlayer';

/**
 * 基于 Web Audio API 的音效播放器
 * 参考 demo 使用噪声缓冲区 + 滤波器合成音效
 * 
 * 修复：懒初始化 AudioContext，避免在用户手势前创建
 */
export class WebAudioPlayer implements IAudioPlayer {
  private audioContext: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.5;

  /**
   * 初始化 AudioContext（需要在用户手势中调用）
   */
  async initialize(): Promise<void> {
    if (this.audioContext) return;
    
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    } catch (e) {
      // 创建失败，静默处理
    }
  }

  /**
   * 获取或创建 AudioContext（懒初始化）
   */
  private async getContext(): Promise<AudioContext | null> {
    // 如果已经有 AudioContext，直接返回
    if (this.audioContext) {
      // 确保状态不是 suspended
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch (e) {
          return null;
        }
      }
      return this.audioContext;
    }

    // 尝试创建 AudioContext
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch (e) {
          // 静默处理
        }
      }
    } catch (e) {
      return null;
    }

    return this.audioContext;
  }

  /**
   * 创建噪声缓冲区
   */
  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * 播放指定类型的音效
   */
  async play(type: SoundType): Promise<void> {
    if (this.muted) return;

    const ctx = await this.getContext();
    if (!ctx) {
      // AudioContext 不可用
      return;
    }
    
    // 确保噪声缓冲区已创建
    const noiseBuffer = this.createNoiseBuffer(ctx);

    switch (type) {
      case 'stone':
        this.playStoneSound(ctx, noiseBuffer);
        break;
      case 'capture':
        this.playCaptureSound(ctx, noiseBuffer);
        break;
      case 'pass':
        this.playPassSound(ctx);
        break;
      case 'error':
        this.playErrorSound(ctx);
        break;
      case 'correct':
        this.playCorrectSound(ctx);
        break;
      case 'wrong':
        this.playWrongSound(ctx);
        break;
    }
  }

  /**
   * 落子音效 - 使用噪声 + bandpass 滤波器
   */
  private playStoneSound(ctx: AudioContext, noiseBuffer: AudioBuffer): void {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 1;
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.volume * 0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.06);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.06);
  }

  /**
   * 提子音效 - 更短促、频率稍高
   */
  private playCaptureSound(ctx: AudioContext, noiseBuffer: AudioBuffer): void {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.5;
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.volume * 0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.04);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.04);
  }

  /**
   * 停一手音效 - 双音
   */
  private playPassSound(ctx: AudioContext): void {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(500, ctx.currentTime);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(700, ctx.currentTime);

    gain.gain.setValueAtTime(this.volume * 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.15);
  }

  /**
   * 错误音效 - 刺耳的噪音
   */
  private playErrorSound(ctx: AudioContext): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, ctx.currentTime);

    gain.gain.setValueAtTime(this.volume * 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  }

  /**
   * 正确音效 - 悦耳的上升双音
   */
  private playCorrectSound(ctx: AudioContext): void {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(600, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(800, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(this.volume * 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.2);
    osc2.stop(ctx.currentTime + 0.2);
  }

  /**
   * 错误答案音效 - 低沉的下降双音
   */
  private playWrongSound(ctx: AudioContext): void {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(400, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(300, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(this.volume * 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.3);
    osc2.stop(ctx.currentTime + 0.3);
  }

  /**
   * 设置静音状态
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /**
   * 获取静音状态
   */
  isMuted(): boolean {
    return this.muted;
  }

  /**
   * 设置音量 (0-1)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * 获取音量
   */
  getVolume(): number {
    return this.volume;
  }
}
