/**
 * SGF URL 编码测试
 * @description 重点验证与 replay 页解码器 decodeURIComponent(escape(atob(sgf))) 的兼容性
 */
import { describe, it, expect } from 'vitest';
import { encodeSgfForUrl } from '../encodeSgfForUrl';

/** replay 页面真实使用的解码逻辑（clients/web/replay/index.ts） */
function decodeLikeReplay(base64Str: string): string {
  return decodeURIComponent(escape(atob(base64Str)));
}

describe('encodeSgfForUrl', () => {
  it('纯 ASCII SGF 可被 replay 解码器还原', () => {
    const sgf = '(;GM[1]FF[4]SZ[19]AB[pd]AW[dp];B[pp];W[dd])';
    expect(decodeLikeReplay(encodeSgfForUrl(sgf))).toBe(sgf);
  });

  it('含中文注释的 SGF 还原无损（btoa 直接编码会抛错的场景）', () => {
    const sgf = '(;GM[1]C[死活题·黑先做活]AB[pd][qf]AW[dp];B[pp]C[正解手])';
    expect(decodeLikeReplay(encodeSgfForUrl(sgf))).toBe(sgf);
  });

  it('含 emoji / 日文 / 特殊符号的 SGF 还原无损', () => {
    const sgf = '(;C[🧩 囲碁・問題 <tag> & "quote" \'x\' %]AB[aa];B[jj])';
    expect(decodeLikeReplay(encodeSgfForUrl(sgf))).toBe(sgf);
  });

  it('对含中文的 SGF，btoa 直传会失败，而本函数不会', () => {
    const sgf = '(;C[中文])';
    expect(() => btoa(sgf)).toThrow();
    expect(() => encodeSgfForUrl(sgf)).not.toThrow();
  });

  it('长 SGF（超过分块阈值）同样可还原', () => {
    const moves = Array.from({ length: 20000 }, (_, i) => `;B[${'a'.repeat(2)}]C[步${i}]`).join('');
    const sgf = `(;GM[1]SZ[19]${moves})`;
    expect(encodeSgfForUrl(sgf).length).toBeGreaterThan(0x8000);
    expect(decodeLIKE_SAFE(sgf)).toBe(sgf);
  });

  it('空串也能编码/还原', () => {
    expect(decodeLikeReplay(encodeSgfForUrl(''))).toBe('');
  });

  it('编码结果只含 base64 合法字符', () => {
    const encoded = encodeSgfForUrl('(;C[中文 abc 123+/=])');
    expect(encoded).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
  });
});

/** 长串用 Buffer 解码，避免 escape 在超长串上的性能问题 */
function decodeLIKE_SAFE(sgf: string): string {
  return new TextDecoder().decode(Buffer.from(encodeSgfForUrl(sgf), 'base64'));
}
