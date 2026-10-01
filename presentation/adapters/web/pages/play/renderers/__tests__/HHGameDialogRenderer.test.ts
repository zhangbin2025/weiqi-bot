/**
 * @fileoverview HHGameDialogRenderer 单元测试
 *
 * 重点验证 countMovesFromSGF 使用 domain/sgf 接口后，
 * 不再误匹配 AB[]/PB[]/TB[] 等非着法属性。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DOM
const mockContainer = {
  innerHTML: '',
} as unknown as HTMLElement;

import { HHGameDialogRenderer } from '../HHGameDialogRenderer';

describe('HHGameDialogRenderer', () => {
  let renderer: HHGameDialogRenderer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer.innerHTML = '';
    renderer = new HHGameDialogRenderer(mockContainer);
  });

  describe('showDraftRecoveryDialog', () => {
    it('应正确显示普通 SGF 的手数', () => {
      const draft = {
        sgf: '(;GM[1]FF[4]SZ[19]PB[黑]PW[白];B[pd];W[dp];B[pp];W[dd])',
        roomId: 'room1',
        myName: '玩家1',
        myColor: 'black' as const,
      };
      renderer.showDraftRecoveryDialog(draft, () => {}, () => {});
      expect(mockContainer.innerHTML).toContain('4 手');
    });

    it('含让子 AB[] 时不应误计为着法', () => {
      const draft = {
        sgf: '(;GM[1]FF[4]SZ[19]PB[黑]PW[白]HA[2]AB[dd][pp];W[jj];B[qq])',
        roomId: 'room2',
        myName: '玩家2',
        myColor: 'white' as const,
      };
      renderer.showDraftRecoveryDialog(draft, () => {}, () => {});
      // AB[dd][pp] 是让子，不是着法；只有 W[jj] B[qq] = 2 手
      expect(mockContainer.innerHTML).toContain('2 手');
    });

    it('含 PB[] PW[] 属性时不应误计', () => {
      const draft = {
        sgf: '(;GM[1]FF[4]SZ[19]PB[黑棋选手]PW[白棋选手];B[aa];W[bb])',
        roomId: 'room3',
        myName: '玩家3',
        myColor: 'black' as const,
      };
      renderer.showDraftRecoveryDialog(draft, () => {}, () => {});
      // 旧正则 B[ 会匹配 PB[ 和 B[，导致手数偏大
      // domain parser 正确区分属性和着法
      expect(mockContainer.innerHTML).toContain('2 手');
    });

    it('空 SGF 应显示 0 手', () => {
      const draft = {
        sgf: '',
        roomId: 'room4',
        myName: '玩家4',
        myColor: 'black' as const,
      };
      renderer.showDraftRecoveryDialog(draft, () => {}, () => {});
      expect(mockContainer.innerHTML).toContain('0 手');
    });

    it('含 Pass 着法应正确统计', () => {
      const draft = {
        sgf: '(;GM[1]FF[4]SZ[19]PB[黑]PW[白];B[pd];W[dp];B[];W[pp])',
        roomId: 'room5',
        myName: '玩家5',
        myColor: 'black' as const,
      };
      renderer.showDraftRecoveryDialog(draft, () => {}, () => {});
      expect(mockContainer.innerHTML).toContain('4 手');
    });
  });
});
