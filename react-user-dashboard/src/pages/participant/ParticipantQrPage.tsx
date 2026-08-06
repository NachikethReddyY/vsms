import { ArrowLeftIcon, ArrowPathIcon, CheckCircleIcon, QrCodeIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import apiClient, { getApiError } from "../../utils/apiClient";
import "./ParticipantPage.css";
import "./ParticipantQrPage.css";

export default function ParticipantQrPage() {
  const { registrationId = "" } = useParams();
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generatePass() {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await apiClient.post(`/qr/registrations/${registrationId}`);
      setQrImage(response.data.qrImage);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create the QR pass."));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="participant-v2-page participant-qr-page" aria-labelledby="qr-pass-title">
      <Link className="participant-v2-back" to="/participants"><ArrowLeftIcon /> Back to participant search</Link>
      <header className="participant-qr-heading"><span><QrCodeIcon /></span><div><p>Event check-in</p><h1 id="qr-pass-title">QR pass</h1><small>Generate the secure pass used to identify this registration at the event.</small></div><strong><ShieldCheckIcon /> Secure</strong></header>
      {error ? <p className="participant-v2-alert" role="alert">{error}</p> : null}
      <section className="participant-qr-card">
        <div className="participant-qr-copy"><span>Registration pass</span><h2>{qrImage ? "Pass ready for check-in" : "Create a secure QR pass"}</h2><p>{qrImage ? "The QR code is ready to scan at the registration station. It remains linked to this registration only." : "Generate the pass after confirming the participant’s event registration."}</p><dl><div><dt>Registration ID</dt><dd>{registrationId}</dd></div><div><dt>Security</dt><dd><CheckCircleIcon /> Server-issued pass</dd></div></dl>{!qrImage ? <button className="primary" type="button" disabled={isGenerating} onClick={() => void generatePass()}><QrCodeIcon /> {isGenerating ? "Generating pass..." : "Generate QR pass"}</button> : <button className="secondary" type="button" disabled={isGenerating} onClick={() => void generatePass()}><ArrowPathIcon /> Generate a new pass</button>}</div>
        <div className={`participant-qr-code ${qrImage ? "ready" : ""}`}>{qrImage ? <img src={qrImage} alt="Secure QR code for this registration" /> : <><QrCodeIcon /><span>QR code will appear here</span></>}</div>
      </section>
      {qrImage ? <Link className="participant-qr-finish" to="/participants">Finish hand-off and return to participant search</Link> : null}
    </section>
  );
}

