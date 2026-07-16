import { describe, it, beforeEach, expect, vi } from 'vitest';
import { TrialController, TrialMove } from '../TrialController';
describe('TrialController', () => {
  let ctrl: TrialController;
  let onEnter: ReturnType<typeof vi.fn>;
  let onExit: ReturnType<typeof vi.fn>;
  let onMoveChange: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onEnter = vi.fn();
    onExit = vi.fn();
    onMoveChange = vi.fn();
    ctrl = new TrialController({ onEnter, onExit, onMoveChange });
  });
  it('should start not in trial mode', () => {
    expect(ctrl.isInTrial()).toBe(false);
  });
  it('enterTrial() should activate trial mode', () => {
    ctrl.enterTrial([1, 2, 3], 5);
    expect(ctrl.isInTrial()).toBe(true);
    expect(onEnter.mock.calls.length).toBe(1);
  });
  it('enterTrial() should store start path and index', () => {
    ctrl.enterTrial([1, 2, 3], 5);
    expect(ctrl.getStartPath()).toEqual([1, 2, 3]);
    expect(ctrl.getStartIndex()).toBe(5);
  });
  it('enterTrial() should clear previous trial moves', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    ctrl.enterTrial([], 0);
    expect(ctrl.getTrialMoves().length).toBe(0);
  });
  it('addMove() should append move and increment index', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    expect(ctrl.getTrialMoves().length).toBe(1);
    expect(ctrl.getTrialIndex()).toBe(1);
  });
  it('addMove() should call onMoveChange callback', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    expect(onMoveChange.mock.calls.length).toBe(1);
  });
  it('undo() should decrement index when > 0', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    ctrl.addMove({ x: 4, y: 4, color: 'white' });
    ctrl.undo();
    expect(ctrl.getTrialIndex()).toBe(1);
  });
  it('undo() should not decrement when index is 0', () => {
    ctrl.enterTrial([], 0);
    ctrl.undo();
    expect(ctrl.getTrialIndex()).toBe(0);
  });
  it('redo() should increment index when < moves length', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    ctrl.addMove({ x: 4, y: 4, color: 'white' });
    ctrl.undo();
    ctrl.redo();
    expect(ctrl.getTrialIndex()).toBe(2);
  });
  it('redo() should not increment when at moves length', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    ctrl.redo();
    expect(ctrl.getTrialIndex()).toBe(1);
  });
  it('exitTrial() should return to start and deactivate', () => {
    ctrl.enterTrial([1, 2], 5);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    const result = ctrl.exitTrial();
    expect(ctrl.isInTrial()).toBe(false);
    expect(result.path).toEqual([1, 2]);
    expect(result.index).toBe(5);
    expect(onExit.mock.calls.length).toBe(1);
  });
  it('exitTrial() should clear trial moves', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    ctrl.exitTrial();
    expect(ctrl.getTrialMoves().length).toBe(0);
  });
  it('getVisibleMoves() should return moves up to trialIndex', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    ctrl.addMove({ x: 4, y: 4, color: 'white' });
    ctrl.undo();
    const visible = ctrl.getVisibleMoves();
    expect(visible.length).toBe(1);
    expect(visible[0].x).toBe(3);
  });
  it('ko position should work correctly', () => {
    ctrl.enterTrial([], 0);
    ctrl.setKoPosition({ x: 5, y: 5 });
    expect(ctrl.getKoPosition()).toEqual({ x: 5, y: 5 });
    expect(ctrl.isKoPosition(5, 5)).toBe(true);
    expect(ctrl.isKoPosition(5, 6)).toBe(false);
    ctrl.setKoPosition(null);
    expect(ctrl.getKoPosition()).toBe(null);
  });
  it('reset() should clear all state', () => {
    ctrl.enterTrial([1, 2], 5);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    ctrl.setKoPosition({ x: 5, y: 5 });
    ctrl.reset();
    expect(ctrl.isInTrial()).toBe(false);
    expect(ctrl.getTrialMoves().length).toBe(0);
    expect(ctrl.getKoPosition()).toBe(null);
  });
  it('addMove() should truncate future moves when adding after undo', () => {
    ctrl.enterTrial([], 0);
    ctrl.addMove({ x: 3, y: 3, color: 'black' });
    ctrl.addMove({ x: 4, y: 4, color: 'white' });
    ctrl.undo();
    ctrl.addMove({ x: 5, y: 5, color: 'black' });
    const moves = ctrl.getTrialMoves();
    expect(moves.length).toBe(2);
    expect(moves[1].x).toBe(5);
  });
});
