import { describe, it, beforeEach, expect, vi } from 'vitest';
import { MoveNavigator } from '../MoveNavigator';
describe('MoveNavigator', () => {
  let navigator: MoveNavigator;
  let onChange: ReturnType<typeof vi.fn>;
  let onPlayStateChange: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onChange = vi.fn();
    onPlayStateChange = vi.fn();
    navigator = new MoveNavigator({
      maxMoves: 10,
      onMoveChange: onChange,
      onPlayStateChange,
    });
  });
  it('should initialize with currentIndex 0', () => {
    expect(navigator.getCurrentIndex()).toBe(0);
  });
  it('should initialize with correct maxMoves', () => {
    expect(navigator.getMaxMoves()).toBe(10);
  });
  it('prev() should decrement index when > 0', () => {
    navigator.goTo(5);
    navigator.prev();
    expect(navigator.getCurrentIndex()).toBe(4);
  });
  it('prev() should not decrement when index is 0', () => {
    navigator.prev();
    expect(navigator.getCurrentIndex()).toBe(0);
  });
  it('next() should increment index when < maxMoves', () => {
    navigator.next();
    expect(navigator.getCurrentIndex()).toBe(1);
  });
  it('next() should not increment when at maxMoves', () => {
    navigator.goTo(10);
    navigator.next();
    expect(navigator.getCurrentIndex()).toBe(10);
  });
  it('goTo() should set index within bounds', () => {
    navigator.goTo(5);
    expect(navigator.getCurrentIndex()).toBe(5);
  });
  it('goTo() should clamp to 0 for negative values', () => {
    navigator.goTo(-5);
    expect(navigator.getCurrentIndex()).toBe(0);
  });
  it('goTo() should clamp to maxMoves for large values', () => {
    navigator.goTo(100);
    expect(navigator.getCurrentIndex()).toBe(10);
  });
  it('goTo() should not call onMoveChange when same index', () => {
    const callCount = onChange.mock.calls.length;
    navigator.goTo(0);
    expect(onChange.mock.calls.length).toBe(callCount);
  });
  it('setMaxMoves() should update maxMoves', () => {
    navigator.setMaxMoves(20);
    expect(navigator.getMaxMoves()).toBe(20);
  });
  it('setMaxMoves() should clamp currentIndex if exceeding new max', () => {
    navigator.goTo(8);
    navigator.setMaxMoves(5);
    expect(navigator.getCurrentIndex()).toBe(5);
  });
  it('togglePlay() should start playing when stopped', () => {
    navigator.togglePlay();
    expect(navigator.getIsPlaying()).toBe(true);
    navigator.destroy();
  });
  it('togglePlay() should stop playing when playing', () => {
    navigator.togglePlay();
    navigator.togglePlay();
    expect(navigator.getIsPlaying()).toBe(false);
  });
  it('destroy() should stop playing', () => {
    navigator.togglePlay();
    navigator.destroy();
    expect(navigator.getIsPlaying()).toBe(false);
  });
});
