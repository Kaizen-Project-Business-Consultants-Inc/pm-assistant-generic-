import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore, type User } from '../stores/authStore';
import { useAIChatStore } from '../stores/aiChatStore';
import { useUIStore } from '../stores/uiStore';
import { resetPresence } from '../hooks/useWebSocket';

const AUTH_STORAGE_KEY = 'pm-generic-auth-storage';
const BRIEF_DRAFT_PREFIX = 'brief-draft-';

/**
 * Drop everything held in this tab for the person who was signed in: the query cache (projects,
 * dashboard numbers, people…), the Mjuzi chat, conversations and project context, notifications,
 * who-is-viewing lists and unsaved brief drafts. Sign-out does not reload the page, and the cache
 * keeps data for 10 minutes without refetching, so the next person to sign in on the same tab
 * could be shown the previous person's data (review 2026-10-11). View preferences already reset
 * themselves (useViewPreferences checkOwner).
 */
function clearSignedInUserData(queryClient: QueryClient): void {
  queryClient.clear();
  useAIChatStore.getState().forgetUser();
  const ui = useUIStore.getState();
  ui.clearNotifications();
  ui.setAIPanelContext({ type: 'dashboard' });
  resetPresence();
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(BRIEF_DRAFT_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch { /* storage blocked */ }
}

/** Whose data this tab holds: the person, and the company they see it in (an invite or a support visit can change it) */
function owner(user: User | null): string | null {
  if (!user) return null;
  return `${user.id}|${user.organization?.id ?? ''}|${user.supportSession ? 'support' : ''}`;
}

/**
 * Clear when the signed-in person or their company changes: sign-out, session ended, someone else
 * signs in, or a sign-out/sign-in in another tab (the shared auth storage changes under this one).
 */
export function watchSignedInUser(queryClient: QueryClient): () => void {
  const stopAuth = useAuthStore.subscribe((state, prev) => {
    if (prev.user && owner(prev.user) !== owner(state.user)) clearSignedInUserData(queryClient);
  });
  const onStorage = (e: StorageEvent) => {
    if (e.key !== AUTH_STORAGE_KEY && e.key !== null) return;
    const mine = useAuthStore.getState().user;
    let theirs: User | null = null;
    try { theirs = e.newValue ? (JSON.parse(e.newValue)?.state?.user ?? null) : null; } catch { /* unreadable: treat as signed out */ }
    if (!mine || owner(mine) === owner(theirs)) return;
    // Take on the other tab's person rather than signing out: signing out writes `null` back, which
    // would sign the person who just signed in there out again. Either way the watcher clears.
    if (theirs) useAuthStore.getState().setUser(theirs);
    else useAuthStore.getState().logout();
  };
  window.addEventListener('storage', onStorage);
  return () => { stopAuth(); window.removeEventListener('storage', onStorage); };
}
