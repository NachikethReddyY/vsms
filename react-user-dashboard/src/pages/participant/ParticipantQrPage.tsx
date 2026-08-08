import { ArrowLeftIcon, CheckCircleIcon, QrCodeIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Registration } from "../../types";
import apiClient, { getApiError } from "../../utils/apiClient";
import "./ParticipantPage.css";
import "./ParticipantQrPage.css";

export default function ParticipantQrPage() {
  const { registrationId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const backLink = eventId ? `/events/${encodeURIComponent(eventId)}/register` : "/events";
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [isLoadingRegistration, setIsLoadingRegistration] = useState(true);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiClient.get(`/registrations/${registrationId}`),
      apiClient.post(`/qr/registrations/${registrationId}`),
    ])
      .then(([registrationResponse, qrResponse]) => {
        if (!active) return;
        setRegistration(registrationResponse.data.registration);
        setQrImage(qrResponse.data.qrImage);
      })
      .catch((requestError: unknown) => { if (active) setError(getApiError(requestError, "Unable to create the QR pass.")); })
      .finally(() => { if (active) setIsLoadingRegistration(false); });
    return () => { active = false; };
  }, [registrationId]);

  return (
    <section className="participant-v2-page participant-qr-page" aria-labelledby="qr-pass-title">
      <Link className="participant-v2-back" to={backLink}><ArrowLeftIcon /> {eventId ? "Back to event registration" : "Back to events"}</Link>
      <header className="participant-qr-heading"><span><QrCodeIcon /></span><div><p>QR handoff</p><h1 id="qr-pass-title">Participant handoff</h1><small>Secure QR pass for this event registration.</small></div><strong><ShieldCheckIcon /> Secure</strong></header>
      {error ? <p className="participant-v2-alert" role="alert">{error}</p> : null}
      <section className="participant-qr-card">
        <div className="participant-qr-copy">
          <span>Registration handoff</span>
          <h2>{qrImage ? "QR pass" : "Preparing QR pass"}</h2>
          <p>{qrImage ? "This secure QR code is linked to this registration only." : "Your secure QR pass is being generated."}</p>
          <dl>
            <div><dt>Participant</dt><dd>{isLoadingRegistration ? "Loading..." : registration ? `${registration.participant.firstName} ${registration.participant.lastName}` : "Unavailable"}</dd></div>
            <div><dt>Participant reference</dt><dd>{registration?.participant.participantReference ?? "Unavailable"}</dd></div>
            <div><dt>Event</dt><dd>{registration?.event.eventName ?? "Loading..."}</dd></div>
            <div><dt>Queue number</dt><dd>{registration?.queueNumber == null ? "Not assigned" : `Q-${String(registration.queueNumber).padStart(3, "0")}`}</dd></div>
            <div><dt>Security</dt><dd><CheckCircleIcon /> Server-issued pass</dd></div>
          </dl>
        </div>
        <div className={`participant-qr-code ${qrImage ? "ready" : ""}`}>{qrImage ? <img src={qrImage} alt="Secure QR code for this registration" /> : <><QrCodeIcon /><span>Preparing QR code...</span></>}</div>
      </section>
      {qrImage ? <Link className="participant-qr-finish" to={backLink}>Return to events</Link> : null}
    </section>
  );
}
