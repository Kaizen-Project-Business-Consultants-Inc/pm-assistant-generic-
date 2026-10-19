import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { apiService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

/**
 * "Finish your profile" beside the Get started steps (U42, approved mock 2026-10-19): what the
 * removed "Tell us about yourself" screen asked, now optional and in place — name and company
 * (the company only by its owner; a Google sign-up's company starts as their own name), phone,
 * your role (Project manager until picked; only while setting up — server users.ts) and time zone.
 * There is no photo: the app has no profile pictures.
 */
const ROLE_CHOICES = [
  { value: 'project_manager', label: 'Project manager' },
  { value: 'team_member', label: 'Team member' },
  { value: 'executive', label: 'Executive' },
  { value: 'scrum_master', label: 'Scrum master' },
];

function Tick({ done }: { done: boolean }) {
  return (
    <span aria-hidden="true" className={`flex-none mt-0.5 w-4 h-4 rounded border-2 border-primary-600 flex items-center justify-center ${done ? 'bg-primary-600' : ''}`}>
      {done && <Check className="w-3 h-3 text-white" />}
    </span>
  );
}

function useSave() {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (data: Parameters<typeof apiService.updateProfile>[0]): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await apiService.updateProfile(data);
      return true;
    } catch (err) {
      setError(getApiErrorMessage(err, 'That could not be saved. Please try again.'));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { save, saving, error };
}

function NameAndCompany() {
  const { user, setUser } = useAuthStore();
  const isOwner = user?.organization?.isOwner === true;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user?.fullName ?? '');
  const [company, setCompany] = useState(user?.organization?.name ?? '');
  const { save, saving, error } = useSave();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fullName = name.trim();
    const organizationName = company.trim();
    const ok = await save({ fullName, ...(isOwner && organizationName ? { organizationName } : {}) });
    if (!ok || !user) return;
    setUser({ ...user, fullName, ...(isOwner && user.organization ? { organization: { ...user.organization, name: organizationName } } : {}) });
    setOpen(false);
  }

  return (
    <li className="flex gap-2">
      <Tick done />
      <div className="flex-1 min-w-0">
        <span>{user?.fullName}{user?.organization?.name ? ` · ${user.organization.name}` : ''}</span>{' '}
        {!open && <button type="button" onClick={() => setOpen(true)} className="text-primary-600 dark:text-primary-400 hover:underline">Change</button>}
        {open && (
          <form onSubmit={submit} className="mt-2 space-y-2">
            <label className="block text-xs font-medium">Your name
              <input type="text" required maxLength={200} value={name} onChange={e => setName(e.target.value)} className="input mt-1" autoComplete="name" />
            </label>
            {isOwner && (
              <label className="block text-xs font-medium">Company name
                <input type="text" required minLength={2} maxLength={255} value={company} onChange={e => setCompany(e.target.value)} className="input mt-1" autoComplete="organization" />
              </label>
            )}
            {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-3 py-1 text-xs font-medium text-white bg-primary-600 rounded disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1 text-xs">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

function Phone() {
  const { user, setUser } = useAuthStore();
  const [phone, setPhone] = useState('');
  const { save, saving, error } = useSave();
  if (user?.phone) {
    return <li className="flex gap-2"><Tick done /><span>Phone · {user.phone}</span></li>;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = phone.trim();
    if (!value || !(await save({ phone: value })) || !user) return;
    setUser({ ...user, phone: value });
  }
  return (
    <li className="flex gap-2">
      <Tick done={false} />
      <form onSubmit={submit} className="flex-1 min-w-0 space-y-1">
        <label htmlFor="get-started-phone">Phone <span className="text-gray-500 dark:text-gray-400">(optional)</span></label>
        <div className="flex gap-2">
          <input id="get-started-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="input py-1" placeholder="+1 416 555 0100" autoComplete="tel" />
          <button type="submit" disabled={saving || !phone.trim()} className="px-3 py-1 text-xs font-medium text-white bg-primary-600 rounded disabled:opacity-50">Save</button>
        </div>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </form>
    </li>
  );
}

function Role() {
  const { user, setUser } = useAuthStore();
  const [picked, setPicked] = useState(false);
  const { save, error } = useSave();
  const current = ROLE_CHOICES.some(r => r.value === user?.accountRole) ? user!.accountRole! : 'project_manager';
  async function pick(value: string) {
    if (!(await save({ role: value })) || !user) return;
    setUser({ ...user, accountRole: value });
    setPicked(true);
  }
  return (
    <li className="flex gap-2">
      <Tick done={picked} />
      <div className="flex-1 min-w-0 space-y-1">
        <label htmlFor="get-started-role">Your role</label>
        <select id="get-started-role" value={current} onChange={e => { void pick(e.target.value); }} className="input py-1">
          {ROLE_CHOICES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </li>
  );
}

function TimeZone() {
  const { data } = useQuery({ queryKey: ['notification-preferences'], queryFn: () => apiService.getNotificationPreferences() });
  const tz: string | undefined = data?.user?.timezone;
  const set = !!tz && tz !== 'UTC';
  return (
    <li className="flex gap-2">
      <Tick done={set} />
      <span>{set ? `Time zone · ${tz}` : 'Time zone'}{' '}
        <Link to="/settings?tab=display" className="text-primary-600 dark:text-primary-400 hover:underline">{set ? 'Change' : 'Set it'}</Link>
      </span>
    </li>
  );
}

/** The list itself; "Hide for now" is the card's (GetStartedCard) */
export function ProfileChecklist({ canPickRole }: { canPickRole: boolean }) {
  return (
    <ul className="space-y-3 text-sm text-gray-800 dark:text-gray-200">
      <NameAndCompany />
      <Phone />
      {canPickRole && <Role />}
      <TimeZone />
    </ul>
  );
}
