import { useEffect, useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { apiService } from '../../services/api';

/**
 * Shown on every page during the platform admin's Support view visit: which company, that
 * it's read-only and recorded, the time left, and a way out. When time runs out the visit
 * ends and the admin is taken back to the admin pages.
 */
export function SupportBanner() {
  const visit = useAuthStore(s => s.user?.supportSession);
  const [left, setLeft] = useState(() => (visit ? Date.parse(visit.expiresAt) - Date.now() : 0));
  const [leaving, setLeaving] = useState(false);

  const exit = async () => {
    if (leaving) return;
    setLeaving(true);
    try { await apiService.endSupportVisit(); } catch { /* the cookie expires on its own */ }
    window.location.assign('/admin/tenants');
  };

  useEffect(() => {
    if (!visit) return;
    const t = setInterval(() => {
      const ms = Date.parse(visit.expiresAt) - Date.now();
      setLeft(ms);
      if (ms <= 0) { clearInterval(t); void exit(); }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per visit
  }, [visit?.expiresAt]);

  if (!visit) return null;
  const mins = Math.max(0, Math.floor(left / 60000));
  const secs = Math.max(0, Math.floor((left % 60000) / 1000));

  return (
    <div role="status" aria-live="polite"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm bg-amber-400 text-amber-950 border-b-2 border-amber-600">
      <Eye className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="font-bold uppercase tracking-wide">Support view</span>
      <span className="font-semibold">{visit.organizationName}</span>
      <span>· read-only · recorded in their audit trail</span>
      <span className="min-w-0 truncate" title={visit.reason}>· “{visit.reason}”</span>
      <span className="ml-auto tabular-nums font-semibold" aria-label={`${mins} minutes left`}>
        {mins}:{String(secs).padStart(2, '0')} left
      </span>
      <button type="button" onClick={exit} disabled={leaving}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-md font-semibold bg-amber-950 text-amber-50 hover:bg-amber-900 disabled:opacity-60">
        <LogOut className="w-3.5 h-3.5" aria-hidden="true" /> {leaving ? 'Leaving…' : 'Exit support view'}
      </button>
    </div>
  );
}
