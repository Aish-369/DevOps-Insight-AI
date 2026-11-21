
import { Routes, Route, Navigate } from "react-router-dom";

// Import authentication pages.
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";

// Import application pages.
import DashboardPage from "./pages/DashboardPage";
import RepositoriesPage from "./pages/RepositoriesPage";
import PipelinesPage from "./pages/PipelinesPage";
import ActivityAuditPage from "./pages/ActivityAuditPage";
import TeamsPage from "./pages/TeamsPage";

// Protect pages that require user login.
import ProtectedRoute from "./components/auth/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      {/* Redirect homepage to login. */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Public routes. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* Protected dashboard route. */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      {/* GitHub repositories route. */}
      <Route
        path="/repositories"
        element={
          <ProtectedRoute>
            <RepositoriesPage />
          </ProtectedRoute>
        }
      />

      {/* CI/CD pipelines route. */}
      <Route
        path="/pipelines"
        element={
          <ProtectedRoute>
            <PipelinesPage />
          </ProtectedRoute>
        }
      />

      {/* GitHub activity audit route. */}
      <Route
        path="/activity"
        element={
          <ProtectedRoute>
            <ActivityAuditPage />
          </ProtectedRoute>
        }
      />

      {/* Teams and workspaces route. */}
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
