import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import AppShell from "./components/AppShell";
import LandingPage from "./components/LandingPage";
import QRCodePage from "./components/qr/QRCodePage";
import AuditLogsPage from "./features/audit-logs/AuditLogsPage";
import EventDetailPage from "./features/events/EventDetailPage";
import EventFormPage from "./features/events/EventFormPage";
import EventsPage from "./features/events/EventsPage";
import ReviewWorkspacePage from "./features/reviews/ReviewWorkspacePage";
import VisualAcuityStationPage from "./features/screening/VisualAcuityStationPage";
import { AuditLogsPage as RegistrationAuditLogsPage } from "./pages/AdminPages";
import {
  AccountSecurityPage,
  AuthCallbackPage,
  CognitoTestPage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
} from "./pages/AuthPages";
import { DashboardPage } from "./pages/DashboardPage";
import { QueuePage } from "./pages/QueuePages"; // Imported the QueuePage component
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
} from "./pages/ParticipantPages";

// Unprotected Layout wrapper that keeps the AppShell visible for UI design/testing
function DevLayoutRoutes() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public / Auth Pages */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/cognito-test" element={<CognitoTestPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Standalone QR Code Route */}
      <Route path="/events/qr-pass/:registrationId" element={<QRCodePage />} />

      {/* Development Mode: All routes temporarily unprotected but wrapped in AppShell */}
      <Route element={<DevLayoutRoutes />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/account/security" element={<AccountSecurityPage />} />

        {/* Events Management */}
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/new" element={<EventFormPage mode="create" />} />
        <Route path="/events/:eventId/edit" element={<EventFormPage mode={"create"} />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/events/:eventId/stations/visual-acuity" element={<VisualAcuityStationPage />} />

        {/* Live Queue Route Added */}
        <Route path="/events/:eventId/queue" element={<QueuePage />} />

        {/* Participant & Registration Workflows */}
        <Route path="/participants" element={<ParticipantSearchPage />} />
        <Route path="/participants/search" element={<ParticipantSearchPage />} />
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

        {/* Admin Features */}
        <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
        <Route path="/admin/system-audit-logs" element={<RegistrationAuditLogsPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/events/:eventId/reviews" element={<ReviewWorkspacePage />} />
        <Route path="/events/:eventId/reviews/:registrationId" element={<ReviewWorkspacePage />} />
      </Route>

      {/* Fallback Catch-all Route */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
