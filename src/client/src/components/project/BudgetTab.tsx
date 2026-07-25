import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Plus, Trash2, X, TrendingUp, AlertTriangle, PieChart, Search, Download } from 'lucide-react';
import { apiService } from '../../services/api';

const EXPENSE_CATEGORIES = [
  'labor', 'materials', 'software', 'hardware', 'travel',
  'contractors', 'training', 'consulting', 'licenses', 'other',
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  labor: '#3b82f6',
  materials: '#f59e0b',
  software: '#8b5cf6',
  hardware: '#06b6d4',
  travel: '#ec4899',
  contractors: '#f97316',
  training: '#10b981',
  consulting: '#6366f1',
  licenses: '#14b8a6',
  other: '#6b7280',
};

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type SubTab = 'overview' | 'expenses';
type SortField = 'date' | 'amount' | 'category' | 'vendor';
type SortDir = 'asc' | 'desc';

function SortHeader({ label, field, current, dir, onSort, align }: { label: string; field: SortField; current: SortField; dir: SortDir; onSort: (f: SortField) => void; align?: string }) {
  return (
    <th
      className={`${align === 'right' ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white select-none`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {current === field && <span className="text-primary-500">{dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );
}

function DonutChart({ categories, total, currency }: { categories: { category: string; total: number }[]; total: number; currency: string }) {
  if (categories.length === 0) return null;
  const radius = 60;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const slices = categories.map((cat) => {
    const pct = total > 0 ? cat.total / total : 0;
    const dashLength = pct * circumference;
    const dashOffset = -offset;
    offset += dashLength;
    return { ...cat, dashLength, dashOffset, color: CATEGORY_COLORS[cat.category] || '#6b7280' };
  });

  return (
    <div className="flex items-center gap-4">
      <svg width="160" height="160" viewBox="0 0 160 160" className="flex-shrink-0">
        {slices.map((s, i) => (
          <circle
            key={i}
            cx="80" cy="80" r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${s.dashLength} ${circumference - s.dashLength}`}
            strokeDashoffset={s.dashOffset}
            transform="rotate(-90 80 80)"
          />
        ))}
        <text x="80" y="76" textAnchor="middle" className="text-sm font-bold fill-gray-700 dark:fill-gray-200">{formatCurrency(total, currency)}</text>
        <text x="80" y="92" textAnchor="middle" className="text-[10px] fill-gray-400">total</text>
      </svg>
      <div className="space-y-1">
        {slices.map((s) => (
          <div key={s.category} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-gray-700 dark:text-gray-300">{capitalize(s.category)}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-auto">{formatCurrency(s.total, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetGauge({ pct, status }: { pct: number; status: string }) {
  const angle = Math.min(pct, 120) * 1.5; // 0-180 degrees, cap at 120% -> 180
  const color = status === 'over' ? '#ef4444' : status === 'warning' ? '#f59e0b' : '#22c55e';
  const r = 50;
  const cx = 60;
  const cy = 60;
  const startAngle = Math.PI;
  const endAngle = startAngle - (angle / 180) * Math.PI;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = angle > 90 ? 1 : 0;

  return (
    <svg width="120" height="70" viewBox="0 0 120 70">
      {/* Background arc */}
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" className="stroke-gray-200 dark:stroke-gray-600" strokeWidth="8" strokeLinecap="round" />
      {/* Filled arc */}
      {pct > 0 && (
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
      )}
      <text x={cx} y={cy - 8} textAnchor="middle" className="text-lg font-bold" fill={color}>{pct}%</text>
      <text x={cx} y={cy + 6} textAnchor="middle" className="text-[9px] fill-gray-400">budget used</text>
    </svg>
  );
}

export function BudgetTab({ projectId, project }: { projectId: string; project: any }) {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [showForm, setShowForm] = useState(false);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState<string>('other');
  const [formVendor, setFormVendor] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('all');

  const budgetAllocated = project?.budgetAllocated || project?.budget_allocated || 0;
  const budgetSpent = project?.budgetSpent || project?.budget_spent || 0;
  const currency = project?.currency || 'USD';

  const { data: expensesData, isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses', projectId],
    queryFn: () => apiService.getProjectExpenses(projectId),
    enabled: !!projectId,
  });
  const expenses: any[] = expensesData?.expenses || [];

  const { data: summaryData } = useQuery({
    queryKey: ['expense-summary', projectId],
    queryFn: () => apiService.getExpenseSummary(projectId),
    enabled: !!projectId,
  });
  const categories: { category: string; total: number; count: number }[] = summaryData?.categories || [];
  const monthly: { month: string; total: number }[] = summaryData?.monthly || [];

  const createMutation = useMutation({
    mutationFn: () => apiService.createExpense({
      projectId,
      date: formDate,
      amount: parseFloat(formAmount),
      category: formCategory,
      vendor: formVendor || undefined,
      description: formDescription || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary', projectId] });
      setShowForm(false);
      setFormAmount('');
      setFormVendor('');
      setFormDescription('');
      setFormCategory('other');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteExpense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary', projectId] });
    },
  });

  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalSpend = budgetSpent + totalExpenses;
  const remaining = budgetAllocated - totalSpend;
  const usedPct = budgetAllocated > 0 ? Math.round((totalSpend / budgetAllocated) * 100) : 0;
  const burnStatus = usedPct > 100 ? 'over' : usedPct > 80 ? 'warning' : 'healthy';

  const maxMonthly = Math.max(...monthly.map(m => m.total), 1);

  // Cumulative monthly line
  const cumulativeMonthly = useMemo(() => {
    let cumulative = 0;
    return monthly.map(m => { cumulative += m.total; return cumulative; });
  }, [monthly]);
  const maxCumulative = cumulativeMonthly.length > 0 ? Math.max(...cumulativeMonthly, 1) : 1;

  // Filtered + sorted expenses
  const filteredExpenses = useMemo(() => {
    let result = [...expenses];
    if (expenseSearch.trim()) {
      const q = expenseSearch.toLowerCase();
      result = result.filter(e =>
        (e.vendor && e.vendor.toLowerCase().includes(q)) ||
        (e.description && e.description.toLowerCase().includes(q)) ||
        (e.category && e.category.toLowerCase().includes(q))
      );
    }
    if (expenseCategoryFilter !== 'all') {
      result = result.filter(e => e.category === expenseCategoryFilter);
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
      else if (sortField === 'amount') cmp = (a.amount || 0) - (b.amount || 0);
      else if (sortField === 'category') cmp = (a.category || '').localeCompare(b.category || '');
      else if (sortField === 'vendor') cmp = (a.vendor || '').localeCompare(b.vendor || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [expenses, expenseSearch, expenseCategoryFilter, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Category', 'Amount', 'Vendor', 'Description'];
    const rows = filteredExpenses.map(e => [
      new Date(e.date).toISOString().slice(0, 10),
      e.category || '',
      (e.amount || 0).toFixed(2),
      e.vendor || '',
      (e.description || '').replace(/"/g, '""'),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-6 space-y-6">
      {/* Sub-tab navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <div className="flex gap-6">
            <button
              onClick={() => setSubTab('overview')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'overview' ? 'border-primary-500 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <PieChart className="w-4 h-4" /> Overview
            </button>
            <button
              onClick={() => setSubTab('expenses')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'expenses' ? 'border-primary-500 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <DollarSign className="w-4 h-4" /> Expenses
              {expenses.length > 0 && (
                <span className="text-[10px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full px-1.5">{expenses.length}</span>
              )}
            </button>
          </div>
        </div>
        {subTab === 'expenses' && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={filteredExpenses.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              <Download className="w-4 h-4" /> CSV
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Expense
            </button>
          </div>
        )}
      </div>

      {/* Overview sub-tab */}
      {subTab === 'overview' && (
        <>
          {/* Budget summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Budget Allocated</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(budgetAllocated, currency)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total Spent</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(totalSpend, currency)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Remaining</p>
              <p className={`text-2xl font-bold ${remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{formatCurrency(remaining, currency)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 flex items-center gap-4">
              <BudgetGauge pct={usedPct} status={burnStatus} />
              {burnStatus !== 'healthy' && <AlertTriangle className={`w-5 h-5 ${burnStatus === 'over' ? 'text-red-500' : 'text-amber-500'}`} />}
            </div>
          </div>

          {/* Category donut + Monthly spend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Category donut */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-primary-500" /> Cost Breakdown by Category
              </h3>
              {categories.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No expenses recorded yet</p>
              ) : (
                <DonutChart categories={categories} total={totalExpenses} currency={currency} />
              )}
            </div>

            {/* Monthly spend bar chart with cumulative line */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary-500" /> Monthly Spend Trend
              </h3>
              {monthly.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No expense data to chart</p>
              ) : (
                <div className="relative">
                  <div className="flex items-end gap-2 h-40">
                    {monthly.map((m) => {
                      const h = Math.max(4, (m.total / maxMonthly) * 100);
                      const label = new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1 relative z-10">
                          <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">{formatCurrency(m.total, currency)}</span>
                          <div
                            className="w-full rounded-t bg-primary-500 dark:bg-primary-400 transition-all"
                            style={{ height: `${h}%` }}
                            title={`${label}: ${formatCurrency(m.total, currency)}`}
                          />
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Cumulative line overlay */}
                  {cumulativeMonthly.length >= 2 && (
                    <svg className="absolute inset-0 w-full h-40 pointer-events-none" viewBox={`0 0 ${monthly.length * 100} 100`} preserveAspectRatio="none">
                      <polyline
                        points={cumulativeMonthly.map((v, i) => `${(i + 0.5) * (100 / monthly.length) * monthly.length},${100 - (v / maxCumulative) * 90}`).join(' ')}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  )}
                  {cumulativeMonthly.length >= 2 && (
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                      <span className="flex items-center gap-1"><span className="w-3 h-2 bg-primary-500 dark:bg-primary-400 rounded-sm" /> Monthly</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block" /> Cumulative</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Expenses sub-tab */}
      {subTab === 'expenses' && (
        <>
          {/* Add Expense form */}
          {showForm && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-primary-200 dark:border-primary-700 p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">New Expense</h3>
                <button onClick={() => setShowForm(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close expense form"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
                  <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount</label>
                  <input type="number" step="0.01" min="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Category</label>
                  <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{capitalize(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Vendor</label>
                  <input type="text" value={formVendor} onChange={(e) => setFormVendor(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
                  <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none" placeholder="Optional" />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => createMutation.mutate()}
                  disabled={!formAmount || createMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending ? 'Saving…' : 'Add Expense'}
                </button>
              </div>
            </div>
          )}

          {/* Search/filter bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={expenseSearch}
                onChange={(e) => setExpenseSearch(e.target.value)}
                placeholder="Search vendor, description, category..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
            <select
              value={expenseCategoryFilter}
              onChange={(e) => setExpenseCategoryFilter(e.target.value)}
              className="text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-2 outline-none"
            >
              <option value="all">All categories</option>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{capitalize(c)}</option>)}
            </select>
            {(expenseSearch || expenseCategoryFilter !== 'all') && (
              <span className="text-xs text-gray-400 dark:text-gray-500">{filteredExpenses.length} of {expenses.length}</span>
            )}
          </div>

          {/* Expense table (desktop) */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hidden sm:block">
            {expensesLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>{expenses.length === 0 ? 'No expenses recorded yet.' : 'No matching expenses.'}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700">
                    <SortHeader label="Date" field="date" current={sortField} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Category" field="category" current={sortField} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Amount" field="amount" current={sortField} dir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader label="Vendor" field="vendor" current={sortField} dir={sortDir} onSort={handleSort} />
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Description</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((e: any) => (
                    <tr key={e.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: CATEGORY_COLORS[e.category] || '#6b7280' }} />
                          <span className="text-gray-700 dark:text-gray-300">{capitalize(e.category)}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(e.amount, currency)}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{e.vendor || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{e.description || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => deleteMutation.mutate(e.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" aria-label="Delete expense"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                    <td className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">{formatCurrency(filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0), currency)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Mobile expense cards */}
          <div className="sm:hidden space-y-2">
            {expensesLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>{expenses.length === 0 ? 'No expenses recorded yet.' : 'No matching expenses.'}</p>
              </div>
            ) : (
              filteredExpenses.map((e: any) => (
                <div key={e.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: CATEGORY_COLORS[e.category] || '#6b7280' }} />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{capitalize(e.category)}</span>
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(e.amount, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                    <span>{new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span>{e.vendor || ''}</span>
                  </div>
                  {e.description && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">{e.description}</p>}
                  <button onClick={() => deleteMutation.mutate(e.id)} className="mt-1 text-xs text-red-500 hover:text-red-700">Delete</button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
