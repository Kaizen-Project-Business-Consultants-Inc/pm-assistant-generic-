import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamMemberRow, memberName } from '../../components/project/TeamMemberRow';

/** U36 (2026-10-18): Overview › Team Members showed the email and email initials, not the name */
describe('TeamMemberRow', () => {
  it('shows the full name, its initials, and the email as a second line', () => {
    render(<TeamMemberRow member={{ userName: 'Marsha Turner', email: 'marsha@acme.example', role: 'manager' }} />);
    expect(screen.getByText('Marsha Turner')).toBeInTheDocument();
    expect(screen.getByText('MT')).toBeInTheDocument();
    expect(screen.getByText('marsha@acme.example')).toBeInTheDocument();
    expect(screen.getByText('manager')).toBeInTheDocument();
  });

  it('with no name, shows the email once', () => {
    render(<TeamMemberRow member={{ email: 'ivy@acme.example', role: 'viewer' }} />);
    expect(screen.getAllByText('ivy@acme.example')).toHaveLength(1);
  });

  it('memberName: the name, else the email, else Unknown', () => {
    expect(memberName({ userName: 'Dev Patel', email: 'd@x' })).toBe('Dev Patel');
    expect(memberName({ email: 'd@x' })).toBe('d@x');
    expect(memberName({})).toBe('Unknown');
  });
});
