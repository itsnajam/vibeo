import { UserProfile } from "../types";

const USER_KEY = "vibeo_user";

export function getOrCreateUser(displayName: string): UserProfile {
  const stored = localStorage.getItem(USER_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as UserProfile;
      // Update name if changed
      if (parsed.fullName !== displayName) {
        const updated = { ...parsed, fullName: displayName };
        localStorage.setItem(USER_KEY, JSON.stringify(updated));
        return updated;
      }
      return parsed;
    } catch { /* fall through */ }
  }
  const user: UserProfile = { id: crypto.randomUUID(), fullName: displayName };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export function clearUser(): void {
  localStorage.removeItem(USER_KEY);
}

export function loadStoredUser(): UserProfile | null {
  const stored = localStorage.getItem(USER_KEY);
  if (!stored) return null;
  try { return JSON.parse(stored) as UserProfile; }
  catch { return null; }
}
