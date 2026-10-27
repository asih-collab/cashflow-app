// 鍵付きの目標（同じ iPhone を見る人に見せたくないもの）の鍵。
// 暗証番号はこの端末にだけ置く（同期しない。塩付きのハッシュで保存）。開いた状態は、アプリを閉じる（裏に回す）と元に戻る。
import type { Db } from './db';

const KEY = 'privacy-pin';
let unlocked = false;
const listeners = new Set<() => void>();

interface Stored { salt: string; hash: string }

async function digest(pin: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hasPin(db: Db): Promise<boolean> {
  return !!(await db.get<Stored>('meta', KEY));
}

export async function setPin(db: Db, pin: string): Promise<void> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  await db.put('meta', { salt, hash: await digest(pin, salt) } satisfies Stored, KEY);
  unlocked = true;
  emit();
}

export async function unlock(db: Db, pin: string): Promise<boolean> {
  const s = await db.get<Stored>('meta', KEY);
  if (!s) return false;
  const ok = (await digest(pin, s.salt)) === s.hash;
  if (ok) { unlocked = true; emit(); }
  return ok;
}

export function isUnlocked(): boolean {
  return unlocked;
}

export function lock(): void {
  if (!unlocked) return;
  unlocked = false;
  emit();
}

export function onPrivacyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

/** 4〜8 桁の数字 */
export function validPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}
