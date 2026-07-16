import { describe, it, beforeEach, expect, vi } from 'vitest';
import { VariationController, Variation } from '../VariationController';
describe('VariationController', () => {
  let ctrl: VariationController;
  let onSelect: ReturnType<typeof vi.fn>;
  let onBackToParent: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onSelect = vi.fn();
    onBackToParent = vi.fn();
    ctrl = new VariationController({ onSelect, onBackToParent });
  });
  it('should start with empty variations', () => {
    expect(ctrl.hasVariations()).toBe(false);
    expect(ctrl.getVariations()).toEqual([]);
    expect(ctrl.getSelected()).toBe(null);
  });
  it('setVariations() should set the list and reset selection', () => {
    const vars: Variation[] = [
      { index: 1, label: '变化1', color: 'B' },
      { index: 2, label: '变化2', color: 'W' },
    ];
    ctrl.setVariations(vars);
    expect(ctrl.hasVariations()).toBe(true);
    expect(ctrl.getVariations().length).toBe(2);
  });
  it('select() should update selected and call onSelect', () => {
    const vars: Variation[] = [
      { index: 1, label: '变化1', color: 'B' },
      { index: 2, label: '变化2', color: 'W' },
    ];
    ctrl.setVariations(vars);
    ctrl.select(1);
    const selected = ctrl.getSelected();
    expect(selected);
    expect(selected!.label).toBe('变化2');
    expect(onSelect.mock.calls.length).toBe(1);
  });
  it('select() should ignore out-of-bounds index', () => {
    ctrl.setVariations([{ index: 1, label: '变化1', color: 'B' }]);
    ctrl.select(5);
    const selected = ctrl.getSelected();
    expect(selected);
    expect(selected!.label).toBe('变化1');
    expect(onSelect.mock.calls.length).toBe(0);
  });
  it('select() should ignore negative index', () => {
    ctrl.setVariations([{ index: 1, label: '变化1', color: 'B' }]);
    ctrl.select(-1);
    expect(onSelect.mock.calls.length).toBe(0);
  });
  it('backToParent() should call onBackToParent callback', () => {
    ctrl.backToParent();
    expect(onBackToParent.mock.calls.length).toBe(1);
  });
  it('setParentPath() and getParentPath() should work', () => {
    ctrl.setParentPath([1, 2, 3]);
    expect(ctrl.getParentPath()).toEqual([1, 2, 3]);
  });
  it('getParentPath() should return a copy', () => {
    ctrl.setParentPath([1, 2]);
    const path = ctrl.getParentPath();
    path.push(99);
    expect(ctrl.getParentPath()).toEqual([1, 2]);
  });
  it('clear() should reset all state', () => {
    ctrl.setVariations([{ index: 1, label: '变化1', color: 'B' }]);
    ctrl.setParentPath([1, 2]);
    ctrl.clear();
    expect(ctrl.hasVariations()).toBe(false);
    expect(ctrl.getParentPath()).toEqual([]);
  });
  it('reset() should reset selection only', () => {
    ctrl.setVariations([
      { index: 1, label: '变化1', color: 'B' },
      { index: 2, label: '变化2', color: 'W' },
    ]);
    ctrl.select(1);
    ctrl.reset();
    const selected = ctrl.getSelected();
    expect(selected);
    expect(selected!.label).toBe('变化1');
  });
  it('buildFromChildren() should skip first child (main branch)', () => {
    ctrl.buildFromChildren([
      { color: 'B' as const },
      { color: 'W' as const, properties: { N: '定式A' } },
      { color: 'B' as const },
    ]);
    expect(ctrl.getVariations().length).toBe(2);
    expect(ctrl.getVariations()[0].label).toBe('定式A');
  });
  it('buildFromChildren() should extract win rate from comment', () => {
    ctrl.buildFromChildren([
      { color: 'B' as const },
      { color: 'W' as const, properties: { C: 'jueyi黑53.2%' } },
    ]);
    expect(ctrl.getVariations()[0].label).toBe('黑 53.2%');
  });
  it('buildFromChildren() should use default label when no properties', () => {
    ctrl.buildFromChildren([
      { color: 'B' as const },
      { color: 'W' as const },
    ]);
    expect(ctrl.getVariations()[0].label).toBe('变化1');
  });
});
