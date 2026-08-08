import { Navigate, useParams, useSearchParams } from "react-router-dom";

// Preserve old check-in links while routing them into the registration-to-QR flow.
export default function ParticipantCheckInPage() {
  const { participantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId");
  const destination = `/participants/${participantId}/register${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;

  return <Navigate to={destination} replace />;
}
