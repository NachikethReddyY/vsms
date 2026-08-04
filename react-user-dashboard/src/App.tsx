import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RoleGuard } from "./auth/RoleGuard";
import { CognitoCallback } from "./auth/CognitoRoutes";
import AppShell from "./components/AppShell";
import LandingPage from "./components/LandingPage";
import SettingsPage from "./components/SettingsPage";
import EventsPage from "./components/EventsPage";
import QRCodePage from "./components/qr/QRCodePage";
import EventDetailPage from "./features/events/EventDetailPage";
import EventFormPage from "./features/events/EventFormPage";
import PublicEventPage from "./features/events/PublicEventPage";
import ReviewWorkspacePage from "./features/reviews/ReviewWorkspacePage";
import ReportsPage from "./features/reports/ReportsPage";
import ColourVisionStationPage from "./features/screening/ColourVisionStationPage";
import RefractionStationPage from "./features/screening/RefractionStationPage";
import VisualAcuityStationPage from "./features/screening/VisualAcuityStationPage";
import { AuditLogsPage as RegistrationAuditLogsPage } from "./pages/AdminPages";
import AccountSecurityPage from "./pages/AccountSecurityPage";
import StaffAccountsPage from "./pages/StaffAccountsPage";
import { QueuePage } from "./pages/QueuePages"; // Imported the QueuePage component
import ParticipantV2CheckInPage from "./pages/ParticipantV2CheckInPage";
import ParticipantV2ConsentPage from "./pages/ParticipantV2ConsentPage";
import ParticipantV2CreatePage from "./pages/ParticipantV2CreatePage";
import ParticipantV2Page from "./pages/ParticipantV2Page";
import ParticipantV2ProfilePage from "./pages/ParticipantV2ProfilePage";
import ParticipantV2RegistrationPage from "./pages/ParticipantV2RegistrationPage";
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

const adminRoles = ["ADMINISTRATOR"];
const eventManagerRoles = ["ADMINISTRATOR", "EVENT_MANAGER"];
const registrationRoles = ["REGISTRATION_OFFICER"];
const screenerRoles = ["SCREENER"];
const reviewerRoles = ["REVIEWER"];

function EventWorkspace() {
  return <AppShell><Outlet /></AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<CognitoCallback />} />
      <Route path="/e/:eventId" element={<PublicEventPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Navigate to="/events" replace />} />
        <Route path="/events" element={<EventsPage />} />

        <Route element={<EventWorkspace />}>
          <Route path="/account/security" element={<AccountSecurityPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route element={<RoleGuard allowedRoles={eventManagerRoles} />}>
            <Route path="/events/:eventId/overview" element={<EventDetailPage />} />
            <Route path="/events/:eventId/stations" element={<EventDetailPage />} />
            <Route path="/events/:eventId/staff" element={<EventDetailPage />} />
            <Route path="/events/:eventId/attendees" element={<EventDetailPage />} />
            <Route path="/events/:eventId/activity" element={<EventDetailPage />} />
          </Route>

          <Route element={<RoleGuard allowedRoles={reviewerRoles} deniedRoles={adminRoles} />}>
            <Route path="/events/:eventId/reviews" element={<ReviewWorkspacePage />} />
            <Route path="/events/:eventId/reviews/:registrationId" element={<ReviewWorkspacePage />} />
          </Route>

          <Route element={<RoleGuard allowedRoles={screenerRoles} deniedRoles={adminRoles} />}>
            <Route path="/events/:eventId/stations/visual-acuity" element={<VisualAcuityStationPage />} />
            <Route path="/events/:eventId/stations/refraction" element={<RefractionStationPage />} />
            <Route path="/events/:eventId/stations/colour-vision" element={<ColourVisionStationPage />} />
          </Route>

          <Route element={<RoleGuard allowedRoles={eventManagerRoles} />}>
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/events/new" element={<EventFormPage mode="create" />} />
            <Route path="/events/:eventId/edit" element={<EventFormPage mode="edit" />} />
          </Route>

          <Route element={<RoleGuard allowedRoles={registrationRoles} deniedRoles={adminRoles} />}>
            <Route path="/events/:eventId/queue" element={<QueuePage />} />
            <Route path="/events/qr-pass/:registrationId" element={<QRCodePage />} />
            <Route path="/qr-generator" element={<QRCodePage />} />
            <Route path="/participants" element={<Navigate to="/participants/search" replace />} />
            <Route path="/participants/search" element={<ParticipantSearchPage />} />
            <Route path="/participants-v2" element={<ParticipantV2Page />} />
            <Route path="/participants-v2/new" element={<ParticipantV2CreatePage />} />
            <Route path="/participants-v2/:participantId" element={<ParticipantV2ProfilePage />} />
            <Route path="/participants-v2/:participantId/edit" element={<ParticipantEditPage />} />
            <Route path="/participants-v2/:participantId/emergency-contacts" element={<EmergencyContactsPage />} />
            <Route path="/participants-v2/:participantId/consents" element={<ParticipantConsentsPage />} />
            <Route path="/participants-v2/:participantId/register" element={<ParticipantV2RegistrationPage />} />
            <Route path="/participants-v2/:participantId/consent" element={<ParticipantV2ConsentPage />} />
            <Route path="/participants-v2/:participantId/check-in" element={<ParticipantV2CheckInPage />} />
            <Route path="/participants-v2/registrations/:registrationId/history" element={<RegistrationHistoryPage />} />
            <Route path="/participants-v2/registrations/:registrationId/qr" element={<RegistrationQrPage />} />
            <Route path="/participants/new" element={<ParticipantCreatePage />} />
            <Route path="/participants/:participantId" element={<ParticipantDetailPage />} />
            <Route path="/participants/:participantId/edit" element={<ParticipantEditPage />} />
            <Route path="/participants/:participantId/history" element={<ParticipantHistoryPage />} />
            <Route path="/participants/:participantId/consents" element={<ParticipantConsentsPage />} />
            <Route path="/participants/:participantId/emergency-contacts" element={<EmergencyContactsPage />} />
            <Route path="/events/:eventId/register" element={<EventRegistrationStartPage />} />
            <Route path="/events/:eventId/registrations" element={<EventRegistrationsPage />} />
            <Route path="/events/:eventId/participants/:participantId/consent" element={<ConsentPage />} />
            <Route path="/events/:eventId/participants/:participantId/review" element={<RegistrationReviewPage />} />
            <Route path="/registrations/:registrationId/review" element={<RegistrationReviewPage />} />
            <Route path="/registrations/:registrationId/consent" element={<ConsentPage />} />
            <Route path="/registrations/:registrationId/confirmation" element={<RegistrationConfirmationPage />} />
            <Route path="/registrations/:registrationId/history" element={<RegistrationHistoryPage />} />
            <Route path="/registrations/:registrationId/qr" element={<RegistrationQrPage />} />
          </Route>

          <Route element={<RoleGuard allowedRoles={adminRoles} />}>
            <Route path="/staff" element={<StaffAccountsPage />} />
            <Route path="/admin/audit-logs" element={<RegistrationAuditLogsPage />} />
            <Route path="/admin/system-audit-logs" element={<Navigate to="/admin/audit-logs" replace />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
