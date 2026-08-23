import React, { useState } from 'react';

interface Entry {
  email: string;
  createdAt?: string;
  created_at?: string;
}

export const WaitlistAdminPage: React.FC = () => {
  const [key, setKey] = useState('');
  const [authed, setAuthed] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (k: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/v1/waitlist/admin', {
        headers: { 'x-admin-key': k },
      });
      if (res.status === 503) { setError('Waitlist admin is not configured on the server.'); setLoading(false); return; }
      if (res.status === 401) { setError('Wrong password.'); setLoading(false); return; }
      const data = await res.json();
      setEntries(data.entries);
      setCount(data.count);
      setAuthed(true);
    } catch {
      setError('Could not connect.');
    }
    setLoading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load(key);
  };

  const exportCsv = async () => {
    try {
      const res = await fetch('/api/v1/waitlist/admin/export', {
        headers: { 'x-admin-key': key },
      });
      if (!res.ok) { setError('Export failed.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'waitlist.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed.');
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl p-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <span className="text-white font-bold text-lg">Waitlist Admin</span>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="Admin password"
              required
              className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            />
            {error && <p className="text-rose-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-500 hover:to-purple-500 text-white font-semibold rounded-xl transition-all text-sm disabled:opacity-60"
            >
              {loading ? 'Checking...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Waitlist</h1>
            <p className="text-slate-400 text-sm mt-1">
              <span className="text-primary-400 font-semibold text-lg">{count}</span> signups
            </p>
          </div>
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-xl text-sm font-medium text-white transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>

        {/* Table */}
        {entries.length === 0 ? (
          <div className="text-center py-20 text-slate-500">No signups yet.</div>
        ) : (
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-6 py-3">#</th>
                  <th className="text-left px-6 py-3">Email</th>
                  <th className="text-left px-6 py-3">Joined</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={entry.email} className="border-b border-white/[0.06] hover:bg-slate-800 transition-colors">
                    <td className="px-6 py-3 text-slate-500">{i + 1}</td>
                    <td className="px-6 py-3 text-white font-medium">{entry.email}</td>
                    <td className="px-6 py-3 text-slate-400">
                      {new Date(entry.createdAt || entry.created_at || '').toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
