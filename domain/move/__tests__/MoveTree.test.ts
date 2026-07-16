import { describe, it, expect } from 'vitest';
import { MoveTree } from '../MoveTree.js';
import { createMove, createPassMove, isPass } from '../IMove.js';

describe('MoveTree', () => {
  describe('构造和基本操作', () => {
    it('创建空树', () => {
      const tree = new MoveTree();
      expect(tree.root.move).toBe(null);
      expect(tree.root.children.length).toBe(0);
    });
  });

  describe('添加着法', () => {
    it('添加第一着法', () => {
      const tree = new MoveTree();
      const move = createMove(3, 3, 'black', 1);
      const path = tree.addMove([], move);
      expect(path.length).toBe(1);
      expect(path[0]).toBe(0);
    });
    it('添加第二着法', () => {
      const tree = new MoveTree();
      tree.addMove([], createMove(3, 3, 'black', 1));
      const move = createMove(15, 15, 'white', 2);
      const path = tree.addMove([0], move);
      expect(path.length).toBe(2);
      expect(path[1]).toBe(0);
    });
    it('添加变化分支', () => {
      const tree = new MoveTree();
      tree.addMove([], createMove(3, 3, 'black', 1));
      tree.addMove([0], createMove(15, 15, 'white', 2)); // 第一个分支
      const move = createMove(4, 4, 'white', 2); // 变化分支
      const path = tree.addMove([0], move);
      expect(path[1]).toBe(1); // 第二个分支
    });
  });

  describe('遍历树', () => {
    it('getNode返回正确节点', () => {
      const tree = new MoveTree();
      tree.addMove([], createMove(3, 3, 'black', 1));
      const node = tree.getNode([0]);
      expect(node !== null);
      expect(node!.move!.x).toBe(3);
    });
    it('getNode无效路径返回null', () => {
      const tree = new MoveTree();
      expect(tree.getNode([99])).toBe(null);
    });
    it('getMainBranch返回主分支', () => {
      const tree = new MoveTree();
      tree.addMove([], createMove(3, 3, 'black', 1));
      tree.addMove([0], createMove(15, 15, 'white', 2));
      tree.addMove([0, 0], createMove(4, 4, 'black', 3));
      const moves = tree.getMainBranch();
      expect(moves.length).toBe(3);
    });
  });

  describe('查找着法', () => {
    it('getMovesToPath返回路径着法', () => {
      const tree = new MoveTree();
      tree.addMove([], createMove(3, 3, 'black', 1));
      tree.addMove([0], createMove(15, 15, 'white', 2));
      const moves = tree.getMovesToPath([0, 0]);
      expect(moves.length).toBe(2);
    });
    it('空路径返回空数组', () => {
      const tree = new MoveTree();
      const moves = tree.getMovesToPath([]);
      expect(moves.length).toBe(0);
    });
  });

  describe('变化分支', () => {
    it('同一父节点多个分支', () => {
      const tree = new MoveTree();
      tree.addMove([], createMove(3, 3, 'black', 1));
      tree.addMove([0], createMove(15, 15, 'white', 2));
      tree.addMove([0], createMove(4, 4, 'white', 2));
      const node = tree.getNode([0]);
      expect(node!.children.length).toBe(2);
    });
  });

  describe('clone', () => {
    it('克隆后独立', () => {
      const tree = new MoveTree();
      tree.addMove([], createMove(3, 3, 'black', 1));
      const cloned = tree.clone();
      const node = cloned.getNode([0]);
      expect(node !== null);
      expect(node!.move!.x).toBe(3);
    });
    it('克隆不影响原树', () => {
      const tree = new MoveTree();
      tree.addMove([], createMove(3, 3, 'black', 1));
      const cloned = tree.clone();
      cloned.addMove([], createMove(15, 15, 'black', 1));
      expect(tree.root.children.length).toBe(1);
      expect(cloned.root.children.length).toBe(2);
    });
  });

  describe('pass处理', () => {
    it('添加pass着法', () => {
      const tree = new MoveTree();
      const pass = createPassMove('black', 1);
      tree.addMove([], pass);
      const node = tree.getNode([0]);
      expect(node !== null);
      expect(isPass(node!.move!));
    });
  });
});