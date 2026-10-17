/**
 * Every API error reply has { statusCode, error, message, timestamp, path } (plugins.ts onSend).
 * Every other field the route chose to send is kept as it is. This used to be an allow-list, and
 * each field left off it silently vanished: the "Open it" link's existingProjectId (2026-10-07),
 * the AI memory conflict's current version and sign-in's "show the human check" flag (2026-10-17).
 */
export function normalizeErrorBody(body: Record<string, unknown>, statusCode: number, statusText: string, path: string) {
  return {
    ...body,
    statusCode,
    error: typeof body.error === 'string' ? body.error : statusText,
    message: typeof body.message === 'string' ? body.message : (typeof body.error === 'string' ? body.error : statusText),
    timestamp: new Date().toISOString(),
    path,
  };
}
