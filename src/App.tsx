
import { Routes, Route, Navigate } from "react-router-dom";

// Import authentication pages.
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";

// Import application pages.
import DashboardPage from "./pages/DashboardPage";
import RepositoriesPage from "./pages/RepositoriesPage";
import PipelinesPage from "./pages/PipelinesPage";

// Import the new GitHub Activity Audit page.
import ActivityAuditPage from "./pages/ActivityAuditPage";
import TeamsPage from "./pages/TeamsPage";

// Protect pages that require user login.
import ProtectedRoute from "./components/auth/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      {/* Redirect the homepage to login. */}
      <Route
        path="/"
        element={<Navigate to="/login" replace />}
      />

      {/* Public pages do not require login. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* Show dashboard only to authenticated users. */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      {/* Show GitHub repositories after login. */}
      <Route
        path="/repositories"
        element={
          <ProtectedRoute>
            <RepositoriesPage />
          </ProtectedRoute>
        }
      />

      {/* Show CI/CD pipelines after login. */}
      <Route
        path="/pipelines"
        element={
          <ProtectedRoute>
            <PipelinesPage />
          </ProtectedRoute>
        }
      />

      {/* NEW: Show GitHub Activity Audit after login. */}
      <Route
        path="/activity"
        element={
          <ProtectedRoute>
            <ActivityAuditPage />
          </ProtectedRoute>
        }
      />

      {/* Show team workspaces after login. */}
      <Route
        path="/teams"
        element={
          <ProtectedRoute>
            <TeamsPage />
          </ProtectedRoute>
        }
      />

      {/* Redirect unknown URLs to login. */}
      <Route
        path="*"
        element={<Navigate to="/login" replace />}
      />
    </Routes>
  );
}
