import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { memberValidationMessage } from '../../routes/core/projectMembers';

// The add-member form used to answer every mistake with "Choose a role…" (2026-09-29)
const schema = z.object({
  userName: z.string({ message: "Enter the person's name." }).trim().min(1, "Enter the person's name."),
  email: z.string({ message: 'Enter their email address.' }).email('Enter a valid email address, e.g. name@company.com.'),
  role: z.enum(['owner', 'manager', 'viewer'], { message: 'Choose a role: Viewer, Manager or Owner. (Editor was removed.)' }),
});
const msg = (body: unknown) => { const r = schema.safeParse(body); return r.success ? null : memberValidationMessage(r.error); };

describe('memberValidationMessage', () => {
  it('names the field that is actually wrong', () => {
    expect(msg({ email: 'a@b.com', role: 'viewer' })).toBe("Enter the person's name.");
    expect(msg({ userName: 'A', role: 'viewer' })).toBe('Enter their email address.');
    expect(msg({ userName: 'A', email: 'not-an-email', role: 'viewer' })).toBe('Enter a valid email address, e.g. name@company.com.');
    expect(msg({ userName: 'A', email: 'a@b.com', role: 'editor' })).toBe('Choose a role: Viewer, Manager or Owner. (Editor was removed.)');
    expect(msg({ userName: 'A', email: 'a@b.com', role: 'viewer' })).toBeNull();
  });
});
