/**
 * The body for a file upload that also sends form fields. The fields MUST come before the file:
 * the server reads the upload with @fastify/multipart's request.file(), which only sees fields
 * sent ahead of the file. Sent after it, they were silently lost — every transcript upload failed
 * ("projectId and scheduleId are required") and document descriptions vanished (2026-10-14).
 */
export function uploadForm(file: File, fields: Record<string, string | undefined> = {}): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '') form.append(name, value);
  }
  form.append('file', file);
  return form;
}
