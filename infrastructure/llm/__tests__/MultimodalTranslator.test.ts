/**
 * 多模态 wire 形状契约（决策 3a：image_url + data URI，唯一收口点）。
 */
import { describe, it, expect } from 'vitest';
import { modelPartsToWire } from '../MultimodalTranslator';
import type { ModelPart } from '../../../application/model/IModelGateway';

describe('modelPartsToWire', () => {
  it('text 原样，image 变 image_url + data URI（内嵌 base64，不是远程 URL）', () => {
    const parts: ModelPart[] = [
      { type: 'text', text: '请看这张棋谱' },
      { type: 'image', uri: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', label: 'board.png' },
    ];
    expect(modelPartsToWire(parts)).toEqual([
      { type: 'text', text: '请看这张棋谱' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
    ]);
  });

  it('file(PDF) 变 file + file_data，filename 取 label', () => {
    const parts: ModelPart[] = [
      { type: 'file', uri: 'data:application/pdf;base64,JVBERi0x', mimeType: 'application/pdf', label: 'doc.pdf' },
    ];
    expect(modelPartsToWire(parts)).toEqual([
      { type: 'file', file: { file_data: 'data:application/pdf;base64,JVBERi0x', filename: 'doc.pdf' } },
    ]);
  });

  it('无 label 时给可读兜底名，未知形状降级成可见提示而不静默丢', () => {
    const parts = [
      { type: 'file', uri: 'data:application/pdf;base64,x' },
      { type: 'mystery', text: 'x' },
    ] as unknown as ModelPart[];
    const wire = modelPartsToWire(parts);
    expect(wire[0]).toEqual({
      type: 'file', file: { file_data: 'data:application/pdf;base64,x', filename: 'document.pdf' },
    });
    expect(wire[1]).toEqual({ type: 'text', text: '[未能发送的多模态片段:mystery]' });
  });
});
