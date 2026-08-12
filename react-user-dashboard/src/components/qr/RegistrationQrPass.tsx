import { CheckCircleIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import apiClient, { getApiError } from "../../utils/apiClient";
import "./RegistrationQrPass.css";

type RegistrationQrPassProps = {
  registrationId: string;
  className?: string;
};

/** Inline, server-issued participant pass for registration completion views. */
export function RegistrationQrPass({ registrationId, className = "" }: RegistrationQrPassProps) {
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setQrImage(null);
    setError(null);
    void apiClient.post<{ qrImage: string }>(`/qr/registrations/${registrationId}`)
      .then(({ data }) => { if (active) setQrImage(data.qrImage); })
      .catch((cause: unknown) => { if (active) setError(getApiError(cause, "Unable to create the QR pass.")); });
    return () => { active = false; };
  }, [registrationId]);

  return (
    <section className={`registration-qr-pass ${className}`.trim()} aria-live="polite" aria-label="Participant QR pass">
      <div className="registration-qr-pass-copy">
        <span><QrCodeIcon /> Participant QR pass</span>
        <h2>{qrImage ? "QR pass ready" : "Preparing QR pass"}</h2>
        <p>{qrImage ? "Show this pass at the assigned station to open the participant record." : "The secure, registration-specific pass is being created."}</p>
      </div>
      <div className={`registration-qr-pass-code ${qrImage ? "is-ready" : ""}`}>
        {qrImage ? <img src={qrImage} alt="Secure QR code for this registration" /> : <QrCodeIcon aria-hidden="true" />}
      </div>
      {error ? <p className="registration-qr-pass-error" role="alert">{error}</p> : <p className="registration-qr-pass-note"><CheckCircleIcon /> Contains no personal information.</p>}
    </section>
  );
}
