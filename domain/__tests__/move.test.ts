import { describe, it, expect } from 'vitest';
import {
  createMove,
  createPassMove,
  isPass,
  getMoveCoordinate,
  MoveTree,
} from '../move';

describe('move module', () => {
  describe('createMove', () => {
    it('should create a move with correct properties', () => {
      const move = createMove(3, 3, 'black', 1);
      expect(move.x).toBe(3);
      expect(move.y).toBe(3);
      expect(move.color).toBe('black');
      expect(move.number).toBe(1);
    });
  });

  describe('createPassMove', () => {
    it('should create a pass move', () => {
      const pass = createPassMove('black', 1);
      expect(pass.color).toBe('black');
      expect(pass.number).toBe(1);
      expect(pass.isPass).toBe(true);
    });
  });

  describe('isPass', () => {
    it('should return true for pass move', () => {
      const pass = createPassMove('black', 1);
      expect(isPass(pass)).toBe(true);
    });
    it('should return false for regular move', () => {
      const move = createMove(3, 3, 'black', 1);
      expect(isPass(move)).toBe(false);
    });
  });

  describe('getMoveCoordinate', () => {
    it('should return coordinate for regular move', () => {
      const move = createMove(3, 3, 'black', 1);
      const coord = getMoveCoordinate(move);
      expect(coord?.x).toBe(3);
      expect(coord?.y).toBe(3);
    });
    it('should return null for pass move', () => {
      const pass = createPassMove('black', 1);
      expect(getMoveCoordinate(pass)).toBeNull();
    });
  });

  describe('MoveTree', () => {
    it('should create empty tree', () => {
      const tree = new MoveTree();
      expect(tree.root.children).toHaveLength(0);
    });

    it('should add moves to tree', () => {
      const tree = new MoveTree();
      const move = createMove(3, 3, 'black', 1);
      const path = tree.addMove([], move);
      expect(path).toHaveLength(1);
      expect(path[0]).toBe(0);
    });

    it('should get main branch', () => {
      const tree = new MoveTree();
      const move1 = createMove(3, 3, 'black', 1);
      const move2 = createMove(15, 15, 'white', 2);
      tree.addMove([], move1);
      tree.addMove([0], move2);
      const main = tree.getMainBranch();
      expect(main).toHaveLength(2);
    });

    it('should get node at path', () => {
      const tree = new MoveTree();
      const move = createMove(3, 3, 'black', 1);
      tree.addMove([], move);
      const node = tree.getNode([0]);
      expect(node?.move?.x).toBe(3);
    });

    it('should clone tree', () => {
      const tree = new MoveTree();
      const move = createMove(3, 3, 'black', 1);
      tree.addMove([], move);
      const cloned = tree.clone();
      expect(cloned.getMainBranch()).toHaveLength(1);
    });
  });
});