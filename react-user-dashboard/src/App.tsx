import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RoleGuard } from "./auth/RoleGuard";
import {
  AccountSecurityPage,
  CognitoTestPage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignUpPage,
  VerifySignUpPage,
} from "./pages/AuthPages";
import { AuditLogsPage } from "./pages/AdminPages";
import { DashboardPage } from "./pages/DashboardPage";
import {
  ConsentPage,
  EmergencyContactsPage,
  EventRegistrationStartPage,
  ParticipantCreatePage,
  ParticipantDetailPage,
  ParticipantEditPage,
  ParticipantHistoryPage,
  ParticipantSearchPage,
  RegistrationConfirmationPage,
  RegistrationReviewPage,
} from "./pages/ParticipantPages";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/verify-signup" element={<VerifySignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/cognito-test" element={<CognitoTestPage />} />
        <Route path="/events/:eventId/register" element={<EventRegistrationStartPage />} />
        <Route path="/participants/search" element={<ParticipantSearchPage />} />
        <Route path="/participants/new" element={<ParticipantCreatePage />} />
        <Route path="/participants/:participantId" element={<ParticipantDetailPage />} />
        <Route path="/participants/:participantId/edit" element={<ParticipantEditPage />} />
        <Route path="/participants/:participantId/emergency-contacts" element={<EmergencyContactsPage />} />
        <Route path="/events/:eventId/participants/:participantId/consent" element={<ConsentPage />} />
        <Route path="/events/:eventId/participants/:participantId/review" element={<RegistrationReviewPage />} />
        <Route path="/registrations/:registrationId/confirmation" element={<RegistrationConfirmationPage />} />
        <Route path="/participants/:participantId/history" element={<ParticipantHistoryPage />} />
        <Route path="/account/security" element={<AccountSecurityPage />} />

        <Route element={<RoleGuard allowedRoles={["ADMINISTRATOR"]} />}>
          <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
