/**
 * ChatRole 测试：角色表是唯一的扩展点，配置驱动而非措辞驱动。
 * 2026-11-24：plugin / skill-dev 合并为单一「开发」角色。
 */
import { describe, it, expect } from 'vitest';
import {
  CHAT_ROLES, DEFAULT_ROLE_ID, ROLE_STORAGE_KEY, ROLE_META_KEY,
  getRole, parseRoleId, type ChatRoleId,
} from '../ChatRole';

describe('CHAT_ROLES 角色表', () => {
  it('默认角色是闲聊，且闲聊完全不接触插件系统', () => {
    expect(DEFAULT_ROLE_ID).toBe('chat');
    const chat = getRole('chat');
    expect(chat.agent).toBe(false);
    expect(chat.skillDev).toBe(false);
    expect(chat.trace).toBe(false);
    expect(chat.label).toBe('闲聊');
  });

  it('「开发」角色同时启用插件工具集与技能开发工具集', () => {
    const dev = getRole('dev');
    expect(dev.agent).toBe(true);
    expect(dev.skillDev).toBe(true);
    expect(dev.trace).toBe(true);
    expect(dev.label).toBe('开发');
  });

  it('只有两个角色：闲聊 + 开发', () => {
    expect(CHAT_ROLES.map((r) => r.id)).toEqual(['chat', 'dev']);
  });

  it('每个角色都有完整的展示信息（选择器直接用，不散落硬编码）', () => {
    for (const r of CHAT_ROLES) {
      expect(r.id).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.icon).toBeTruthy();
      expect(r.placeholder).toBeTruthy();
    }
  });

  it('角色 id 不重复（新增角色时防止复制粘贴撞车）', () => {
    const ids = CHAT_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getRole / parseRoleId', () => {
  it('getRole 对未知 id 回退到默认角色（不抛错）', () => {
    expect(getRole('nope' as ChatRoleId).id).toBe(DEFAULT_ROLE_ID);
  });

  it('parseRoleId 只接受当前合法 id，并把历史角色映射到 dev', () => {
    expect(parseRoleId('chat')).toBe('chat');
    expect(parseRoleId('dev')).toBe('dev');
    expect(parseRoleId('plugin')).toBe('dev');     // 历史：插件开发
    expect(parseRoleId('skill-dev')).toBe('dev');  // 历史：技能开发
    expect(parseRoleId('CHAT')).toBeUndefined();
    expect(parseRoleId('')).toBeUndefined();
    expect(parseRoleId(undefined)).toBeUndefined();
    expect(parseRoleId(123)).toBeUndefined();
    expect(parseRoleId({ id: 'plugin' })).toBeUndefined();
  });

  it('持久化 key 稳定（localStorage / 会话元数据）', () => {
    expect(ROLE_STORAGE_KEY).toBe('chat:role');
    expect(ROLE_META_KEY).toBe('role');
  });
});
