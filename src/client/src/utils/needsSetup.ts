/**
 * Should this person be sent to the setup screens (/onboarding)? Decided by whether they finished
 * setup, not by whether they have a name: free-trial and Google sign-ups arrive with a name and used
 * to skip setup entirely — no "Explore a sample project", no first project (2026-10-14). A payload
 * from before the server sent `onboardingCompleted` falls back to the old name rule.
 */
export function needsSetup(user: { onboardingCompleted?: boolean; fullName?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.onboardingCompleted === undefined ? !user.fullName : !user.onboardingCompleted;
}
