/**
 * Who is signed in, when the app opens (2026-10-12).
 * - 401: the 15-minute access cookie has usually just run out — refresh the session once (the
 *   refresh cookie lasts a day) and ask again; only if that is refused too are they signed out.
 *   (Before, anyone who reopened the app after 15 minutes was signed out.)
 * - 403: refused — signed out.
 * - Busy (503) or no connection: tried again a couple of times; if it still fails the app keeps the
 *   person it remembered instead of signing them out.
 * Returns the user, null when signed out, or undefined when the server couldn't say.
 */
const statusOf = (err: unknown) => (err as { response?: { status?: number } })?.response?.status;

export async function loadSignedInUser<T>(
  getMe: () => Promise<{ user?: T | null }>,
  { refresh, tries = 3, waitMs = 1000 }: { refresh?: () => Promise<unknown>; tries?: number; waitMs?: number } = {},
): Promise<T | null | undefined> {
  let refreshed = false;
  for (let attempt = 1; ; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- tries one after another, waiting between
      const data = await getMe();
      return data.user ?? null;
    } catch (err) {
      const status = statusOf(err);
      if (status === 401 && refresh && !refreshed) {
        try {
          // eslint-disable-next-line no-await-in-loop -- refresh, then ask again
          await refresh();
          refreshed = true; // one successful refresh: a second 401 really is "signed out"
          continue;
        } catch (refreshErr) {
          if (statusOf(refreshErr) === 401 || statusOf(refreshErr) === 403) return null;
          // busy or offline while refreshing: fall through to "try again / keep who we had"
        }
      } else if (status === 401 || status === 403) {
        return null;
      }
      if (attempt >= tries) return undefined;
      // eslint-disable-next-line no-await-in-loop -- wait before the next try
      await new Promise<void>((resolve) => { setTimeout(resolve, waitMs * attempt); });
    }
  }
}
