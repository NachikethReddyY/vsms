import { CheckCircleIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import apiClient, { getApiError, newIdempotencyHeaders } from "../../utils/apiClient";

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
    void apiClient.post<{ qrImage: string }>(`/qr/registrations/${registrationId}`, undefined, { headers: newIdempotencyHeaders() })
      .then(({ data }) => { if (active) setQrImage(data.qrImage); })
      .catch((cause: unknown) => { if (active) setError(getApiError(cause, "Unable to create the QR pass.")); });
    return () => { active = false; };
  }, [registrationId]);

  return (
    <section className={`mt-5 grid grid-cols-[minmax(0,1fr)_14.875rem] items-center gap-x-5.5 gap-y-4 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_28%,var(--hairline))] bg-[var(--canvas-soft)] p-5 max-sm:grid-cols-1 max-sm:justify-items-center max-sm:text-center ${className}`.trim()} aria-live="polite" aria-label="Participant QR pass">
      <div>
        <span className="flex items-center gap-1.5 text-[0.625rem] font-extrabold tracking-[.08em] text-[var(--accent)] uppercase max-sm:justify-center"><QrCodeIcon className="size-3.75" /> Participant QR pass</span>
        <h2 className="mt-1.75 mb-1 text-[1.1875rem] tracking-[-.02em] text-[var(--ink)]">{qrImage ? "QR pass ready" : "Preparing QR pass"}</h2>
        <p className="m-0 max-w-[44ch] text-[0.8125rem] leading-normal text-[var(--ink-2)]">{qrImage ? "Use this same pass at every station and clinical review." : "The secure, registration-specific pass is being created."}</p>
      </div>
      <div className="grid min-h-53.5 place-items-center text-[var(--muted)] max-sm:min-h-49.5 max-sm:w-[min(13.625rem,100%)]">
        {qrImage ? <img className="block h-auto w-[min(12.375rem,84%)] bg-white p-2.5 [image-rendering:pixelated] max-sm:w-[min(11.125rem,84%)]" src={qrImage} alt="Secure QR code for this registration" /> : <QrCodeIcon className="size-9" aria-hidden="true" />}
      </div>
      {error ? <p className="col-span-full m-0 flex items-center gap-1.5 text-[0.6875rem] text-[var(--red)] max-sm:justify-center" role="alert">{error}</p> : <p className="col-span-full m-0 flex items-center gap-1.5 text-[0.6875rem] text-[var(--muted)] max-sm:justify-center"><CheckCircleIcon className="size-3.75 text-[var(--green)]" /> Contains no personal information.</p>}
    </section>
  );
}
