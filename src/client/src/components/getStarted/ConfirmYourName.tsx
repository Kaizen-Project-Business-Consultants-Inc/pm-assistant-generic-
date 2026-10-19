import React, { useEffect, useRef, useState } from 'react';
import { apiService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

/**
 * An invited person's first sign-in, straight after setting their own password (U42, approved mock
 * 2026-10-19): one small check that the name their team will see is right — the owner may have
 * typed it, or it is the start of their email — then on to their project. Replaces the setup screens.
 */
export function ConfirmYourName({ onDone }: { onDone: () => void }) {
  const { user, setUser } = useAuthStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.fullName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Change it" puts the cursor in the name box (keyboard users aren't left on a removed button)
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const fullName = name.trim();
    if (!fullName || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiService.updateProfile({ fullName });
      if (user) setUser({ ...user, fullName });
      onDone();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Your name could not be saved. Please try again.'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" role="group" aria-labelledby="confirm-name-title">
      <h2 id="confirm-name-title" className="text-xl font-bold text-gray-900 dark:text-white">
        You&apos;ve joined {user?.organization?.name ?? 'your company'}
      </h2>
      {editing ? (
        <form onSubmit={save} className="space-y-3">
          <label htmlFor="confirm-name-input" className="block text-sm font-medium text-gray-700 dark:text-gray-200">Your name</label>
          <input id="confirm-name-input" type="text" required maxLength={200} value={name} ref={inputRef} autoComplete="name"
            onChange={e => setName(e.target.value)} className="input" />
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
            {saving ? 'Saving…' : 'Save and continue'}
          </button>
        </form>
      ) : (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300">Is this your name? Your team will see it.</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{user?.fullName}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onDone}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg">
              Yes, that&apos;s me
            </button>
            <button type="button" onClick={() => setEditing(true)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg">
              Change it
            </button>
          </div>
        </>
      )}
    </div>
  );
}
