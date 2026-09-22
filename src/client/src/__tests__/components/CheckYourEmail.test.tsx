import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ resendVerificationEmail: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));

import { CheckYourEmail } from '../../components/auth/CheckYourEmail';

function show(email = 'someone@gmail.com', onChangeEmail?: () => void) {
  return render(
    <MemoryRouter>
      <CheckYourEmail email={email} onChangeEmail={onChangeEmail} />
    </MemoryRouter>,
  );
}

/**
 * This screen is where every early signup stopped: five of the first six
 * production accounts never verified and never logged in. It used to say "Check
 * your email" and nothing else.
 */
describe('the confirm-your-email screen', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('repeats the address back, so a typo is obvious', async () => {
    show('tpyo@gmial.com');
    expect(screen.getByText('tpyo@gmial.com')).toBeTruthy();
  });

  it('says exactly what to search for', async () => {
    // Someone scrolling an inbox needs a sender and a subject, not encouragement.
    show();
    expect(screen.getByText(/noreply@kovarti\.com/)).toBeTruthy();
    expect(screen.getByText(/Verify your Kovarti PM Assistant account/)).toBeTruthy();
  });

  it('names Spam and Promotions out loud, because that is the actual failure', () => {
    show();
    expect(screen.getByText(/Spam/)).toBeTruthy();
    expect(screen.getByText(/Promotions/)).toBeTruthy();
  });

  it('offers a one-tap link to the mailbox it can recognise', () => {
    show('someone@gmail.com');
    const link = screen.getByText('Open Gmail').closest('a');
    expect(link?.getAttribute('href')).toContain('mail.google.com');
  });

  it('offers no mailbox link for an address it cannot guess', () => {
    // A work address has no inbox URL we could know. Better nothing than wrong.
    show('someone@acme-consulting.co.uk');
    expect(screen.queryByText(/^Open /)).toBeNull();
  });

  it('can send the email again', async () => {
    api.resendVerificationEmail.mockResolvedValue({});
    show('someone@gmail.com');

    fireEvent.click(screen.getByText(/Send it again/i));

    await waitFor(() => expect(screen.getByText(/Sent again/i)).toBeTruthy());
    expect(api.resendVerificationEmail).toHaveBeenCalledWith('someone@gmail.com');
  });

  it('explains the wait when asked to resend too often', async () => {
    // The endpoint allows 3 per 15 minutes. A bare failure would read as broken.
    api.resendVerificationEmail.mockRejectedValue({ response: { status: 429 } });
    show();

    fireEvent.click(screen.getByText(/Send it again/i));

    await waitFor(() => expect(screen.getByText(/wait a few minutes/i)).toBeTruthy());
  });

  it('lets someone go back and fix the address', () => {
    const onChangeEmail = vi.fn();
    show('wrong@gmail.com', onChangeEmail);

    fireEvent.click(screen.getByText(/Wrong address/i));

    expect(onChangeEmail).toHaveBeenCalled();
  });
});
