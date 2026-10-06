'use client';

/** 极简 LRU：相同输入不重复烧钱 */
const MAX_ENTRIES = 200;
const store = new Map<string, string>();

export function cacheKey(...parts: string[]) {
  return parts.join('\u0000');
}

export function cacheGet(key: string): string | undefined {
  const hit = store.get(key);
  if (hit === undefined) return undefined;
  // 命中即刷新为最近使用
  store.delete(key);
  store.set(key, hit);
  return hit;
}

export function cacheSet(key: string, value: string) {
  if (store.has(key)) store.delete(key);
  store.set(key, value);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function cacheClear() {
  store.clear();
}

export function cacheSize() {
  return store.size;
}
