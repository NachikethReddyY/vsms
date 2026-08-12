import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { EventCapabilityGuard, RoleGuard, StationDutyGuard } from "./auth/RoleGuard";
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
import DynamicStationPage from "./features/screening/DynamicStationPage";
import QRScannerPage from "./features/screening/QRScannerPage";
import { AuditLogsPage as RegistrationAuditLogsPage } from "./pages/AdminPages";
import {
  AccountStatePage,
  CreateAccountPage,
  DutyEditorPage,
  EventAnalyticsPage,
  EventDeletionPage,
  EventReportsPage,
  EventStaffingPage,
  ForbiddenPage,
  NotFoundPage,
  ProfilePage,
  StaffAdministrationPage,
} from "./features/Stage4Pages";
import AccountSecurityPage from "./pages/AccountSecurityPage";
import StationLibraryPage from "./pages/StationLibraryPage";
import StationTemplateFormPage from "./pages/StationTemplateFormPage";
import { QueuePage } from "./pages/QueuePages"; // Imported the QueuePage component
import EventRegistrationPage from "./pages/participant/EventRegistrationPage";
import ParticipantCheckInPage from "./pages/participant/ParticipantCheckInPage";
import ParticipantConsentPage from "./pages/participant/ParticipantConsentPage";
import ParticipantCreatePage from "./pages/participant/ParticipantCreatePage";
import ParticipantEmergencyContactsPage from "./pages/participant/ParticipantEmergencyContactsPage";
import ParticipantProfilePage from "./pages/participant/ParticipantProfilePage";
import ParticipantQrPage from "./pages/participant/ParticipantQrPage";
import ParticipantRegistrationPage from "./pages/participant/ParticipantRegistrationPage";
import ParticipantStatusPage from "./pages/participant/ParticipantStatusPage";
import {
  ParticipantConsentsPage,
  ParticipantEditPage,
  RegistrationHistoryPage,
} from './pages/participant/ParticipantPages';

const adminRoles = ["ADMINISTRATOR"];
const eventManagerRoles = ["ADMINISTRATOR", "EVENT_MANAGER"];
const registrationRoles = ["REGISTRATION_OFFICER"];
const screenerRoles = ["SCREENER"];
const reviewerRoles = ["REVIEWER"];

function EventWorkspace() {
  return <AppShell><Outlet /></AppShell>;
}

function LegacySearchRedirect() {
  const location = useLocation();
  const eventId = new URLSearchParams(location.search).get("eventId");
  return <Navigate to={eventId ? `/events/${encodeURIComponent(eventId)}/register` : "/events"} replace />;
}

function LegacyEventRegistrationRedirect() {
  const { eventId = "" } = useParams();
  return <Navigate to={`/events/${eventId}`} replace />;
}

function LegacyParticipantStepRedirect({ step }: { step: "consent" | "register" }) {
  const { eventId = "", participantId = "" } = useParams();
  return <Navigate to={`/participants/${participantId}/${step}?eventId=${encodeURIComponent(eventId)}`} replace />;
}

function LegacyParticipantHistoryRedirect() {
  const { participantId = "" } = useParams();
  const location = useLocation();
  return <Navigate to={`/participants/${participantId}${location.search}`} replace />;
}

function LegacyRegistrationRedirect({ destination }: { destination: "history" | "qr" | "search" }) {
  const { registrationId = "" } = useParams();
  if (destination === "search") return <Navigate to="/events" replace />;
  return <Navigate to={`/participants/registrations/${registrationId}/${destination}`} replace />;
}

/** Eye health is clinician-review only — legacy screener URLs return to the event. */
function EyeHealthStationRedirect() {
  const { eventId = "" } = useParams();
  return <Navigate to={`/events/${eventId}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<CognitoCallback />} />
      <Route path="/create-account" element={<CreateAccountPage />} />
      <Route path="/e/:eventId" element={<PublicEventPage />} />
      <Route path="/participant-status/:token" element={<ParticipantStatusPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Navigate to="/events" replace />} />

        <Route element={<EventWorkspace />}>
          <Route path="/events" element={<EventsPage />} />
          <Route path="/account/state" element={<AccountStatePage />} />
          <Route path="/account/profile" element={<ProfilePage />} />
          <Route path="/account/security" element={<AccountSecurityPage />} />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route element={<EventCapabilityGuard allowedRoles={eventManagerRoles} />}>
            <Route path="/events/:eventId/overview" element={<EventDetailPage />} />
            <Route path="/events/:eventId/stations" element={<EventDetailPage />} />
            <Route path="/events/:eventId/staff" element={<EventStaffingPage />} />
            <Route path="/events/:eventId/staff/:membershipId/duties" element={<DutyEditorPage />} />
            <Route path="/events/:eventId/analytics" element={<EventAnalyticsPage />} />
            <Route path="/events/:eventId/reports" element={<EventReportsPage />} />
            <Route path="/events/:eventId/attendees" element={<EventDetailPage />} />
            <Route path="/events/:eventId/activity" element={<EventDetailPage />} />
          </Route>

          <Route element={<EventCapabilityGuard allowedRoles={reviewerRoles} />}>
            <Route path="/events/:eventId/reviews" element={<ReviewWorkspacePage />} />
            <Route path="/events/:eventId/reviews/:registrationId" element={<ReviewWorkspacePage />} />
          </Route>

          <Route element={<EventCapabilityGuard allowedRoles={screenerRoles} />}>
            <Route element={<StationDutyGuard stationType="VISUAL_ACUITY" />}>
              <Route path="/events/:eventId/stations/visual-acuity" element={<DynamicStationPage stationType="VISUAL_ACUITY" />} />
            </Route>
            <Route element={<StationDutyGuard stationType="REFRACTION" />}>
              <Route path="/events/:eventId/stations/refraction" element={<DynamicStationPage stationType="REFRACTION" />} />
            </Route>
            <Route element={<StationDutyGuard stationType="COLOUR_VISION" />}>
              <Route path="/events/:eventId/stations/colour-vision" element={<DynamicStationPage stationType="COLOUR_VISION" />} />
            </Route>
            <Route path="/events/:eventId/stations/eye-health" element={<EyeHealthStationRedirect />} />
            <Route element={<StationDutyGuard stationType="CUSTOM" />}>
              <Route path="/events/:eventId/stations/custom/:stationId" element={<DynamicStationPage />} />
            </Route>
            <Route path="/qr-scanner" element={<QRScannerPage />} />
          </Route>

          <Route element={<RoleGuard allowedRoles={eventManagerRoles} />}>
            <Route path="/reports" element={<ReportsPage />} />
          </Route>

          <Route element={<EventCapabilityGuard allowedRoles={eventManagerRoles} />}>
            <Route path="/events/:eventId/edit" element={<EventFormPage mode="edit" />} />
          </Route>

          <Route element={<EventCapabilityGuard allowedRoles={registrationRoles} />}>
            <Route path="/events/:eventId/queue" element={<QueuePage />} />
            <Route path="/events/qr-pass/:registrationId" element={<QRCodePage />} />
            <Route path="/qr-generator" element={<QRCodePage />} />
            <Route path="/participants" element={<Navigate to="/events" replace />} />
            <Route path="/participants/new" element={<ParticipantCreatePage />} />
            <Route path="/participants/:participantId/edit" element={<ParticipantEditPage />} />
            <Route path="/participants/:participantId/consents" element={<ParticipantConsentsPage />} />
            <Route path="/participants/:participantId/emergency-contacts" element={<ParticipantEmergencyContactsPage />} />
            <Route path="/participants/:participantId/register" element={<ParticipantRegistrationPage />} />
            <Route path="/participants/:participantId/consent" element={<ParticipantConsentPage />} />
            <Route path="/participants/:participantId/check-in" element={<ParticipantCheckInPage />} />
            <Route path="/participants/registrations/:registrationId/history" element={<RegistrationHistoryPage />} />
            <Route path="/participants/registrations/:registrationId/qr" element={<ParticipantQrPage />} />
            <Route path="/participants/:participantId/history" element={<LegacyParticipantHistoryRedirect />} />
            <Route path="/participants/:participantId" element={<ParticipantProfilePage />} />

            <Route path="/participants/search" element={<LegacySearchRedirect />} />
            <Route path="/events/:eventId/register" element={<EventRegistrationPage />} />
            <Route path="/events/:eventId/registrations" element={<LegacyEventRegistrationRedirect />} />
            <Route path="/events/:eventId/participants/:participantId/consent" element={<LegacyParticipantStepRedirect step="consent" />} />
            <Route path="/events/:eventId/participants/:participantId/review" element={<LegacyParticipantStepRedirect step="register" />} />
            <Route path="/registrations/:registrationId/review" element={<LegacyRegistrationRedirect destination="search" />} />
            <Route path="/registrations/:registrationId/consent" element={<LegacyRegistrationRedirect destination="search" />} />
            <Route path="/registrations/:registrationId/confirmation" element={<LegacyRegistrationRedirect destination="search" />} />
            <Route path="/registrations/:registrationId/history" element={<LegacyRegistrationRedirect destination="history" />} />
            <Route path="/registrations/:registrationId/qr" element={<LegacyRegistrationRedirect destination="qr" />} />
          </Route>

          <Route element={<RoleGuard allowedRoles={adminRoles} />}>
            <Route path="/staff" element={<StaffAdministrationPage />} />
            <Route path="/admin/station-templates" element={<StationLibraryPage />} />
            <Route path="/admin/station-templates/new" element={<StationTemplateFormPage mode="create" />} />
            <Route path="/admin/station-templates/:stationTemplateId/edit" element={<StationTemplateFormPage mode="edit" />} />
            <Route path="/events/new" element={<EventFormPage mode="create" />} />
            <Route path="/events/:eventId/delete" element={<EventDeletionPage />} />
            <Route path="/admin/audit-logs" element={<RegistrationAuditLogsPage />} />
            <Route path="/admin/system-audit-logs" element={<Navigate to="/admin/audit-logs" replace />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
