import { describe, it, beforeEach, expect, vi } from 'vitest';
import { CapturedController } from '../CapturedController';
describe('CapturedController', () => {
  let ctrl: CapturedController;
  let onChange: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onChange = vi.fn();
    ctrl = new CapturedController({ onChange });
  });
  it('should start with zero captures', () => {
    expect(ctrl.getBlackCaptured()).toBe(0);
    expect(ctrl.getWhiteCaptured()).toBe(0);
  });
  it('getCaptured() should return both counts', () => {
    ctrl.setCaptured(5, 3);
    const captured = ctrl.getCaptured();
    expect(captured.black).toBe(5);
    expect(captured.white).toBe(3);
  });
  it('setCaptured() should update both counts', () => {
    ctrl.setCaptured(10, 8);
    expect(ctrl.getBlackCaptured()).toBe(10);
    expect(ctrl.getWhiteCaptured()).toBe(8);
  });
  it('setCaptured() should call onChange callback', () => {
    ctrl.setCaptured(5, 3);
    expect(onChange.mock.calls.length).toBe(1);
    expect(onChange.mock.calls[0][0]).toBe(5);
    expect(onChange.mock.calls[0][1]).toBe(3);
  });
  it('addBlackCaptured() should increment black captures', () => {
    ctrl.addBlackCaptured(3);
    expect(ctrl.getBlackCaptured()).toBe(3);
  });
  it('addBlackCaptured() should default to increment by 1', () => {
    ctrl.addBlackCaptured();
    expect(ctrl.getBlackCaptured()).toBe(1);
  });
  it('addWhiteCaptured() should increment white captures', () => {
    ctrl.addWhiteCaptured(2);
    expect(ctrl.getWhiteCaptured()).toBe(2);
  });
  it('addWhiteCaptured() should default to increment by 1', () => {
    ctrl.addWhiteCaptured();
    expect(ctrl.getWhiteCaptured()).toBe(1);
  });
  it('addBlackCaptured() should call onChange', () => {
    ctrl.addBlackCaptured(2);
    expect(onChange.mock.calls.length).toBe(1);
  });
  it('addWhiteCaptured() should call onChange', () => {
    ctrl.addWhiteCaptured(2);
    expect(onChange.mock.calls.length).toBe(1);
  });
  it('reset() should set both counts to zero', () => {
    ctrl.setCaptured(10, 8);
    ctrl.reset();
    expect(ctrl.getBlackCaptured()).toBe(0);
    expect(ctrl.getWhiteCaptured()).toBe(0);
  });
  it('reset() should call onChange callback', () => {
    ctrl.setCaptured(5, 3);
    onChange.mockClear();
    ctrl.reset();
    expect(onChange.mock.calls.length).toBe(1);
    expect(onChange.mock.calls[0][0]).toBe(0);
    expect(onChange.mock.calls[0][1]).toBe(0);
  });
  it('should work without onChange callback', () => {
    const ctrl2 = new CapturedController();
    ctrl2.setCaptured(5, 3);
    expect(ctrl2.getBlackCaptured()).toBe(5);
    expect(ctrl2.getWhiteCaptured()).toBe(3);
  });
  it('should accumulate captures correctly', () => {
    ctrl.addBlackCaptured(2);
    ctrl.addBlackCaptured(3);
    ctrl.addWhiteCaptured(1);
    ctrl.addWhiteCaptured(4);
    expect(ctrl.getBlackCaptured()).toBe(5);
    expect(ctrl.getWhiteCaptured()).toBe(5);
  });
  it('should allow setting captures multiple times', () => {
    ctrl.setCaptured(10, 5);
    ctrl.setCaptured(3, 8);
    expect(ctrl.getBlackCaptured()).toBe(3);
    expect(ctrl.getWhiteCaptured()).toBe(8);
  });
  it('should handle zero values correctly', () => {
    ctrl.setCaptured(5, 5);
    ctrl.setCaptured(0, 0);
    expect(ctrl.getBlackCaptured()).toBe(0);
    expect(ctrl.getWhiteCaptured()).toBe(0);
  });
  it('should work with no config', () => {
    const ctrl2 = new CapturedController({});
    ctrl2.addBlackCaptured(1);
    expect(ctrl2.getBlackCaptured()).toBe(1);
  });
});
