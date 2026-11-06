/**
 * ChatRole 测试：角色表是唯一的扩展点，配置驱动而非措辞驱动。
 * 早先那套「按每句话猜意图」的白名单判定与其测试已整体移除。
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
    expect(chat.trace).toBe(false);
    expect(chat.label).toBe('闲聊');
  });

  it('插件开发角色启用智能体与过程日志', () => {
    const plugin = getRole('plugin');
    expect(plugin.agent).toBe(true);
    expect(plugin.trace).toBe(true);
    expect(plugin.label).toBe('插件开发');
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

  it('扩展性：加一个角色只需在表里加一项，配置自洽即可（本用例示范结构约束）', () => {
    // 这里不改表，只验证「配置对象」的形状能被 getRole / parseRoleId 消费：
    // 任何新增项只要有 id 且 id 唯一，就会被自动纳入选择器与解析。
    const hypothetical: ChatRoleId = 'chat';
    expect(parseRoleId(hypothetical)).toBe('chat');
  });
});

describe('getRole / parseRoleId', () => {
  it('getRole 对未知 id 回退到默认角色（不抛错）', () => {
    expect(getRole('nope' as ChatRoleId).id).toBe(DEFAULT_ROLE_ID);
  });

  it('parseRoleId 只接受表里的合法 id', () => {
    expect(parseRoleId('chat')).toBe('chat');
    expect(parseRoleId('plugin')).toBe('plugin');
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
