import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RoleGuard } from "./auth/RoleGuard";
import {
  AccountSecurityPage,
  AuthCallbackPage,
  CognitoTestPage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
} from "./pages/AuthPages";
import { AuditLogsPage } from "./pages/AdminPages";
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

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/account/security" element={<AccountSecurityPage />} />
        <Route path="/cognito-test" element={<CognitoTestPage />} />

        <Route element={<RoleGuard allowedRoles={registrationRoles} />}>
          <Route path="/dashboard" element={<DashboardPage />} />
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
          <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
