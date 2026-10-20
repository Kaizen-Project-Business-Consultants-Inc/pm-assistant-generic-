import { useAuthStore } from '../stores/authStore';

/**
 * The word for a client (`project_groups`) on this plan (U50, user 2026-10-20): the Team (sme) and
 * Enterprise plans work for themselves, so they say **Department**; Consultant plans and the trial
 * work for outside clients and say **Client**. Words only — the data and pages are the same.
 */
export interface ClientWord {
  /** the Team and Enterprise plans */
  isDepartment: boolean;
  /** "Client" / "Department" */
  one: string;
  /** "Clients" / "Departments" */
  many: string;
  /** "client" / "department" */
  lower: string;
  /** "clients" / "departments" */
  lowerMany: string;
}

const CLIENT: ClientWord = { isDepartment: false, one: 'Client', many: 'Clients', lower: 'client', lowerMany: 'clients' };
const DEPARTMENT: ClientWord = { isDepartment: true, one: 'Department', many: 'Departments', lower: 'department', lowerMany: 'departments' };

export function clientWordFor(tier: string | null | undefined): ClientWord {
  return tier === 'sme' || tier === 'enterprise' ? DEPARTMENT : CLIENT;
}

export function useClientWord(): ClientWord {
  const tier = useAuthStore(s => s.user?.subscriptionTier);
  return clientWordFor(tier);
}
