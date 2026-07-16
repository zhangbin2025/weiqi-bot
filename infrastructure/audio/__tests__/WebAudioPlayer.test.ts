/**
 * WebAudioPlayer 单元测试
 * 
 * 注意：Web Audio API 的 mock 非常复杂，且测试价值低。
 * 这里只测试公共 API（音量控制、静音等），不测试具体的音频播放。
 * 音频播放应该在真实浏览器环境中测试（E2E 测试）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebAudioPlayer } from '../WebAudioPlayer';

describe('WebAudioPlayer', () => {
  let player: WebAudioPlayer;

  beforeEach(() => {
    // 创建 WebAudioPlayer 实例
    // 不 mock AudioContext，因为音频播放测试应该在浏览器环境中进行
    player = new WebAudioPlayer();
  });

  describe('volume control', () => {
    it('should have default volume of 0.5', () => {
      expect(player.getVolume()).toBe(0.5);
    });

    it('should set volume within 0-1 range', () => {
      player.setVolume(0.8);
      expect(player.getVolume()).toBe(0.8);
    });

    it('should clamp volume to 0-1 range', () => {
      player.setVolume(1.5);
      expect(player.getVolume()).toBe(1);

      player.setVolume(-0.5);
      expect(player.getVolume()).toBe(0);
    });
  });

  describe('mute control', () => {
    it('should not be muted by default', () => {
      expect(player.isMuted()).toBe(false);
    });

    it('should set mute state', () => {
      player.setMuted(true);
      expect(player.isMuted()).toBe(true);

      player.setMuted(false);
      expect(player.isMuted()).toBe(false);
    });
  });

  describe('play', () => {
    it('should not throw when muted', async () => {
      player.setMuted(true);
      // 静音时播放不应该抛出错误
      await expect(player.play('stone')).resolves.not.toThrow();
    });

    it('should not throw when playing different sound types', async () => {
      // 测试各种声音类型不会抛出错误
      // 在测试环境中，AudioContext 可能不可用，但不应该抛出错误
      await expect(player.play('stone')).resolves.not.toThrow();
      await expect(player.play('capture')).resolves.not.toThrow();
      await expect(player.play('pass')).resolves.not.toThrow();
      await expect(player.play('error')).resolves.not.toThrow();
    });
  });
});
