import { z } from 'zod';
import type { FastifyReply } from 'fastify';

/**
 * Plain-English message for a failed request-body check: the first thing wrong.
 *
 * A schema's own message (e.g. "Enter a name for the group.") is used as-is. Zod's
 * built-in messages ("Invalid input: expected string, received undefined") mean nothing
 * to a user, so those become "<Field> is missing." / "<Field> is not valid." using the
 * field's name.
 */
export function validationMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Some of the details sent are missing or not valid.';

  const message = issue.message || '';
  if (message && !isZodDefaultMessage(message)) return message;

  const field = fieldLabel(issue.path);
  if (!field) {
    // The whole body is missing or the wrong shape
    return 'Some required details are missing — nothing was sent.';
  }
  const missing = issue.code === 'invalid_type' && /received undefined/i.test(message);
  return missing ? `${field} is missing.` : `${field} is not valid.`;
}

/** Reply 400 with the plain-English message, keeping the issue list for API callers. */
export function sendValidationError(reply: FastifyReply, err: z.ZodError) {
  return reply.status(400).send({
    error: 'Validation error',
    message: validationMessage(err),
    details: err.issues,
  });
}

const ZOD_DEFAULT_PREFIXES = [
  'Invalid input', 'Invalid option', 'Invalid element', 'Invalid key', 'Invalid union',
  'Invalid string', 'Invalid number', 'Invalid date', 'Invalid UUID', 'Invalid uuid',
  'Invalid email', 'Invalid url', 'Invalid URL', 'Invalid ISO', 'Invalid enum',
  'Too small', 'Too big', 'Unrecognized key', 'Required', 'Expected ',
];

function isZodDefaultMessage(message: string): boolean {
  return ZOD_DEFAULT_PREFIXES.some(p => message.startsWith(p));
}

/** ['keys', 'p256dh'] → "Keys p256dh"; ['projectId'] → "Project id"; array indexes dropped. */
function fieldLabel(path: ReadonlyArray<PropertyKey>): string {
  const words = path
    .filter((p): p is string => typeof p === 'string')
    .map(p => p.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase());
  const label = words.join(' ').trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
}
