import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from './components/LoginPage';
import { useAuth } from './auth/authState';
import AppShell from './components/AppShell';
import EventsPage from './features/events/EventsPage';
import EventFormPage from './features/events/EventFormPage';
import EventDetailPage from './features/events/EventDetailPage';
import LandingPage from './components/LandingPage';
import SignUpPage from './components/SignUpPage';

function ProtectedRoutes() {
  const { user, isBootstrapping } = useAuth();
  const location = useLocation();
  if (isBootstrapping) return <main className="center-state" aria-live="polite"><span className="spinner" />Restoring your secure session…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <AppShell><Outlet /></AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route element={<ProtectedRoutes />}>
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/new" element={<EventFormPage mode="create" />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/events/:eventId/edit" element={<EventFormPage mode="edit" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
