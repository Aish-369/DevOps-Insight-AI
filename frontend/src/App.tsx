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
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

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
