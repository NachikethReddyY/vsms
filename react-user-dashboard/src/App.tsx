import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { RoleGuard } from "./auth/RoleGuard";
import { CognitoCallback } from "./auth/CognitoRoutes";

const AppShell = lazy(() => import("./components/AppShell"));
const TestHomePage = lazy(() => import("./components/TestHomePage"));
const LandingPage = lazy(() => import("./components/LandingPage"));
const SettingsPage = lazy(() => import("./components/SettingsPage"));
const QRCodePage = lazy(() => import("./components/qr/QRCodePage"));
const EventDetailPage = lazy(() => import("./features/events/EventDetailPage"));
const EventFormPage = lazy(() => import("./features/events/EventFormPage"));
const PublicEventPage = lazy(() => import("./features/events/PublicEventPage"));
const ReviewWorkspacePage = lazy(() => import("./features/reviews/ReviewWorkspacePage"));
const ColourVisionStationPage = lazy(() => import("./features/screening/ColourVisionStationPage"));
const RefractionStationPage = lazy(() => import("./features/screening/RefractionStationPage"));
const VisualAcuityStationPage = lazy(() => import("./features/screening/VisualAcuityStationPage"));
const AccountSecurityPage = lazy(() => import("./pages/AccountSecurityPage"));
const RegistrationAuditLogsPage = lazy(() => import("./pages/AdminPages").then((module) => ({ default: module.AuditLogsPage })));
const QueuePage = lazy(() => import("./pages/QueuePages").then((module) => ({ default: module.QueuePage })));
const ConsentPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.ConsentPage })));
const EmergencyContactsPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.EmergencyContactsPage })));
const EventRegistrationStartPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.EventRegistrationStartPage })));
const EventRegistrationsPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.EventRegistrationsPage })));
const ParticipantConsentsPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.ParticipantConsentsPage })));
const ParticipantCreatePage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.ParticipantCreatePage })));
const ParticipantDetailPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.ParticipantDetailPage })));
const ParticipantEditPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.ParticipantEditPage })));
const ParticipantHistoryPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.ParticipantHistoryPage })));
const ParticipantSearchPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.ParticipantSearchPage })));
const RegistrationConfirmationPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.RegistrationConfirmationPage })));
const RegistrationHistoryPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.RegistrationHistoryPage })));
const RegistrationQrPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.RegistrationQrPage })));
const RegistrationReviewPage = lazy(() => import("./pages/ParticipantPages").then((module) => ({ default: module.RegistrationReviewPage })));

const adminRoles = ["ADMINISTRATOR"];
const eventManagerRoles = ["ADMINISTRATOR", "EVENT_MANAGER"];
const registrationRoles = ["ADMINISTRATOR", "REGISTRATION_OFFICER"];

function EventWorkspace() {
  return <AppShell><Suspense fallback={<RouteFallback />}><Outlet /></Suspense></AppShell>;
}

function RouteFallback() {
  return <main className="center-state" role="status" aria-live="polite">Loading workspace…</main>;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}><Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<CognitoCallback />} />
      <Route path="/e/:eventId" element={<PublicEventPage />} />

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

          <Route element={<RoleGuard allowedRoles={adminRoles} />}>
            <Route path="/admin/audit-logs" element={<RegistrationAuditLogsPage />} />
            <Route path="/admin/system-audit-logs" element={<Navigate to="/admin/audit-logs" replace />} />
          </Route>

        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  );
}
