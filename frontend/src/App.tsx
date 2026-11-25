import { Routes, Route, Navigate } from "react-router-dom";

// Import authentication pages.
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import AccountSettingsPage from "./pages/AccountSettingsPage";

// Import application pages.
import DashboardPage from "./pages/DashboardPage";
import RepositoriesPage from "./pages/RepositoriesPage";
import PipelinesPage from "./pages/PipelinesPage";
import ActivityAuditPage from "./pages/ActivityAuditPage";
import TeamsPage from "./pages/TeamsPage";
import AcceptInvitationPage from "./pages/AcceptInvitationPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import GithubInstallationCallbackPage from "./pages/GithubInstallationCallbackPage";
import WorkflowRunsPage from "./pages/WorkflowRunsPage";
import AlertsSettingsPage from "./pages/AlertsSettingsPage";

// Protect pages that require user login.
import ProtectedRoute from "./components/auth/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

      <Route path="/integrations" element={<ProtectedRoute><IntegrationsPage /></ProtectedRoute>} />
      <Route path="/integrations/github/callback" element={<ProtectedRoute><GithubInstallationCallbackPage /></ProtectedRoute>} />

      <Route path="/workflow-runs" element={<ProtectedRoute><WorkflowRunsPage /></ProtectedRoute>} />
      <Route path="/settings/alerts" element={<ProtectedRoute><AlertsSettingsPage /></ProtectedRoute>} />

      <Route
        path="/settings/account"
        element={<ProtectedRoute><AccountSettingsPage /></ProtectedRoute>}
      />

      <Route
        path="/dashboard"
        element={<ProtectedRoute><DashboardPage /></ProtectedRoute>}
      />

      <Route
        path="/repositories"
        element={<ProtectedRoute><RepositoriesPage /></ProtectedRoute>}
      />

      <Route
        path="/pipelines"
        element={<ProtectedRoute><PipelinesPage /></ProtectedRoute>}
      />

      <Route
        path="/activity"
        element={<ProtectedRoute><ActivityAuditPage /></ProtectedRoute>}
      />

      {/* Teams and Workspaces page. */}
      <Route
        path="/teams"
        element={<ProtectedRoute><TeamsPage /></ProtectedRoute>}
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
