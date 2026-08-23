import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ROUTES, ROUTE_PATTERNS } from './routes';
import { useAuthStore } from './stores/authStore';
import { ErrorBoundary, RouteErrorBoundary } from './components/ErrorBoundary';
import { AccessibilityProvider } from './contexts/AccessibilityContext';
import { apiService } from './services/api';
import AppLayout from './components/layout/AppLayout';

// Eagerly loaded (part of initial bundle — needed immediately)
import { LoginPage } from './pages/LoginPage';
import { LandingPage } from './pages/LandingPage';

const isPrelaunch = import.meta.env.VITE_PRELAUNCH === 'true';

// Lazy-loaded pages (split into separate chunks)
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const PricingPage = lazy(() => import('./pages/PricingPage').then(m => ({ default: m.PricingPage })));
const TermsPage = lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const UserGuidePublicPage = lazy(() => import('./pages/UserGuidePublicPage').then(m => ({ default: m.UserGuidePublicPage })));
const PrelaunchLandingPage = lazy(() => import('./pages/PrelaunchLandingPage').then(m => ({ default: m.PrelaunchLandingPage })));
const WaitlistAdminPage = lazy(() => import('./pages/WaitlistAdminPage').then(m => ({ default: m.WaitlistAdminPage })));
const PortalViewPage = lazy(() => import('./pages/PortalViewPage'));
const MyWorkPage = lazy(() => import('./pages/MyWorkPage'));
const DashboardPM = lazy(() => import('./pages/DashboardPM').then(m => ({ default: m.DashboardPM })));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage').then(m => ({ default: m.ProjectDetailPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const ScenarioModelingPage = lazy(() => import('./pages/ScenarioModelingPage').then(m => ({ default: m.ScenarioModelingPage })));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage').then(m => ({ default: m.PortfolioPage })));
const WorkflowPage = lazy(() => import('./pages/WorkflowPage').then(m => ({ default: m.WorkflowPage })));
const MonteCarloPage = lazy(() => import('./pages/MonteCarloPage').then(m => ({ default: m.MonteCarloPage })));
const MeetingMinutesPage = lazy(() => import('./pages/MeetingMinutesPage').then(m => ({ default: m.MeetingMinutesPage })));
const LessonsLearnedPage = lazy(() => import('./pages/LessonsLearnedPage').then(m => ({ default: m.LessonsLearnedPage })));
const QueryPage = lazy(() => import('./pages/QueryPage').then(m => ({ default: m.QueryPage })));
const AccountBillingPage = lazy(() => import('./pages/AccountBillingPage').then(m => ({ default: m.AccountBillingPage })));
const UserGuidePage = lazy(() => import('./pages/UserGuidePage').then(m => ({ default: m.UserGuidePage })));
const TimesheetPage = lazy(() => import('./pages/TimesheetPage').then(m => ({ default: m.TimesheetPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const ReportBuilderPage = lazy(() => import('./pages/ReportBuilderPage').then(m => ({ default: m.ReportBuilderPage })));
const IntakeFormsPage = lazy(() => import('./pages/IntakeFormsPage').then(m => ({ default: m.IntakeFormsPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminTenantsPage = lazy(() => import('./pages/admin/AdminTenantsPage').then(m => ({ default: m.AdminTenantsPage })));
const AdminSystemPage = lazy(() => import('./pages/admin/AdminSystemPage').then(m => ({ default: m.AdminSystemPage })));
const AdminAiUsagePage = lazy(() => import('./pages/admin/AdminAiUsagePage').then(m => ({ default: m.AdminAiUsagePage })));
const AdminAuditPage = lazy(() => import('./pages/admin/AdminAuditPage').then(m => ({ default: m.AdminAuditPage })));
const AdminOperationsPage = lazy(() => import('./pages/admin/AdminOperationsPage').then(m => ({ default: m.AdminOperationsPage })));
const AdminFeedbackPage = lazy(() => import('./pages/admin/AdminFeedbackPage').then(m => ({ default: m.AdminFeedbackPage })));
const AdminRevenuePage = lazy(() => import('./pages/admin/AdminRevenuePage').then(m => ({ default: m.AdminRevenuePage })));
const AdminPricingPage = lazy(() => import('./pages/admin/AdminPricingPage').then(m => ({ default: m.AdminPricingPage })));
const AdminSchedulesPage = lazy(() => import('./pages/admin/AdminSchedulesPage').then(m => ({ default: m.AdminSchedulesPage })));
const AgentProposalsPage = lazy(() => import('./pages/AgentProposalsPage').then(m => ({ default: m.AgentProposalsPage })));
const ChangeRequestsPage = lazy(() => import('./pages/ChangeRequestsPage').then(m => ({ default: m.ChangeRequestsPage })));
const GoalsPage = lazy(() => import('./pages/GoalsPage').then(m => ({ default: m.GoalsPage })));
const ResourceManagementPage = lazy(() => import('./pages/ResourceManagementPage').then(m => ({ default: m.ResourceManagementPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then(m => ({ default: m.NotificationsPage })));
const EVMDashboardPage = lazy(() => import('./pages/EVMDashboardPage').then(m => ({ default: m.EVMDashboardPage })));
const KPIDrillInPage = lazy(() => import('./pages/KPIDrillInPage').then(m => ({ default: m.KPIDrillInPage })));
const ProjectsPM = lazy(() => import('./pages/ProjectsPM').then(m => ({ default: m.ProjectsPM })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  );
}

function PrivateRoute({ children, skipOnboardingCheck, requiredRole }: { children: React.ReactNode; skipOnboardingCheck?: boolean; requiredRole?: string }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!skipOnboardingCheck && !user?.fullName) return <Navigate to="/onboarding" replace />;
  if (requiredRole && user?.role !== requiredRole) return <Navigate to="/dashboard" replace />;
  return <AppLayout><RouteErrorBoundary>{children}</RouteErrorBoundary></AppLayout>;
}

function App() {
  const { isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();

  useEffect(() => {
    // Hydrate auth from cookies on mount (handles page refresh + verify-login redirect)
    apiService.getMe()
      .then((data) => {
        if (data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {
        // Not authenticated — clear any stale state
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">Loading application…</p>
        </div>
      </div>
    );
  }

  return (
    <AccessibilityProvider>
    <Router>
      <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes */}
        <Route path={ROUTES.home} element={isAuthenticated ? <Navigate to={ROUTES.myWork} replace /> : (isPrelaunch ? <PrelaunchLandingPage /> : <LandingPage />)} />
        <Route path={ROUTES.login} element={isPrelaunch && !isAuthenticated ? <Navigate to={ROUTES.home} replace /> : (isAuthenticated ? <Navigate to={ROUTES.myWork} replace /> : <LoginPage />)} />
        <Route path={ROUTES.register} element={isPrelaunch && !isAuthenticated ? <Navigate to={ROUTES.home} replace /> : (isAuthenticated ? <Navigate to={ROUTES.myWork} replace /> : <RegisterPage />)} />
        <Route path={ROUTES.verifyEmail} element={<VerifyEmailPage />} />
        <Route path={ROUTES.forgotPassword} element={isPrelaunch ? <Navigate to={ROUTES.home} replace /> : <ForgotPasswordPage />} />
        <Route path={ROUTES.resetPassword} element={isPrelaunch ? <Navigate to={ROUTES.home} replace /> : <ResetPasswordPage />} />
        <Route path={ROUTES.pricing} element={isPrelaunch ? <Navigate to={ROUTES.home} replace /> : <PricingPage />} />
        <Route path={ROUTES.terms} element={<TermsPage />} />
        <Route path={ROUTES.privacy} element={<PrivacyPage />} />
        <Route path={ROUTES.guide} element={<UserGuidePublicPage />} />
        <Route path={ROUTES.waitlistAdmin} element={<WaitlistAdminPage />} />
        <Route path={ROUTE_PATTERNS.portal} element={<PortalViewPage />} />
        <Route path={ROUTES.onboarding} element={isAuthenticated ? <OnboardingPage /> : <Navigate to={ROUTES.login} replace />} />

        {/* Protected routes */}
        <Route path={ROUTES.myWork} element={<PrivateRoute><MyWorkPage /></PrivateRoute>} />
        <Route path={ROUTES.dashboard} element={<PrivateRoute><DashboardPM /></PrivateRoute>} />
        <Route path={ROUTES.projects} element={<PrivateRoute><ProjectsPM /></PrivateRoute>} />
        <Route path={ROUTE_PATTERNS.project} element={<PrivateRoute><ProjectDetailPage /></PrivateRoute>} />
        <Route path={ROUTES.reports} element={<PrivateRoute><ReportsPage /></PrivateRoute>} />
        <Route path={ROUTES.scenarios} element={<PrivateRoute><ScenarioModelingPage /></PrivateRoute>} />
        <Route path={ROUTES.portfolio} element={<PrivateRoute><PortfolioPage /></PrivateRoute>} />
        <Route path={ROUTES.analytics} element={<PrivateRoute><AnalyticsPage /></PrivateRoute>} />
        <Route path={ROUTES.workflows} element={<PrivateRoute><WorkflowPage /></PrivateRoute>} />
        <Route path={ROUTES.monteCarlo} element={<PrivateRoute><MonteCarloPage /></PrivateRoute>} />
        <Route path={ROUTES.meetings} element={<PrivateRoute><MeetingMinutesPage /></PrivateRoute>} />
        <Route path={ROUTES.lessons} element={<PrivateRoute><LessonsLearnedPage /></PrivateRoute>} />
        <Route path={ROUTES.timesheet} element={<PrivateRoute><TimesheetPage /></PrivateRoute>} />
        <Route path={ROUTES.query} element={<PrivateRoute><QueryPage /></PrivateRoute>} />
        <Route path={ROUTES.account} element={<PrivateRoute><AccountBillingPage /></PrivateRoute>} />
        <Route path={ROUTES.integrations} element={<PrivateRoute><IntegrationsPage /></PrivateRoute>} />
        <Route path={ROUTES.reportBuilder} element={<PrivateRoute><ReportBuilderPage /></PrivateRoute>} />
        <Route path={ROUTES.intake} element={<PrivateRoute><IntakeFormsPage /></PrivateRoute>} />
        <Route path={ROUTES.help} element={<PrivateRoute><UserGuidePage /></PrivateRoute>} />
        <Route path={ROUTES.settings} element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
        <Route path={ROUTES.changeRequests} element={<PrivateRoute><ChangeRequestsPage /></PrivateRoute>} />
        <Route path={ROUTES.goals} element={<PrivateRoute><GoalsPage /></PrivateRoute>} />
        <Route path={ROUTES.notifications} element={<PrivateRoute><NotificationsPage /></PrivateRoute>} />
        <Route path={ROUTES.resources} element={<PrivateRoute><ResourceManagementPage /></PrivateRoute>} />
        <Route path={ROUTES.evm} element={<PrivateRoute><EVMDashboardPage /></PrivateRoute>} />
        <Route path={ROUTE_PATTERNS.kpi} element={<PrivateRoute><KPIDrillInPage /></PrivateRoute>} />
        <Route path={ROUTES.agent} element={<PrivateRoute><AgentProposalsPage /></PrivateRoute>} />
        <Route path={ROUTES.adminUsers} element={<PrivateRoute requiredRole="admin"><AdminUsersPage /></PrivateRoute>} />
        <Route path={ROUTES.adminTenants} element={<PrivateRoute requiredRole="admin"><AdminTenantsPage /></PrivateRoute>} />
        <Route path={ROUTES.adminSystem} element={<PrivateRoute requiredRole="admin"><AdminSystemPage /></PrivateRoute>} />
        <Route path={ROUTES.adminAiUsage} element={<PrivateRoute requiredRole="admin"><AdminAiUsagePage /></PrivateRoute>} />
        <Route path={ROUTES.adminAudit} element={<PrivateRoute requiredRole="admin"><AdminAuditPage /></PrivateRoute>} />
        <Route path={ROUTES.adminOperations} element={<PrivateRoute requiredRole="admin"><AdminOperationsPage /></PrivateRoute>} />
        <Route path={ROUTES.adminFeedback} element={<PrivateRoute requiredRole="admin"><AdminFeedbackPage /></PrivateRoute>} />
        <Route path={ROUTES.adminRevenue} element={<PrivateRoute requiredRole="admin"><AdminRevenuePage /></PrivateRoute>} />
        <Route path={ROUTES.adminPricing} element={<PrivateRoute requiredRole="admin"><AdminPricingPage /></PrivateRoute>} />
        <Route path={ROUTES.adminSchedules} element={<PrivateRoute requiredRole="admin"><AdminSchedulesPage /></PrivateRoute>} />
        <Route path={ROUTES.admin} element={<Navigate to={ROUTES.adminUsers} replace />} />

        {/* Catch-all */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </Router>
    </AccessibilityProvider>
  );
}

export default App;
