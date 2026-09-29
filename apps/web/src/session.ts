import { computed, shallowRef } from "vue";
import { api, type SessionInfo } from "./api";

export const session = shallowRef<SessionInfo>();
export const currentUser = computed(() => session.value?.user);
export const isAdmin = computed(() => session.value?.user?.role === "admin");

export async function loadSession(): Promise<SessionInfo> {
  session.value = await api.session();
  return session.value;
}

export function clearUser(): void {
  if (!session.value) return;
  const { user: _removed, ...rest } = session.value;
  session.value = rest;
}

/** Up to two letters for the avatar: "Martin M." → "MM", "martin.mohr" → "MM", "admin" → "A". */
export function initials(username: string): string {
  const parts = username.split(/[\s._-]+/u).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => [...p][0] ?? "")
    .join("")
    .toLocaleUpperCase();
}
