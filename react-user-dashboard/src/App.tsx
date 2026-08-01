import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from './components/LoginPage';
import { useAuth } from './auth/authState';
import AppShell from './components/AppShell';
import EventFormPage from './features/events/EventFormPage';
import EventDetailPage from './features/events/EventDetailPage';
import LandingPage from './components/LandingPage';
import SignUpPage from './components/SignUpPage';
import QRCodePage from './components/qr/QRCodePage';
import TestHomePage from './components/TestHomePage';
import SettingsPage from './components/SettingsPage';

function ProtectedRoutes() {
  const { user, isBootstrapping, bootstrapError, retrySession } = useAuth();
  const location = useLocation();
  if (isBootstrapping) return <main className="center-state" aria-live="polite"><span className="spinner" />Restoring your secure session…</main>;
  if (bootstrapError) return <main className="center-state" role="alert"><p>{bootstrapError}</p><button className="primary" onClick={retrySession}>Try again</button></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

function ManagerRoutes() {
  const { user } = useAuth();
  if (!user || !['ADMIN', 'EVENT_MANAGER'].includes(user.systemRole)) return <main className="center-state permission-state"><h1>Manager access required</h1><p>Your account can view assigned event work, but it cannot change event setup.</p><Link className="secondary" to="/events">Return to events</Link></main>;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route element={<ProtectedRoutes />}>
        <Route path="/dashboard" element={<Navigate to="/events" replace />} />
        <Route path="/events" element={<TestHomePage />} />
        <Route element={<AppShell><Outlet /></AppShell>}>
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/qr-generator" element={<QRCodePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<ManagerRoutes />}>
            <Route path="/events/new" element={<EventFormPage mode="create" />} />
            <Route path="/events/:eventId/edit" element={<EventFormPage mode="edit" />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
