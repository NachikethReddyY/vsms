import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RoleGuard } from "./auth/RoleGuard";
import { CognitoCallback } from "./auth/CognitoRoutes";
import AppShell from "./components/AppShell";
import LandingPage from "./components/LandingPage";
import SettingsPage from "./components/SettingsPage";
import TestHomePage from "./components/TestHomePage";
import QRCodePage from "./components/qr/QRCodePage";
import EventDetailPage from "./features/events/EventDetailPage";
import EventFormPage from "./features/events/EventFormPage";
import ReviewWorkspacePage from "./features/reviews/ReviewWorkspacePage";
import ColourVisionStationPage from "./features/screening/ColourVisionStationPage";
import RefractionStationPage from "./features/screening/RefractionStationPage";
import VisualAcuityStationPage from "./features/screening/VisualAcuityStationPage";
import { AuditLogsPage as RegistrationAuditLogsPage } from "./pages/AdminPages";
import AccountSecurityPage from "./pages/AccountSecurityPage";
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
} from './pages/ParticipantPages';

const adminRoles = ["ADMINISTRATOR"];
const eventManagerRoles = ["ADMINISTRATOR", "EVENT_MANAGER"];
const registrationRoles = ["ADMINISTRATOR", "REGISTRATION_OFFICER"];

function EventWorkspace() {
  return <AppShell><Outlet /></AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<CognitoCallback />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Navigate to="/events" replace />} />
        <Route path="/events" element={<TestHomePage />} />

        <Route element={<EventWorkspace />}>
          <Route path="/account/security" element={<AccountSecurityPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/events/:eventId/queue" element={<QueuePage />} />
          <Route path="/events/:eventId/reviews" element={<ReviewWorkspacePage />} />
          <Route path="/events/:eventId/reviews/:registrationId" element={<ReviewWorkspacePage />} />
          <Route path="/events/:eventId/stations/visual-acuity" element={<VisualAcuityStationPage />} />
          <Route path="/events/:eventId/stations/refraction" element={<RefractionStationPage />} />
          <Route path="/events/:eventId/stations/colour-vision" element={<ColourVisionStationPage />} />
          <Route path="/events/qr-pass/:registrationId" element={<QRCodePage />} />
          <Route path="/qr-generator" element={<QRCodePage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route element={<RoleGuard allowedRoles={eventManagerRoles} />}>
            <Route path="/events/new" element={<EventFormPage mode="create" />} />
            <Route path="/events/:eventId/edit" element={<EventFormPage mode="edit" />} />
          </Route>

          <Route element={<RoleGuard allowedRoles={registrationRoles} />}>
            <Route path="/participants" element={<Navigate to="/participants/search" replace />} />
            <Route path="/participants/search" element={<ParticipantSearchPage />} />
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

        </Route>

        <Route element={<RoleGuard allowedRoles={adminRoles} />}>
          <Route path="/admin/audit-logs" element={<RegistrationAuditLogsPage />} />
          <Route path="/admin/system-audit-logs" element={<Navigate to="/admin/audit-logs" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
