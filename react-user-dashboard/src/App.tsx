import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from './components/LoginPage';
import { useAuth } from './auth/authState';
import AppShell from './components/AppShell';
import EventsPage from './features/events/EventsPage';
import EventFormPage from './features/events/EventFormPage';
import EventDetailPage from './features/events/EventDetailPage';
import LandingPage from './components/LandingPage';
import SignUpPage from './components/SignUpPage';
import ForgotPasswordPage from './components/ForgotPasswordPage';
import DashboardPage from './components/DashboardPage';
import QRCodePage from './components/qr/QRCodePage';
import VisualAcuityStationPage from './features/screening/VisualAcuityStationPage';
import AuditLogsPage from './features/audit-logs/AuditLogsPage';
import ReviewWorkspacePage from './features/reviews/ReviewWorkspacePage';

function ProtectedRoutes({ withShell = true }: { withShell?: boolean }) {
  const { user, isBootstrapping } = useAuth();
  const location = useLocation();
  if (isBootstrapping) return <main className="center-state" aria-live="polite"><span className="spinner" />Restoring your secure session…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return withShell ? <AppShell><Outlet /></AppShell> : <Outlet />;
}

function ManagerOnlyRoutes() {
  const { user } = useAuth();
  const canManageEvents = user?.systemRole === 'ADMIN' || user?.systemRole === 'EVENT_MANAGER';
  if (!canManageEvents) return <Navigate to="/events" replace />;
  return <Outlet />;
}

function AdminOnlyRoutes() {
  const { user } = useAuth();
  const isAdmin = user?.systemRole === 'ADMIN';
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      
      <Route element={<ProtectedRoutes />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/events" element={<EventsPage />} />
        
        <Route element={<ManagerOnlyRoutes />}>
          <Route path="/events/new" element={<EventFormPage mode="create" />} />
          <Route path="/events/:eventId/edit" element={<EventFormPage mode="edit" />} />
        </Route>

        <Route path="/events/:eventId" element={<EventDetailPage />} />
        
        <Route path="/events/:eventId/stations/visual-acuity" element={<VisualAcuityStationPage />} />
        <Route path="/events/qr-pass/:registrationId" element={<QRCodePage />} />

        <Route element={<AdminOnlyRoutes />}>
          <Route path="/audit-logs" element={<AuditLogsPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoutes withShell={false} />}>
        <Route path="/events/:eventId/reviews" element={<ReviewWorkspacePage />} />
        <Route path="/events/:eventId/reviews/:registrationId" element={<ReviewWorkspacePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
