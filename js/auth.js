import { USERS } from '../config.js';
import { sha256 } from './sha256.js';

const KEY = 'ahk.session.v1';

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')?.username ?? null;
  } catch {
    return null;
  }
}

export async function login(username, password) {
  const name = String(username || '').trim().toLowerCase();
  const user = USERS.find((u) => u.username.toLowerCase() === name);
  const hash = await sha256(String(password || ''));
  if (!user || hash !== String(user.passwordSha256).toLowerCase()) return false;
  localStorage.setItem(KEY, JSON.stringify({ username: user.username, at: Date.now() }));
  return true;
}

export function logout() {
  localStorage.removeItem(KEY);
}
