import { ArrowLeftIcon, ClipboardDocumentCheckIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PhoneInput } from "../../components/PhoneInput";
import { Field, FormErrorSummary, LoadingState, TextInput } from "../../components/ui";
import type { ConsentFormVersion, Participant, RegistrationHistory } from "../../types";
import apiClient, { getApiError } from "../../utils/apiClient";
import { isValidParticipantPhoneNumber } from "../../utils/phone";
import "./ParticipantPage.css";

type ParticipantFormState = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  contactNumber: string;
  nric: string;
  email: string;
  race: string;
  nationality: string;
  addressStreet: string;
  addressUnit: string;
  addressPostalCode: string;
  preferredLanguage: string;
  accessibilityNotes: string;
  status: string;
};

type ConsentRecord = {
  id: string;
  consentStatus: string;
  createdAt: string;
  event: { eventName: string };
  consentFormVersion: ConsentFormVersion;
  withdrawals: Array<{ id: string; consentStatus: string }>;
};

const emptyParticipantForm: ParticipantFormState = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "U",
  contactNumber: "",
  nric: "",
  email: "",
  race: "",
  nationality: "Singaporean",
  addressStreet: "",
  addressUnit: "",
  addressPostalCode: "",
  preferredLanguage: "",
  accessibilityNotes: "",
  status: "ACTIVE",
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function displayStatus(value: string) {
  return value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function participantFormError(form: ParticipantFormState) {
  if (!form.firstName.trim() || !form.lastName.trim()) return "First name and last name are required.";
  if (!form.dateOfBirth) return "Date of birth is required.";
  if (!isValidParticipantPhoneNumber(form.contactNumber)) return "Enter a valid contact number.";
  if (form.email.trim() && !emailPattern.test(form.email.trim())) return "Enter a valid email address.";
  return null;
}

function BackLink({ to, label }: { to: string; label: string }) {
  return <Link className="participant-v2-back" to={to}><ArrowLeftIcon /> {label}</Link>;
}

function ParticipantDetailsForm({ form, setForm, onSubmit, submitting, error }: {
  form: ParticipantFormState;
  setForm: Dispatch<SetStateAction<ParticipantFormState>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  error: string | null;
}) {
  const update = (field: keyof ParticipantFormState, value: string) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <form className="registration-panel participant-form form-grid" onSubmit={onSubmit} noValidate>
      <Field label="First name"><TextInput value={form.firstName} onChange={(event) => update("firstName", event.target.value)} required /></Field>
      <Field label="Last name"><TextInput value={form.lastName} onChange={(event) => update("lastName", event.target.value)} required /></Field>
      <Field label="Date of birth"><TextInput type="date" value={form.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} required /></Field>
      <Field label="Gender"><select value={form.gender} onChange={(event) => update("gender", event.target.value)}><option value="U">Prefer not to say</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></Field>
      <Field label="Contact number"><PhoneInput value={form.contactNumber} onChange={(value) => update("contactNumber", value)} /></Field>
      <Field label="NRIC / FIN"><TextInput value={form.nric} onChange={(event) => update("nric", event.target.value)} autoComplete="off" spellCheck={false} placeholder="Leave blank to keep the recorded NRIC" /></Field>
      <Field label="Email"><TextInput type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></Field>
      <Field label="Race"><TextInput value={form.race} onChange={(event) => update("race", event.target.value)} /></Field>
      <Field label="Nationality"><TextInput value={form.nationality} onChange={(event) => update("nationality", event.target.value)} autoComplete="country-name" /></Field>
      <Field label="Street address"><TextInput value={form.addressStreet} onChange={(event) => update("addressStreet", event.target.value)} autoComplete="street-address" /></Field>
      <Field label="Unit number"><TextInput value={form.addressUnit} onChange={(event) => update("addressUnit", event.target.value)} autoComplete="address-line2" /></Field>
      <Field label="Postal code"><TextInput value={form.addressPostalCode} onChange={(event) => update("addressPostalCode", event.target.value)} autoComplete="postal-code" /></Field>
      <Field label="Preferred language"><TextInput value={form.preferredLanguage} onChange={(event) => update("preferredLanguage", event.target.value)} /></Field>
      <Field label="Participant status"><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="DECEASED">Deceased</option></select></Field>
      <Field label="Accessibility notes"><textarea value={form.accessibilityNotes} onChange={(event) => update("accessibilityNotes", event.target.value)} /></Field>
      <div className="md:col-span-2"><button className="primary" disabled={submitting} type="submit">{submitting ? "Saving..." : "Save changes"}</button></div>
      <div className="md:col-span-2"><FormErrorSummary error={error} /></div>
    </form>
  );
}

export function ParticipantEditPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { participantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const participantLink = `/participants/${participantId}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const registrationDraft = (location.state as { registrationDraft?: Partial<ParticipantFormState> } | null)?.registrationDraft;
  const [form, setForm] = useState<ParticipantFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setParticipantForm: Dispatch<SetStateAction<ParticipantFormState>> = (action) => {
    setForm((current) => {
      const value = current ?? emptyParticipantForm;
      return typeof action === "function" ? action(value) : action;
    });
  };

  useEffect(() => {
    let active = true;
    void apiClient.get(`/participants/${participantId}`)
      .then((response) => {
        if (!active) return;
        const participant = response.data.participant as Participant;
        setForm({
          firstName: participant.firstName,
          lastName: participant.lastName,
          dateOfBirth: participant.dateOfBirth.slice(0, 10),
          gender: participant.gender,
          contactNumber: participant.contactNumber,
          nric: "",
          email: participant.email ?? "",
          race: participant.race ?? "",
          nationality: participant.nationality ?? "",
          addressStreet: participant.addressStreet ?? "",
          addressUnit: participant.addressUnit ?? "",
          addressPostalCode: participant.addressPostalCode ?? "",
          preferredLanguage: participant.preferredLanguage ?? "",
          accessibilityNotes: participant.accessibilityNotes ?? "",
          ...registrationDraft,
          status: participant.status,
        });
      })
      .catch((requestError: unknown) => { if (active) setError(getApiError(requestError, "Unable to load participant details.")); });
    return () => { active = false; };
  }, [participantId, registrationDraft]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const validationError = participantFormError(form);
    if (validationError) { setError(validationError); return; }
    setSubmitting(true);
    setError(null);
    try {
      const { nric, ...participantUpdates } = form;
      await apiClient.patch(`/participants/${participantId}`, nric.trim() ? form : participantUpdates);
      navigate(participantLink);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to update participant."));
    } finally {
      setSubmitting(false);
    }
  }

  if (!form && !error) return <section className="participant-v2-page"><LoadingState label="Loading participant..." /></section>;
  return (
    <section className="participant-v2-page">
      <BackLink to={participantLink} label="Back to participant profile" />
      <h1>Edit participant</h1>
      {form ? (
        <ParticipantDetailsForm
          form={form}
          setForm={setParticipantForm}
          onSubmit={submit}
          submitting={submitting}
          error={error}
        />
      ) : (
        <FormErrorSummary error={error} />
      )}
    </section>
  );
}

export function RegistrationHistoryPage() {
  const { registrationId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const backLink = eventId ? `/events/${encodeURIComponent(eventId)}/register` : "/events";
  const [history, setHistory] = useState<RegistrationHistory[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiClient.get(`/registrations/${registrationId}/history`)
      .then((response) => setHistory(response.data.history ?? []))
      .catch((requestError: unknown) => setError(getApiError(requestError, "Unable to load registration history.")));
  }, [registrationId]);
  return <section className="participant-v2-page"><BackLink to={backLink} label={eventId ? "Back to event registration" : "Back to events"} /><h1>Registration history</h1><FormErrorSummary error={error} /><div className="space-y-3">{history.map((item) => <article key={item.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">{item.fromStatus ? displayStatus(item.fromStatus) : "New"} to {displayStatus(item.toStatus)}</p><p className="text-sm text-slate-600">{new Date(item.occurredAt).toLocaleString()} - {item.changedBy?.fullName ?? "Staff"} - {item.reason ?? "No reason recorded"}</p></article>)}</div></section>;
}

export function ParticipantConsentsPage() {
  const { participantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const participantLink = `/participants/${participantId}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/participants/${participantId}/consents`);
      setConsents(response.data.consents ?? []);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to load consent history."));
    } finally {
      setLoading(false);
    }
  }, [participantId]);
  useEffect(() => { void load(); }, [load]);
  async function withdraw(consentId: string) {
    try {
      await apiClient.post(`/participants/${participantId}/consents/${consentId}/withdraw`, { withdrawalReason: reason[consentId] });
      await load();
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to withdraw consent."));
    }
  }
  return <section className="participant-v2-page"><BackLink to={participantLink} label="Back to participant profile" /><h1>Consent history</h1><FormErrorSummary error={error} />{loading ? <LoadingState label="Loading consent history..." /> : <div className="space-y-3">{consents.map((consent) => { const withdrawn = consent.withdrawals.some((item) => item.consentStatus === "WITHDRAWN"); return <article key={consent.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">{consent.event.eventName} - {displayStatus(consent.consentStatus)}</p><p className="text-sm">Version {consent.consentFormVersion.versionNumber} - {new Date(consent.createdAt).toLocaleString()}</p>{consent.consentStatus === "ACCEPTED" && !withdrawn ? <div className="mt-3 flex gap-2"><TextInput placeholder="Withdrawal reason" value={reason[consent.id] ?? ""} onChange={(event) => setReason((current) => ({ ...current, [consent.id]: event.target.value }))} /><button className="secondary" disabled={!reason[consent.id]?.trim()} onClick={() => void withdraw(consent.id)}>Withdraw</button></div> : withdrawn ? <p className="mt-2 text-sm text-amber-700">Withdrawn; original evidence preserved.</p> : null}</article>; })}{!consents.length ? <section className="registration-panel no-match-panel"><ClipboardDocumentCheckIcon /><p>No consent recorded yet.</p></section> : null}</div>}</section>;
}
