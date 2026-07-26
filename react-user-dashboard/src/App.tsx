import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RoleGuard } from "./auth/RoleGuard";
import MainAppShell from "./components/AppShell";
import LandingPage from "./components/LandingPage";
import QRCodePage from "./components/qr/QRCodePage";
import AuditLogsPage from "./features/audit-logs/AuditLogsPage";
import EventDetailPage from "./features/events/EventDetailPage";
import EventFormPage from "./features/events/EventFormPage";
import EventsPage from "./features/events/EventsPage";
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

const registrationRoles = ["ADMINISTRATOR", "REGISTRATION_OFFICER"];
const eventManagerRoles = ["ADMINISTRATOR", "EVENT_MANAGER"];

function EventWorkspace() {
  return <MainAppShell><Outlet /></MainAppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/account/security" element={<AccountSecurityPage />} />
        <Route path="/cognito-test" element={<CognitoTestPage />} />

        <Route element={<EventWorkspace />}>
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/events/:eventId/stations/visual-acuity" element={<VisualAcuityStationPage />} />
          <Route path="/events/qr-pass/:registrationId" element={<QRCodePage />} />
          <Route element={<RoleGuard allowedRoles={eventManagerRoles} />}>
            <Route path="/events/new" element={<EventFormPage mode="create" />} />
            <Route path="/events/:eventId/edit" element={<EventFormPage mode="edit" />} />
          </Route>
          <Route element={<RoleGuard allowedRoles={["ADMINISTRATOR"]} />}>
            <Route path="/audit-logs" element={<AuditLogsPage />} />
          </Route>
        </Route>

        <Route element={<RoleGuard allowedRoles={registrationRoles} />}>
          <Route path="/events/:eventId/register" element={<EventRegistrationStartPage />} />
          <Route path="/events/:eventId/registrations" element={<EventRegistrationsPage />} />
          <Route path="/participants/search" element={<ParticipantSearchPage />} />
          <Route path="/participants/new" element={<ParticipantCreatePage />} />
          <Route path="/participants/:participantId" element={<ParticipantDetailPage />} />
          <Route path="/participants/:participantId/edit" element={<ParticipantEditPage />} />
          <Route path="/participants/:participantId/emergency-contacts" element={<EmergencyContactsPage />} />
          <Route path="/participants/:participantId/consents" element={<ParticipantConsentsPage />} />
          <Route path="/events/:eventId/participants/:participantId/consent" element={<ConsentPage />} />
          <Route path="/events/:eventId/participants/:participantId/review" element={<RegistrationReviewPage />} />
          <Route path="/registrations/:registrationId/confirmation" element={<RegistrationConfirmationPage />} />
          <Route path="/registrations/:registrationId/history" element={<RegistrationHistoryPage />} />
          <Route path="/registrations/:registrationId/qr" element={<RegistrationQrPage />} />
          <Route path="/participants/:participantId/history" element={<ParticipantHistoryPage />} />
        </Route>

        <Route element={<RoleGuard allowedRoles={["ADMINISTRATOR"]} />}>
          <Route path="/admin/audit-logs" element={<RegistrationAuditLogsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
