import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Briefcase, BarChart3, Users, Zap, CheckCircle, ArrowRight, ArrowLeft, SkipForward } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';

const ROLE_OPTIONS = [
  { value: 'project_manager', label: 'Project Manager', icon: Briefcase, description: 'Plan, schedule, and deliver projects' },
  { value: 'team_member', label: 'Team Member', icon: User, description: 'Execute tasks and track progress' },
  { value: 'executive', label: 'Executive', icon: BarChart3, description: 'Monitor portfolio and KPIs' },
  { value: 'scrum_master', label: 'Scrum Master', icon: Users, description: 'Facilitate agile ceremonies' },
  { value: 'other', label: 'Other', icon: Zap, description: 'I\'ll set my role later' },
] as const;

const METHODOLOGY_OPTIONS = [
  { value: 'waterfall', label: 'Waterfall', description: 'Sequential phases with milestones' },
  { value: 'agile', label: 'Agile', description: 'Iterative sprints and backlogs' },
  { value: 'hybrid', label: 'Hybrid', description: 'Mix of waterfall and agile' },
] as const;

interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  projectType?: string;
}

export const OnboardingPage: React.FC = () => {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [methodology, setMethodology] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [projectName, setProjectName] = useState('');
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  // Track whether the user already had a name when they arrived
  const hadNameOnMount = useRef(!!user?.fullName);

  useEffect(() => {
    if (user?.username && !username) {
      setUsername(user.username);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only redirect if they arrived already onboarded — not when they complete step 1
  useEffect(() => {
    if (hadNameOnMount.current && user?.fullName) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const roleToSubmit = selectedRole && selectedRole !== 'other' ? selectedRole : undefined;
      await apiService.updateProfile({
        fullName,
        username: username !== user?.username ? username : undefined,
        organizationName: organizationName || undefined,
        role: roleToSubmit,
      });

      const data = await apiService.getMe();
      if (data.user) setUser(data.user);

      // Load templates for step 2
      try {
        const tmplData = await apiService.getTemplates();
        const list = tmplData.templates || tmplData || [];
        setTemplates(Array.isArray(list) ? list : []);
      } catch {
        setTemplates([]);
      }

      setStep(2);
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to save profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Sort templates: methodology-matching ones first, then the rest
  const filteredTemplates = [...templates].sort((a, b) => {
    if (!methodology) return 0;
    const catA = (a.category || a.projectType || '').toLowerCase();
    const catB = (b.category || b.projectType || '').toLowerCase();
    const matchA = methodology === 'waterfall'
      ? (catA.includes('waterfall') || catA.includes('construction') || catA.includes('infrastructure'))
      : methodology === 'agile'
        ? (catA.includes('agile') || catA.includes('software') || catA.includes('sprint'))
        : false;
    const matchB = methodology === 'waterfall'
      ? (catB.includes('waterfall') || catB.includes('construction') || catB.includes('infrastructure'))
      : methodology === 'agile'
        ? (catB.includes('agile') || catB.includes('software') || catB.includes('sprint'))
        : false;
    if (matchA && !matchB) return -1;
    if (!matchA && matchB) return 1;
    return 0;
  }).slice(0, 6);

  const handleCreateProject = async () => {
    if (!selectedTemplate || !projectName.trim()) return;
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiService.applyTemplate({
        templateId: selectedTemplate,
        projectName: projectName.trim(),
        startDate: new Date().toISOString().split('T')[0],
        methodology: methodology || undefined,
      });
      const pid = result.projectId || result.project?.id;
      setCreatedProjectId(pid || null);
      setStep(3);
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to create project. You can create one later from the dashboard.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipProject = () => {
    setStep(3);
  };

  const stepIndicator = (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
            s < step ? 'bg-primary-600 text-white' : s === step ? 'bg-primary-600 text-white ring-2 ring-primary-400/50 ring-offset-2 ring-offset-gray-800' : 'bg-gray-700 text-gray-400'
          }`}>
            {s < step ? <CheckCircle className="w-4 h-4" /> : s}
          </div>
          {s < 3 && <div className={`w-8 h-0.5 ${s < step ? 'bg-primary-500' : 'bg-gray-700'}`} />}
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg w-full">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8">
          {stepIndicator}

          {/* Step 1: Profile + Role + Methodology */}
          {step === 1 && (
            <>
              <div className="text-center mb-6">
                <div className="mx-auto w-12 h-12 bg-primary-100 dark:bg-primary-900/40 rounded-xl flex items-center justify-center mb-4">
                  <span className="text-xl font-bold text-primary-600 dark:text-primary-400">K</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome to Kovarti PM</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Tell us about yourself to personalize your experience</p>
              </div>

              <form className="space-y-4" onSubmit={handleStep1Submit}>
                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                  </div>
                )}

                <div>
                  <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Full Name</label>
                  <input id="fullName" type="text" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)}
                    className="input" placeholder="John Doe" minLength={2} />
                </div>

                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Username</label>
                  <input id="username" type="text" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    className="input" placeholder="johndoe" minLength={3} pattern="[a-zA-Z0-9_]+" />
                  <p className="text-xs text-gray-400 mt-1">Letters, numbers, and underscores only</p>
                </div>

                <div>
                  <label htmlFor="organizationName" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Organization Name <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input id="organizationName" type="text" autoComplete="organization" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)}
                    className="input" placeholder="Your company name" />
                </div>

                {/* Role selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Your Role</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {ROLE_OPTIONS.map((role) => {
                      const Icon = role.icon;
                      const selected = selectedRole === role.value;
                      return (
                        <button
                          key={role.value}
                          type="button"
                          onClick={() => setSelectedRole(role.value)}
                          className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-all ${
                            selected
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                              : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${selected ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400'}`} />
                          <span className={`text-xs font-medium ${selected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-300'}`}>{role.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Methodology */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Preferred Methodology</label>
                  <div className="grid grid-cols-3 gap-2">
                    {METHODOLOGY_OPTIONS.map((m) => {
                      const selected = methodology === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => setMethodology(m.value)}
                          className={`rounded-xl border-2 p-3 text-center transition-all ${
                            selected
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                              : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        >
                          <span className={`text-sm font-medium block ${selected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-300'}`}>{m.label}</span>
                          <span className="text-[10px] text-gray-400 mt-0.5 block">{m.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button type="submit" disabled={isLoading || !fullName.trim() || !username.trim()}
                  className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {isLoading ? (
                    <div className="flex items-center">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Saving...
                    </div>
                  ) : (
                    <>Continue <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </form>
            </>
          )}

          {/* Step 2: First Project (optional) */}
          {step === 2 && (
            <>
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create your first project</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Pick a template to get started quickly, or skip and create one later
                </p>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              {filteredTemplates.length > 0 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {filteredTemplates.map((tmpl) => {
                      const selected = selectedTemplate === tmpl.id;
                      return (
                        <button
                          key={tmpl.id}
                          type="button"
                          onClick={() => setSelectedTemplate(tmpl.id)}
                          className={`rounded-xl border-2 p-4 text-left transition-all ${
                            selected
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                              : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        >
                          <span className={`text-sm font-medium block ${selected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-200'}`}>
                            {tmpl.name}
                          </span>
                          {tmpl.description && (
                            <span className="text-xs text-gray-400 mt-1 block line-clamp-2">{tmpl.description}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {selectedTemplate && (
                    <div>
                      <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Project Name</label>
                      <input
                        id="projectName"
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        className="input"
                        placeholder="My First Project"
                      />
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="flex items-center gap-1 px-4 py-2.5 text-sm font-medium rounded-lg text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateProject}
                      disabled={isLoading || !selectedTemplate || !projectName.trim()}
                      className="flex-1 flex justify-center items-center gap-2 py-2.5 px-4 text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isLoading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>Create &amp; Continue <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">No templates available yet. You can create a project from the dashboard.</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleSkipProject}
                className="w-full mt-3 flex justify-center items-center gap-1.5 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                <SkipForward className="w-4 h-4" /> I'll create a project later
              </button>
            </>
          )}

          {/* Step 3: Done */}
          {step === 3 && (() => {
            const trialEnd = user?.trialEndsAt ? new Date(user.trialEndsAt) : null;
            const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 14;
            return (
              <div className="text-center py-4">
                <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">You're all set!</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {createdProjectId
                    ? 'Your project is ready. Dive in and start planning.'
                    : 'Your profile is set up. Head to the dashboard to get started.'}
                </p>

                {user?.subscriptionTier === 'trial' && (
                  <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg p-4 mb-6 text-left">
                    <p className="text-sm font-medium text-primary-800 dark:text-primary-300">
                      Your 14-day free trial is active
                    </p>
                    <p className="text-xs text-primary-600 dark:text-primary-400 mt-1">
                      You have {daysLeft} days to explore all Pro features — AI analysis, Gantt charts, reports, and more. No credit card required.
                    </p>
                  </div>
                )}

                {createdProjectId ? (
                  <button
                    onClick={() => navigate(`/project/${createdProjectId}`, { replace: true })}
                    className="w-full flex justify-center items-center gap-2 py-2.5 px-4 text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 transition-colors"
                  >
                    Go to your project <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('/dashboard', { replace: true })}
                    className="w-full flex justify-center items-center gap-2 py-2.5 px-4 text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 transition-colors"
                  >
                    Go to Dashboard <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
