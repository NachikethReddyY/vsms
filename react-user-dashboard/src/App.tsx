import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { RoleGuard } from './auth/RoleGuard';
import AppShell from './components/AppShell';
import LandingPage from './components/LandingPage';
import QRCodePage from './components/qr/QRCodePage';
import SettingsPage from './components/SettingsPage';
import SignUpPage from './components/SignUpPage';
import TestHomePage from './components/TestHomePage';
import AuditLogsPage from './features/audit-logs/AuditLogsPage';
import EventDetailPage from './features/events/EventDetailPage';
import EventFormPage from './features/events/EventFormPage';
import ReviewWorkspacePage from './features/reviews/ReviewWorkspacePage';
import ColourVisionStationPage from './features/screening/ColourVisionStationPage';
import RefractionStationPage from './features/screening/RefractionStationPage';
import VisualAcuityStationPage from './features/screening/VisualAcuityStationPage';
import { AuditLogsPage as RegistrationAuditLogsPage } from './pages/AdminPages';
import { LoginPage } from './pages/AuthPages';
import { QueuePage } from './pages/QueuePages';
import ParticipantV2Page from './pages/ParticipantV2Page';
import ParticipantV2ConsentPage from './pages/ParticipantV2ConsentPage';
import ParticipantV2ProfilePage from './pages/ParticipantV2ProfilePage';
import {
  ConsentPage,
  EmergencyContactsPage,
  EventRegistrationStartPage,
  EventRegistrationsPage,
  ParticipantConsentsPage,
  ParticipantCreatePage,
  ParticipantDetailPage,
  ParticipantEditPage,
  ParticipantHistoryPage,
  ParticipantSearchPage,
  RegistrationConfirmationPage,
  RegistrationHistoryPage,
  RegistrationQrPage,
  RegistrationReviewPage,
} from './pages/ParticipantPages';

function ShellRoutes() {
  return <AppShell><Outlet /></AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Navigate to="/events" replace />} />
        <Route path="/events" element={<TestHomePage />} />

        <Route element={<ShellRoutes />}>
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/events/:eventId/stations/visual-acuity" element={<VisualAcuityStationPage />} />
          <Route path="/events/:eventId/stations/refraction" element={<RefractionStationPage />} />
          <Route path="/events/:eventId/stations/colour-vision" element={<ColourVisionStationPage />} />
          <Route path="/events/:eventId/queue" element={<QueuePage />} />
          <Route path="/events/:eventId/reviews" element={<ReviewWorkspacePage />} />
          <Route path="/events/:eventId/reviews/:registrationId" element={<ReviewWorkspacePage />} />
          <Route path="/qr-generator" element={<QRCodePage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route path="/participants" element={<ParticipantSearchPage />} />
          <Route path="/participants/search" element={<ParticipantSearchPage />} />
          <Route path="/participants-v2" element={<ParticipantV2Page />} />
          <Route path="/participants-v2/:participantId" element={<ParticipantV2ProfilePage />} />
          <Route path="/participants-v2/:participantId/consent" element={<ParticipantV2ConsentPage />} />
          <Route path="/participants/new" element={<ParticipantCreatePage />} />
          <Route path="/participants/:participantId" element={<ParticipantDetailPage />} />
          <Route path="/participants/:participantId/edit" element={<ParticipantEditPage />} />
          <Route path="/participants/:participantId/history" element={<ParticipantHistoryPage />} />
          <Route path="/participants/:participantId/consents" element={<ParticipantConsentsPage />} />
          <Route path="/participants/:participantId/emergency-contacts" element={<EmergencyContactsPage />} />
          <Route path="/events/:eventId/register" element={<EventRegistrationStartPage />} />
          <Route path="/events/:eventId/registrations" element={<EventRegistrationsPage />} />
          <Route path="/registrations/:registrationId/review" element={<RegistrationReviewPage />} />
          <Route path="/registrations/:registrationId/consent" element={<ConsentPage />} />
          <Route path="/registrations/:registrationId/confirmation" element={<RegistrationConfirmationPage />} />
          <Route path="/registrations/:registrationId/history" element={<RegistrationHistoryPage />} />
          <Route path="/registrations/:registrationId/qr" element={<RegistrationQrPage />} />

          <Route element={<RoleGuard allowedRoles={['ADMINISTRATOR', 'EVENT_MANAGER']} />}>
            <Route path="/events/new" element={<EventFormPage mode="create" />} />
            <Route path="/events/:eventId/edit" element={<EventFormPage mode="edit" />} />
          </Route>
          <Route element={<RoleGuard allowedRoles={['ADMINISTRATOR']} />}>
            <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
            <Route path="/admin/system-audit-logs" element={<RegistrationAuditLogsPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
