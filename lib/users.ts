'use client';

/**
 * 本地多用户档案。
 * 纯前端单机场景：账号不用于鉴权，只用于把每个人的学习数据隔开。
 * 大模型配置为全局共享，不随用户切换。
 */

export interface UserAccount {
  id: string;
  name: string;
  createdAt: number;
}

const USERS_KEY = 'elm.users';
const ACTIVE_KEY = 'elm.activeUser';
const DEFAULT_USER_NAME = '默认用户';

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式下可能不可写，忽略 */
  }
}

function newId() {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function listUsers(): UserAccount[] {
  return readLS<UserAccount[]>(USERS_KEY, []);
}

function saveUsers(users: UserAccount[]) {
  writeLS(USERS_KEY, users);
}

/** 保证至少有一个用户；返回 { users, activeId } */
export function ensureUsers(): { users: UserAccount[]; activeId: string } {
  let users = listUsers();
  if (!users.length) {
    const first: UserAccount = { id: newId(), name: DEFAULT_USER_NAME, createdAt: Date.now() };
    users = [first];
    saveUsers(users);
    writeLS(ACTIVE_KEY, first.id);
  }
  const stored = readLS<string | null>(ACTIVE_KEY, null);
  const activeId = stored && users.some((u) => u.id === stored) ? stored : users[0].id;
  return { users, activeId };
}

export function createUser(name: string): { users: UserAccount[]; id: string } {
  const users = listUsers();
  const account: UserAccount = {
    id: newId(),
    name: name.trim() || `用户 ${users.length + 1}`,
    createdAt: Date.now(),
  };
  const next = [...users, account];
  saveUsers(next);
  return { users: next, id: account.id };
}

export function renameUser(id: string, name: string): UserAccount[] {
  const next = listUsers().map((u) => (u.id === id ? { ...u, name: name.trim() || u.name } : u));
  saveUsers(next);
  return next;
}

export function removeUserRecord(id: string): UserAccount[] {
  const next = listUsers().filter((u) => u.id !== id);
  saveUsers(next);
  return next;
}

export function getActiveUserId(): string | null {
  return readLS<string | null>(ACTIVE_KEY, null);
}

export function setActiveUserId(id: string) {
  writeLS(ACTIVE_KEY, id);
}
