import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  PhoneIcon,
  UserIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import apiClient, { getApiError } from "../utils/apiClient";
import type {
  ConsentFormVersion,
  EmergencyContact,
  EventSummary,
  Participant,
  ParticipantSummary,
  Registration,
  RegistrationHistory,
} from "../types";
import { SignaturePad } from "../components/SignaturePad";
import { AppShell, Field, FormErrorSummary, LoadingState, PrimaryButton, TextInput } from "../components/ui";

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ConsentRecord {
  id: string;
  consentStatus: string;
  signerType: string | null;
  signerName: string | null;
  createdAt: string;
  withdrawalReason?: string | null;
  consentFormVersion: ConsentFormVersion;
  event: EventSummary;
  withdrawals: Array<{ id: string; consentStatus: string }>;
}

interface ReviewData {
  participant: Participant;
  event: EventSummary;
  emergencyContact: EmergencyContact | null;
  latestConsent: (ConsentRecord & { consentFormVersion: ConsentFormVersion }) | null;
}

interface ParticipantFormState {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  contactNumber: string;
  email: string;
  preferredLanguage: string;
  accessibilityNotes: string;
  status: string;
}

interface EmergencyContactFormState {
  contactName: string;
  relationship: string;
  phoneNumber: string;
  email: string;
  isPrimary: boolean;
  status: string;
}

const emptyParticipantForm: ParticipantFormState = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "U",
  contactNumber: "",
  email: "",
  preferredLanguage: "English",
  accessibilityNotes: "",
  status: "ACTIVE",
};

const emptyEmergencyContactForm: EmergencyContactFormState = {
  contactName: "",
  relationship: "",
  phoneNumber: "",
  email: "",
  isPrimary: true,
  status: "ACTIVE",
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9\s-]{6,19}$/;

const participantSearchLabels: Record<string, string> = {
  participantReference: "Reference number",
  name: "Name",
  contactNumber: "Contact number",
  dateOfBirth: "Date of birth",
};

function displayStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function participantFormError(form: ParticipantFormState) {
  if (!form.firstName.trim()) return "First name is required.";
  if (!form.lastName.trim()) return "Last name is required.";
  if (!form.dateOfBirth) return "Date of birth is required.";
  if (form.dateOfBirth > new Date().toISOString().slice(0, 10)) {
    return "Date of birth cannot be in the future.";
  }
  if (!phonePattern.test(form.contactNumber.trim())) {
    return "Participant contact number must be a valid phone number.";
  }
  if (form.email.trim() && !emailPattern.test(form.email.trim())) {
    return "Participant email must be a valid email address, for example name@example.com.";
  }
  return null;
}

function emergencyContactFormError(form: EmergencyContactFormState) {
  if (!form.contactName.trim()) return "Emergency contact name is required.";
  if (!form.relationship.trim()) return "Emergency contact relationship is required.";
  if (!phonePattern.test(form.phoneNumber.trim())) {
    return "Emergency contact phone number must be valid.";
  }
  if (form.email.trim() && !emailPattern.test(form.email.trim())) {
    return "Emergency contact email must be a valid email address, for example name@example.com.";
  }
  if (form.status === "REMOVED" && form.isPrimary) {
    return "A removed emergency contact cannot be the primary contact.";
  }
  return null;
}

function FormFeedback({
  label,
  message,
  tone = "error",
}: {
  label: string;
  message: string | null;
  tone?: "error" | "notice";
}) {
  if (!message) return null;
  const style = tone === "error"
    ? "border-red-300 bg-red-50 text-red-800"
    : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`border px-4 py-3 text-sm ${style}`} role={tone === "error" ? "alert" : "status"} aria-live="polite">
      <p className="font-semibold">{label}</p>
      <p>{message}</p>
    </div>
  );
}

function useEventIdFromRouteOrQuery() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  return params.eventId ?? searchParams.get("eventId") ?? "";
}

function RegistrationJourney({ active }: { active: "search" | "details" | "check-in" | "qr" }) {
  const steps = [
    ["search", "01", "Search"],
    ["details", "02", "Participant details"],
    ["check-in", "03", "Event check-in"],
    ["qr", "04", "QR pass"],
  ] as const;
  const activeIndex = steps.findIndex(([key]) => key === active);
  return (
    <ol className="registration-journey" aria-label="Registration progress">
      {steps.map(([key, number, label], index) => (
        <li key={key} className={index === activeIndex ? "active" : index < activeIndex ? "complete" : ""}>
          <span>{index < activeIndex ? <CheckCircleIcon /> : number}</span>
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  );
}

function ParticipantBackLink({ to, label = "Back" }: { to: string; label?: string }) {
  return (
    <div className="participant-back-row">
      <Link className="secondary" to={to}>
        <ArrowLeftIcon />
        {label}
      </Link>
    </div>
  );
}

function SearchNoMatchNotice() {
  return (
    <div className="registration-notice" role="status">
      <MagnifyingGlassIcon />
      <p><strong>Search returned no match.</strong> Creating a new participant record. For a returning participant, search first and create a new event check-in instead of a duplicate.</p>
    </div>
  );
}

function ParticipantForm({
  form,
  setForm,
  onSubmit,
  submitLabel,
  submitting,
  feedback,
  onFieldChange,
}: {
  form: ParticipantFormState;
  setForm: React.Dispatch<React.SetStateAction<ParticipantFormState>>;
  onSubmit: (event: React.FormEvent) => void;
  submitLabel: string;
  submitting: boolean;
  feedback: string | null;
  onFieldChange: () => void;
}) {
  const update = (field: keyof ParticipantFormState, value: string) => {
    onFieldChange();
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <form className="registration-panel participant-form form-grid" noValidate onSubmit={onSubmit}>
      <header className="registration-panel-heading wide">
        <UserIcon />
        <div><h2>Participant details</h2><p>No participant account is created. This record can be reused across events.</p></div>
      </header>
      <Field label="First name"><TextInput value={form.firstName} maxLength={100} onChange={(event) => update("firstName", event.target.value)} required /></Field>
      <Field label="Last name"><TextInput value={form.lastName} maxLength={100} onChange={(event) => update("lastName", event.target.value)} required /></Field>
      <Field label="Date of birth"><TextInput value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(event) => update("dateOfBirth", event.target.value)} type="date" required /></Field>
      <Field label="Gender">
        <select value={form.gender} onChange={(event) => update("gender", event.target.value)}>
          <option value="U">Prefer not to say</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
        </select>
      </Field>
      <Field label="Contact number"><TextInput value={form.contactNumber} onChange={(event) => update("contactNumber", event.target.value)} required /></Field>
      <Field label="Email"><TextInput aria-invalid={Boolean(form.email.trim() && !emailPattern.test(form.email.trim()))} value={form.email} onChange={(event) => update("email", event.target.value)} type="email" /></Field>
      <Field label="Preferred language"><TextInput value={form.preferredLanguage} maxLength={50} onChange={(event) => update("preferredLanguage", event.target.value)} /></Field>
      <Field label="Participant status">
        <select value={form.status} onChange={(event) => update("status", event.target.value)}>
          <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="DECEASED">Deceased</option>
        </select>
      </Field>
      <Field label="Accessibility notes">
        <textarea maxLength={1000} value={form.accessibilityNotes} onChange={(event) => update("accessibilityNotes", event.target.value)} />
      </Field>
      <div className="md:col-span-2"><PrimaryButton disabled={submitting} type="submit">{submitting ? "Saving…" : submitLabel}</PrimaryButton></div>
      <div className="md:col-span-2">
        <FormFeedback label="Participant form feedback" message={feedback} />
      </div>
    </form>
  );
}

export function EventRegistrationStartPage() {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiClient.get(`/events/${eventId}`)
      .then((response) => {
        const source = response.data.event ?? response.data;
        setEvent({
          id: source.id ?? source.eventId,
          eventName: source.eventName ?? source.name,
          location: source.location ?? source.venue,
          status: source.status,
          eventDate: source.eventDate ?? source.startsAt,
          startTime: source.startTime ?? source.startsAt,
          endTime: source.endTime ?? source.endsAt,
        });
      })
      .catch((requestError: unknown) => setError(getApiError(requestError, "Unable to load event.")));
  }, [eventId]);
  return (
    <AppShell title="Start registration">
      <ParticipantBackLink to={`/events/${eventId}`} label="Back to event" />
      <RegistrationJourney active="search" />
      <FormErrorSummary error={error} />
      <div className="registration-panel registration-start">
        <h2 className="text-lg font-semibold">{event?.eventName ?? "Selected event"}</h2>
        {event ? <p className="text-sm text-slate-600">{new Date(event.eventDate).toLocaleDateString()} · {displayStatus(event.status)}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Link className="primary" to={`/participants/search?eventId=${eventId}`}><MagnifyingGlassIcon /> Search participants first</Link>
          <Link className="secondary" to={`/events/${eventId}/registrations`}>View registrations</Link>
        </div>
      </div>
    </AppShell>
  );
}

export function ParticipantSearchPage() {
  const eventId = useEventIdFromRouteOrQuery();
  const [criteria, setCriteria] = useState({ participantReference: "", name: "", contactNumber: "", dateOfBirth: "" });
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (page = 1) => {
    setError(null);
    const hasText = [criteria.participantReference, criteria.name, criteria.contactNumber].some((value) => value.trim().length >= 3);
    if (!hasText && !criteria.dateOfBirth) {
      setError("Enter at least 3 characters, or provide an exact date of birth.");
      return;
    }
    try {
      const response = await apiClient.get("/participants", {
        params: { ...criteria, page, pageSize: pagination.pageSize },
      });
      setParticipants(response.data.participants ?? []);
      setPagination(response.data.pagination);
      setSearched(true);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Search failed."));
    }
  }, [criteria, pagination.pageSize]);
  const createParams = new URLSearchParams({ searchConfirmed: "1" });
  if (eventId) createParams.set("eventId", eventId);
  Object.entries(criteria).forEach(([key, value]) => {
    if (value.trim()) createParams.set(key, value.trim());
  });

  return (
    <AppShell title="Participant search">
      <ParticipantBackLink
        to={eventId ? `/events/${eventId}/register` : "/events"}
        label={eventId ? "Back to registration" : "Back to dashboard"}
      />
      <RegistrationJourney active="search" />
      <div className="participant-search-layout">
        <form className="registration-panel participant-search-form" onSubmit={(event) => { event.preventDefault(); void search(1); }}>
          <header className="registration-panel-heading">
            <MagnifyingGlassIcon />
            <div><h2>Search before creating</h2><p>Use at least three characters, or an exact date of birth. A participant is shown when any entered field matches.</p></div>
          </header>
          <FormErrorSummary error={error} />
          {Object.entries(criteria).map(([field, value]) => (
            <Field key={field} label={participantSearchLabels[field] ?? field}>
              <TextInput type={field === "dateOfBirth" ? "date" : "text"} value={value} onChange={(event) => setCriteria((current) => ({ ...current, [field]: event.target.value }))} />
            </Field>
          ))}
          <PrimaryButton type="submit"><MagnifyingGlassIcon /> Search participants</PrimaryButton>
          <p className="search-policy">A new participant can only be created after a completed search returns no match.</p>
        </form>
        <section className="participant-search-results" aria-live="polite">
          {searched && participants.length === 0 ? (
            <div className="registration-panel no-match-panel">
              <SearchNoMatchNotice />
              <Link className="primary" to={`/participants/new?${createParams.toString()}`}><UserPlusIcon /> Create new participant record</Link>
            </div>
          ) : null}
          {participants.map((participant) => (
            <article key={participant.id} className="participant-result">
              <h3 className="text-lg font-semibold">{participant.firstName} {participant.lastName}</h3>
              <p className="text-sm text-slate-600">{participant.participantReference} · DOB {participant.maskedDateOfBirth} · {participant.maskedContactNumber}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {eventId ? <Link className="primary" to={`/participants/${participant.id}?eventId=${eventId}`}>Continue event check-in <ArrowRightIcon /></Link> : null}
                <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm" to={`/participants/${participant.id}/edit${eventId ? `?eventId=${eventId}` : ""}`}>Edit participant</Link>
                <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm" to={`/participants/${participant.id}`}>View profile</Link>
              </div>
            </article>
          ))}
          {pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <button disabled={pagination.page <= 1} onClick={() => void search(pagination.page - 1)}>Previous</button>
              <span>Page {pagination.page} of {pagination.totalPages} · {pagination.total} matches</span>
              <button disabled={pagination.page >= pagination.totalPages} onClick={() => void search(pagination.page + 1)}>Next</button>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

export function ParticipantCreatePage() {
  const navigate = useNavigate();
  const eventId = useEventIdFromRouteOrQuery();
  const [searchParams] = useSearchParams();
  const searchConfirmed = searchParams.get("searchConfirmed") === "1";
  const [form, setForm] = useState<ParticipantFormState>(() => {
    const searchedName = (searchParams.get("name") ?? "").trim().split(/\s+/).filter(Boolean);
    return {
      ...emptyParticipantForm,
      firstName: searchedName[0] ?? "",
      lastName: searchedName.slice(1).join(" "),
      contactNumber: searchParams.get("contactNumber") ?? "",
      dateOfBirth: searchParams.get("dateOfBirth") ?? "",
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const currentForm = form;
    if (!currentForm) {
      setError("Participant details are still loading.");
      return;
    }
    const validationMessage = participantFormError(currentForm);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiClient.post("/participants", currentForm);
      const id = response.data.participant.id;
      navigate(eventId
        ? `/participants/${id}/emergency-contacts?eventId=${eventId}`
        : `/participants/${id}`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create participant."));
    } finally {
      setSubmitting(false);
    }
  }
  if (!searchConfirmed) {
    return (
      <AppShell title="Create participant">
        <ParticipantBackLink
          to={`/participants/search${eventId ? `?eventId=${eventId}` : ""}`}
          label="Back to participant search"
        />
        <RegistrationJourney active="search" />
        <div className="registration-panel no-match-panel">
          <div className="registration-notice warning"><MagnifyingGlassIcon /><p><strong>Search is required first.</strong> This prevents duplicate participant records and keeps returning participants linked to their existing history.</p></div>
          <Link className="primary" to={`/participants/search${eventId ? `?eventId=${eventId}` : ""}`}><MagnifyingGlassIcon /> Search participants</Link>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell title="Create participant">
      <ParticipantBackLink
        to={`/participants/search${eventId ? `?eventId=${eventId}` : ""}`}
        label="Back to participant search"
      />
      <RegistrationJourney active="details" />
      <SearchNoMatchNotice />
      <ParticipantForm form={form} setForm={setForm} onSubmit={submit} submitLabel="Save participant details" submitting={submitting} feedback={error} onFieldChange={() => setError(null)} />
    </AppShell>
  );
}

export function ParticipantDetailPage() {
  const { participantId = "" } = useParams();
  const eventId = useEventIdFromRouteOrQuery();
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      apiClient.get(`/participants/${participantId}`),
      apiClient.get(`/participants/${participantId}/emergency-contacts`),
      apiClient.get(`/participants/${participantId}/consents`),
      apiClient.get(`/participants/${participantId}/registrations`),
    ])
      .then(([participantResponse, contactsResponse, consentsResponse, registrationsResponse]) => {
        setParticipant(participantResponse.data.participant);
        setContacts(contactsResponse.data.contacts ?? []);
        setConsents(consentsResponse.data.consents ?? []);
        setRegistrations(registrationsResponse.data.registrations ?? []);
      })
      .catch((requestError: unknown) => setError(getApiError(requestError, "Unable to load participant details.")));
  }, [participantId]);
  const activeContact = contacts.find((contact) => contact.status === "ACTIVE" && contact.isPrimary)
    ?? contacts.find((contact) => contact.status === "ACTIVE");
  const eventConsent = eventId
    ? consents.find((consent) => consent.event.id === eventId && !consent.withdrawals.some((item) => item.consentStatus === "WITHDRAWN"))
    : consents[0];
  if (!participant) return <AppShell title="Participant profile"><LoadingState label="Loading participant…" /></AppShell>;
  return (
    <AppShell title="Participant details">
      <ParticipantBackLink
        to={`/participants/search${eventId ? `?eventId=${eventId}` : ""}`}
        label="Back to participant search"
      />
      <RegistrationJourney active="details" />
      <FormErrorSummary error={error} />
      <div className="registration-panel participant-details-panel">
        <h2 className="text-xl font-semibold">{participant.firstName} {participant.lastName}</h2>
        <p className="text-sm text-slate-600">{participant.participantReference} · {displayStatus(participant.status)} · {participant.contactNumber}</p>
        <div className="registration-actions">
          <Link className="secondary" to={`/participants/${participantId}/edit${eventId ? `?eventId=${eventId}` : ""}`}>Edit participant details</Link>
        </div>
        <div className="participant-detail-sections" id="participant-requirements">
          <section>
            <PhoneIcon />
            <div>
              <span className="section-label">Emergency contact</span>
              <h3>{activeContact ? activeContact.contactName : "Required before check-in"}</h3>
              <p>{activeContact ? `${activeContact.relationship} · ${activeContact.phoneNumber}${activeContact.isPrimary ? " · Primary" : ""}` : "Add an active emergency contact under this participant record."}</p>
              <Link to={`/participants/${participantId}/emergency-contacts${eventId ? `?eventId=${eventId}` : ""}`}>{activeContact ? "Manage emergency contacts" : "Add emergency contact"} <ArrowRightIcon /></Link>
            </div>
          </section>
          <section>
            <ClipboardDocumentCheckIcon />
            <div>
              <span className="section-label">Consent</span>
              <h3>{eventConsent ? `${displayStatus(eventConsent.consentStatus)} · Version ${eventConsent.consentFormVersion.versionNumber}` : eventId ? "Required for this event" : "No consent selected"}</h3>
              <p>{eventConsent ? `Recorded for ${eventConsent.event.eventName}. Evidence and history remain attached to this participant.` : "Consent is event-specific and is recorded after participant details and emergency contact information."}</p>
              {eventId && !eventConsent
                ? <Link to={`/events/${eventId}/participants/${participantId}/consent`}>Record consent <ArrowRightIcon /></Link>
                : eventConsent
                  ? <Link to={`/participants/${participantId}/consents${eventId ? `?eventId=${eventId}` : ""}`}>View consent history <ArrowRightIcon /></Link>
                  : <Link to="/events">Choose an event to record consent <ArrowRightIcon /></Link>}
            </div>
          </section>
        </div>
        <section className="participant-registration-history" aria-labelledby="participant-registration-history-title">
          <header className="participant-registration-history-heading">
            <div>
              <span className="section-label">Registration history</span>
              <h3 id="participant-registration-history-title">Past and current event registrations</h3>
            </div>
            <span className="participant-registration-history-count">{registrations.length} {registrations.length === 1 ? "registration" : "registrations"}</span>
          </header>
          {registrations.length === 0 ? (
            <p className="participant-registration-history-empty">This participant has not been registered for an event yet.</p>
          ) : (
            <div className="participant-registration-history-list">
              {registrations.map((registration) => {
                const consent = consents.find((item) => item.event.id === registration.eventId && !item.withdrawals.some((withdrawal) => withdrawal.consentStatus === "WITHDRAWN"));
                return (
                  <article key={registration.id} className="participant-registration-history-row">
                    <div>
                      <h4>{registration.event.eventName}</h4>
                      <p>Registered {new Date(registration.registeredAt).toLocaleDateString()} · Queue {registration.queueNumber}</p>
                    </div>
                    <div className="participant-registration-history-meta">
                      <span>{displayStatus(registration.registrationStatus)}</span>
                      <small>Consent: {consent ? displayStatus(consent.consentStatus) : "Not recorded"}</small>
                      <Link to={`/registrations/${registration.id}/history`}>View history <ArrowRightIcon /></Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        {eventId ? (
          <div className="registration-next-step">
            <div><span>Next step</span><strong>{activeContact && eventConsent?.consentStatus === "ACCEPTED" ? "Review and create this event check-in" : "Complete the required participant information"}</strong></div>
            <Link className="primary" aria-disabled={!activeContact || eventConsent?.consentStatus !== "ACCEPTED"} to={activeContact && eventConsent?.consentStatus === "ACCEPTED" ? `/events/${eventId}/participants/${participantId}/review` : "#participant-requirements"}>Continue <ArrowRightIcon /></Link>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

export function ParticipantEditPage() {
  const navigate = useNavigate();
  const { participantId = "" } = useParams();
  const eventId = useEventIdFromRouteOrQuery();
  const [form, setForm] = useState<ParticipantFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    apiClient.get(`/participants/${participantId}`).then((response) => {
      const participant = response.data.participant as Participant;
      setForm({
        firstName: participant.firstName,
        lastName: participant.lastName,
        dateOfBirth: participant.dateOfBirth.slice(0, 10),
        gender: participant.gender,
        contactNumber: participant.contactNumber,
        email: participant.email ?? "",
        preferredLanguage: participant.preferredLanguage ?? "",
        accessibilityNotes: participant.accessibilityNotes ?? "",
        status: participant.status,
      });
    });
  }, [participantId]);
  const setEditForm: React.Dispatch<React.SetStateAction<ParticipantFormState>> = (action) => {
    setForm((current) => {
      const value = current ?? emptyParticipantForm;
      return typeof action === "function" ? action(value) : action;
    });
  };
  if (!form) return <AppShell title="Edit participant"><LoadingState label="Loading participant…" /></AppShell>;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const currentForm = form;
    if (!currentForm) {
      setError("Participant details are still loading.");
      return;
    }
    const validationMessage = participantFormError(currentForm);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.patch(`/participants/${participantId}`, currentForm);
      navigate(`/participants/${participantId}${eventId ? `?eventId=${eventId}` : ""}`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to update participant."));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <AppShell title="Edit participant">
      <ParticipantBackLink
        to={`/participants/${participantId}${eventId ? `?eventId=${eventId}` : ""}`}
        label="Back to participant details"
      />
      <ParticipantForm form={form} setForm={setEditForm} onSubmit={submit} submitLabel="Save changes" submitting={submitting} feedback={error} onFieldChange={() => setError(null)} />
    </AppShell>
  );
}

export function EmergencyContactsPage() {
  const navigate = useNavigate();
  const { participantId = "" } = useParams();
  const eventId = useEventIdFromRouteOrQuery();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<EmergencyContactFormState>(emptyEmergencyContactForm);
  const load = useCallback(async () => {
    const response = await apiClient.get(`/participants/${participantId}/emergency-contacts`);
    setContacts(response.data.contacts ?? []);
  }, [participantId]);
  useEffect(() => { void load().catch((requestError: unknown) => setError(getApiError(requestError, "Unable to load contacts."))); }, [load]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const validationMessage = emergencyContactFormError(form);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    try {
      const wasEditing = Boolean(editingId);
      if (editingId) await apiClient.patch(`/emergency-contacts/${editingId}`, form);
      else await apiClient.post(`/participants/${participantId}/emergency-contacts`, form);
      setEditingId(null);
      setForm({ ...emptyEmergencyContactForm });
      await load();
      setNotice(wasEditing ? "Emergency contact updated." : "Emergency contact added. Use the completion button to continue.");
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to save contact."));
    }
  }
  function edit(contact: EmergencyContact) {
    setEditingId(contact.id);
    setError(null);
    setNotice(null);
    setForm({ contactName: contact.contactName, relationship: contact.relationship, phoneNumber: contact.phoneNumber, email: contact.email ?? "", isPrimary: contact.isPrimary, status: contact.status });
  }
  function changeContactStatus(status: string) {
    const primaryWasCleared = status === "REMOVED" && form.isPrimary;
    setForm((current) => ({
      ...current,
      status,
      isPrimary: status === "REMOVED" ? false : current.isPrimary,
    }));
    setError(null);
    setNotice(primaryWasCleared
      ? "Primary contact was turned off because a removed emergency contact cannot be primary."
      : status === "REMOVED"
        ? "Removed emergency contacts cannot be selected as primary."
        : null);
  }
  const hasActiveContact = contacts.some((contact) => contact.status === "ACTIVE");
  const completionTarget = eventId
    ? `/events/${eventId}/participants/${participantId}/consent`
    : `/participants/${participantId}`;
  return (
    <AppShell title="Emergency contacts">
      <ParticipantBackLink
        to={`/participants/${participantId}${eventId ? `?eventId=${eventId}` : ""}`}
        label="Back to participant details"
      />
      <RegistrationJourney active="details" />
      <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
        <section className="space-y-3">
          {contacts.map((contact) => (
            <article key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="font-semibold">{contact.contactName} {contact.isPrimary ? "· Primary" : ""}</h3>
              <p className="text-sm text-slate-600">{contact.relationship} · {contact.phoneNumber} · {displayStatus(contact.status)}</p>
              <button className="mt-2 text-sm underline" type="button" onClick={() => edit(contact)}>Edit</button>
            </article>
          ))}
          <div className="registration-next-step">
            <div>
              <span>{hasActiveContact ? "Emergency contact complete" : "Next step"}</span>
              <strong>{hasActiveContact ? (eventId ? "Continue to participant consent" : "Finish and return to participant details") : "Add at least one active emergency contact"}</strong>
            </div>
            <PrimaryButton disabled={!hasActiveContact} type="button" onClick={() => navigate(completionTarget)}>
              {eventId ? "Continue to consent" : "Done"} <ArrowRightIcon />
            </PrimaryButton>
          </div>
        </section>
        <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5" noValidate onSubmit={submit}>
          <h2 className="font-semibold">{editingId ? "Edit contact" : "Add contact"}</h2>
          <Field label="Contact name"><TextInput value={form.contactName} onChange={(event) => { setError(null); setForm({ ...form, contactName: event.target.value }); }} required /></Field>
          <Field label="Relationship"><TextInput value={form.relationship} onChange={(event) => { setError(null); setForm({ ...form, relationship: event.target.value }); }} required /></Field>
          <Field label="Phone number"><TextInput value={form.phoneNumber} onChange={(event) => { setError(null); setForm({ ...form, phoneNumber: event.target.value }); }} required /></Field>
          <Field label="Email"><TextInput aria-invalid={Boolean(form.email.trim() && !emailPattern.test(form.email.trim()))} type="email" value={form.email} onChange={(event) => { setError(null); setForm({ ...form, email: event.target.value }); }} /></Field>
          <label className={`flex gap-2 text-sm ${form.status === "REMOVED" ? "text-slate-400" : ""}`}><input type="checkbox" checked={form.isPrimary} disabled={form.status === "REMOVED"} onChange={(event) => { setError(null); setNotice(null); setForm({ ...form, isPrimary: event.target.checked }); }} />Primary active contact</label>
          {editingId ? <Field label="Contact status"><select className="w-full rounded-xl border p-2" value={form.status} onChange={(event) => changeContactStatus(event.target.value)}><option value="ACTIVE">Active</option><option value="REMOVED">Removed</option></select></Field> : null}
          <PrimaryButton type="submit">{editingId ? "Save contact" : "Add contact"}</PrimaryButton>
          <FormFeedback
            label="Emergency contact feedback"
            message={error ?? notice}
            tone={error ? "error" : "notice"}
          />
        </form>
      </div>
    </AppShell>
  );
}

export function ConsentPage() {
  const navigate = useNavigate();
  const { participantId = "", eventId = "" } = useParams();
  const [consentForm, setConsentForm] = useState<ConsentFormVersion | null>(null);
  const [form, setForm] = useState({
    consentStatus: "ACCEPTED",
    signerType: "PARTICIPANT",
    signerName: "",
    signerRelationship: "",
    guardianContactName: "",
    guardianContactPhone: "",
    guardianContactEmail: "",
  });
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const loadConsentForm = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get("/consent-forms/active");
      const activeForm = response.data.consentForm;
      if (!activeForm) throw new Error("No active consent form was returned.");
      setConsentForm(activeForm);
    } catch (requestError: unknown) {
      setConsentForm(null);
      setError(getApiError(requestError, "Unable to load consent form."));
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => { void loadConsentForm(); }, [loadConsentForm]);
  const signerLabels: Record<string, {
    person: string;
    name: string;
    relationship: string;
    contactName: string;
    phone: string;
    email: string;
  }> = {
    PARTICIPANT: {
      person: "Participant",
      name: "Participant name",
      relationship: "Relationship to participant",
      contactName: "Participant contact name",
      phone: "Participant phone number",
      email: "Participant email",
    },
    PARENT: {
      person: "Parent",
      name: "Parent name",
      relationship: "Parent's relationship to participant",
      contactName: "Parent contact name",
      phone: "Parent contact phone",
      email: "Parent contact email",
    },
    GUARDIAN: {
      person: "Guardian",
      name: "Guardian name",
      relationship: "Guardian's relationship to participant",
      contactName: "Guardian contact name",
      phone: "Guardian contact phone",
      email: "Guardian contact email",
    },
    AUTHORISED_REPRESENTATIVE: {
      person: "Authorised representative",
      name: "Authorised representative name",
      relationship: "Representative's relationship to participant",
      contactName: "Representative contact name",
      phone: "Representative contact phone",
      email: "Representative contact email",
    },
  };
  const activeSignerLabels = signerLabels[form.signerType] ?? signerLabels.PARTICIPANT;

  function changeSignerType(signerType: string) {
    setForm((current) => ({
      ...current,
      signerType,
      signerName: "",
      signerRelationship: "",
      guardianContactName: "",
      guardianContactPhone: "",
      guardianContactEmail: "",
    }));
    setSignatureDataUrl(null);
    setError(null);
  }

  function changeDecision(consentStatus: string) {
    setForm((current) => ({ ...current, consentStatus }));
    setSignatureDataUrl(null);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!consentForm) return;
    if (form.consentStatus === "ACCEPTED" && !signatureDataUrl) {
      setError("Electronic signature is required for accepted consent.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let signature = {};
      if (form.consentStatus === "ACCEPTED") {
        const upload = await apiClient.post("/signatures", { dataUrl: signatureDataUrl, eventId, purpose: "CONSENT", targetId: participantId });
        signature = upload.data;
      }
      await apiClient.post(`/participants/${participantId}/consents`, {
        ...form,
        ...signature,
        eventId,
        consentFormVersionId: consentForm.id,
      });
      navigate(form.consentStatus === "ACCEPTED"
        ? `/events/${eventId}/participants/${participantId}/review`
        : `/participants/${participantId}?eventId=${eventId}`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to record consent."));
    } finally {
      setSubmitting(false);
    }
  }
  const representative = form.signerType !== "PARTICIPANT";
  return (
    <AppShell title="Participant consent">
      <RegistrationJourney active="details" />
      <FormErrorSummary error={error} />
      {isLoading ? <LoadingState label="Loading active consent form…" /> : !consentForm ? (
        <section className="registration-panel no-match-panel">
          <div>
            <h2 className="text-lg font-semibold">Consent form unavailable</h2>
            <p className="text-sm text-slate-600">The active consent form could not be displayed. Retry the request or return to participant details.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton type="button" onClick={() => void loadConsentForm()}>Retry consent form</PrimaryButton>
            <Link className="secondary" to={`/participants/${participantId}?eventId=${eventId}`}>Return to participant details</Link>
          </div>
        </section>
      ) : (
        <form className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]" onSubmit={submit}>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">{consentForm.title}</h2>
            <p className="text-sm text-slate-600">Version {consentForm.versionNumber} · {consentForm.formCode}</p>
            <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6">{consentForm.contentText ?? `Secure document: ${consentForm.documentObjectKey}`}</div>
          </section>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <Field label="Decision"><select className="w-full rounded-xl border p-2" value={form.consentStatus} onChange={(event) => changeDecision(event.target.value)}><option value="ACCEPTED">Accept</option><option value="DECLINED">Decline</option></select></Field>
            <Field label="Consent given by"><select className="w-full rounded-xl border p-2" value={form.signerType} onChange={(event) => changeSignerType(event.target.value)}><option value="PARTICIPANT">Participant</option><option value="PARENT">Parent</option><option value="GUARDIAN">Guardian</option><option value="AUTHORISED_REPRESENTATIVE">Authorised representative</option></select></Field>
            <Field label={activeSignerLabels.name}><TextInput value={form.signerName} onChange={(event) => setForm({ ...form, signerName: event.target.value })} placeholder={`Enter ${activeSignerLabels.name.toLowerCase()}`} required /></Field>
            {representative ? <>
              <Field label={activeSignerLabels.relationship}><TextInput value={form.signerRelationship} onChange={(event) => setForm({ ...form, signerRelationship: event.target.value })} required /></Field>
              <Field label={activeSignerLabels.contactName}><TextInput value={form.guardianContactName} onChange={(event) => setForm({ ...form, guardianContactName: event.target.value })} required /></Field>
              <Field label={activeSignerLabels.phone}><TextInput type="tel" value={form.guardianContactPhone} onChange={(event) => setForm({ ...form, guardianContactPhone: event.target.value })} required /></Field>
              <Field label={activeSignerLabels.email}><TextInput type="email" value={form.guardianContactEmail} onChange={(event) => setForm({ ...form, guardianContactEmail: event.target.value })} /></Field>
            </> : null}
            {form.consentStatus === "ACCEPTED" ? (
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-slate-800">
                  {activeSignerLabels.person} electronic signature
                </p>
                <SignaturePad
                  key={`${form.signerType}-${form.consentStatus}`}
                  onChange={setSignatureDataUrl}
                />
              </div>
            ) : null}
            <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">Review: {form.signerName || `${activeSignerLabels.person} name required`} will {form.consentStatus.toLowerCase()} version {consentForm.versionNumber} as the {activeSignerLabels.person.toLowerCase()} signer.</div>
            <div className="flex flex-wrap gap-3">
              <Link className="secondary" to={`/participants/${participantId}/emergency-contacts?eventId=${eventId}`}>Back to emergency contact</Link>
              <PrimaryButton disabled={submitting} type="submit">{submitting ? "Recording…" : form.consentStatus === "ACCEPTED" ? "Accept and continue to review" : "Record decline and finish"}</PrimaryButton>
            </div>
          </section>
        </form>
      )}
    </AppShell>
  );
}

export function RegistrationReviewPage() {
  const navigate = useNavigate();
  const { participantId = "", eventId = "" } = useParams();
  const [review, setReview] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    apiClient.get(`/participants/${participantId}/events/${eventId}/review`)
      .then((response) => setReview(response.data))
      .catch((requestError: unknown) => setError(getApiError(requestError, "Unable to load review.")));
  }, [participantId, eventId]);
  async function createRegistration() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post(`/events/${eventId}/registrations`, { participantId }, {
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      navigate(`/registrations/${response.data.registrationId}/confirmation`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create registration."));
    } finally {
      setSubmitting(false);
    }
  }
  if (!review) return <AppShell title="Registration review"><FormErrorSummary error={error} /><LoadingState label="Loading review…" /></AppShell>;
  const canRegister = review.latestConsent?.consentStatus === "ACCEPTED"
    && !review.latestConsent.withdrawals?.some((item) => item.consentStatus === "WITHDRAWN")
    && Boolean(review.emergencyContact);
  return (
    <AppShell title="Registration review">
      <RegistrationJourney active="check-in" />
      <FormErrorSummary error={error} />
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div><span className="text-sm text-slate-500">Event</span><p className="font-semibold">{review.event.eventName} · {new Date(review.event.eventDate).toLocaleDateString()}</p></div>
        <div><span className="text-sm text-slate-500">Participant</span><p className="font-semibold">{review.participant.participantReference} · {review.participant.firstName} {review.participant.lastName}</p><p className="text-sm">DOB {new Date(review.participant.dateOfBirth).toLocaleDateString()}</p></div>
        <div><span className="text-sm text-slate-500">Emergency contact</span><p>{review.emergencyContact ? `${review.emergencyContact.contactName} · ${review.emergencyContact.relationship} · ${review.emergencyContact.phoneNumber}` : "Missing"}</p></div>
        <div><span className="text-sm text-slate-500">Consent</span><p>{review.latestConsent ? `${displayStatus(review.latestConsent.consentStatus)} · Version ${review.latestConsent.consentFormVersion.versionNumber}` : "Missing"}</p></div>
        {!canRegister ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Registration requires an active emergency contact and accepted, non-withdrawn consent.</p> : null}
        <div className="flex gap-3">
          <Link className="secondary" to={`/events/${eventId}/participants/${participantId}/consent`}>Back to consent</Link>
          <PrimaryButton disabled={!canRegister || submitting} type="button" onClick={() => void createRegistration()}>{submitting ? "Creating…" : "Confirm registration"}</PrimaryButton>
        </div>
      </div>
    </AppShell>
  );
}

export function RegistrationConfirmationPage() {
  const { registrationId = "" } = useParams();
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiClient.get(`/registrations/${registrationId}`)
      .then((response) => setRegistration(response.data.registration))
      .catch((requestError: unknown) => setError(getApiError(requestError, "Unable to load registration.")));
  }, [registrationId]);
  if (!registration) return <AppShell title="Registration confirmed"><FormErrorSummary error={error} /><LoadingState label="Loading result…" /></AppShell>;
  return (
    <AppShell title="Registration confirmed">
      <ParticipantBackLink
        to={`/events/${registration.eventId}/registrations`}
        label="Back to event registrations"
      />
      <RegistrationJourney active="qr" />
      <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-xl font-semibold text-emerald-950">Registration created successfully</h2>
        <p>{registration.participant.firstName} {registration.participant.lastName}</p>
        <p>{registration.participant.participantReference} · Queue {registration.queueNumber} · {displayStatus(registration.registrationStatus)}</p>
        <div className="flex flex-wrap gap-3">
          <Link className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white" to={`/registrations/${registration.id}/qr`}>Continue to QR / check-in</Link>
          <Link className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm" to={`/registrations/${registration.id}/history`}>View registration</Link>
          <Link className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm" to={`/participants/search?eventId=${registration.eventId}`}>Register another participant</Link>
        </div>
      </div>
    </AppShell>
  );
}

export function EventRegistrationsPage() {
  const { eventId = "" } = useParams();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  useEffect(() => { void apiClient.get(`/events/${eventId}/registrations`).then((response) => setRegistrations(response.data.registrations ?? [])); }, [eventId]);
  return (
    <AppShell title="Event registrations">
      <ParticipantBackLink to={`/events/${eventId}`} label="Back to event" />
      <div className="space-y-3">{registrations.map((registration) => <article key={registration.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">Queue {registration.queueNumber} · {registration.participant.participantReference}</p><p className="text-sm text-slate-600">{registration.participant.firstName} {registration.participant.lastName} · {displayStatus(registration.registrationStatus)}</p><Link className="text-sm underline" to={`/registrations/${registration.id}/history`}>View history</Link></article>)}</div>
    </AppShell>
  );
}

export function RegistrationHistoryPage() {
  const { registrationId = "" } = useParams();
  const [history, setHistory] = useState<RegistrationHistory[]>([]);
  useEffect(() => { void apiClient.get(`/registrations/${registrationId}/history`).then((response) => setHistory(response.data.history ?? [])); }, [registrationId]);
  return (
    <AppShell title="Registration history">
      <ParticipantBackLink to="/participants/search" label="Back to participant search" />
      <div className="space-y-3">{history.map((item) => <article key={item.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">{item.fromStatus ? displayStatus(item.fromStatus) : "New"} → {displayStatus(item.toStatus)}</p><p className="text-sm text-slate-600">{new Date(item.occurredAt).toLocaleString()} · {item.changedBy?.fullName ?? "Staff"} · {item.reason ?? "No reason"}</p></article>)}</div>
    </AppShell>
  );
}

export function ParticipantHistoryPage() {
  const { participantId = "" } = useParams();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  useEffect(() => { void apiClient.get(`/participants/${participantId}/registrations`).then((response) => setRegistrations(response.data.registrations ?? [])); }, [participantId]);
  return (
    <AppShell title="Participant registration history">
      <ParticipantBackLink to={`/participants/${participantId}`} label="Back to participant details" />
      <div className="space-y-3">{registrations.map((registration) => <article key={registration.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">{registration.event.eventName}</p><p className="text-sm">{displayStatus(registration.registrationStatus)} · Queue {registration.queueNumber}</p><Link className="text-sm underline" to={`/registrations/${registration.id}/history`}>Full status history</Link></article>)}</div>
    </AppShell>
  );
}

export function ParticipantConsentsPage() {
  const { participantId = "" } = useParams();
  const eventId = useEventIdFromRouteOrQuery();
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/participants/${participantId}/consents`);
      setConsents(response.data.consents ?? []);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to load consent history."));
    } finally {
      setIsLoading(false);
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
  return (
    <AppShell title="Consent history">
      <ParticipantBackLink
        to={`/participants/${participantId}${eventId ? `?eventId=${eventId}` : ""}`}
        label="Back to participant details"
      />
      <FormErrorSummary error={error} />
      {isLoading ? <LoadingState label="Loading consent history…" /> : null}
      {!isLoading && !error && consents.length === 0 ? (
        <section className="registration-panel no-match-panel">
          <ClipboardDocumentCheckIcon />
          <div>
            <h2 className="text-lg font-semibold">No consent recorded yet</h2>
            <p className="text-sm text-slate-600">Consent is recorded for a selected event. Choose an open event, search for this participant, and continue the event check-in.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className="primary" to="/events">Choose an event</Link>
            <Link className="secondary" to={`/participants/${participantId}`}>Return to participant details</Link>
          </div>
        </section>
      ) : null}
      <div className="space-y-3">{consents.map((consent) => {
        const withdrawn = consent.withdrawals.some((item) => item.consentStatus === "WITHDRAWN");
        return <article key={consent.id} className="rounded-xl border bg-white p-4"><p className="font-semibold">{consent.event.eventName} · {displayStatus(consent.consentStatus)}</p><p className="text-sm">Version {consent.consentFormVersion.versionNumber} · {new Date(consent.createdAt).toLocaleString()}</p>{consent.consentStatus === "ACCEPTED" && !withdrawn ? <div className="mt-3 flex gap-2"><TextInput placeholder="Withdrawal reason" value={reason[consent.id] ?? ""} onChange={(event) => setReason((current) => ({ ...current, [consent.id]: event.target.value }))} /><button className="rounded-xl border border-red-300 px-3 py-2 text-sm text-red-700" disabled={!reason[consent.id]?.trim()} onClick={() => void withdraw(consent.id)}>Withdraw</button></div> : withdrawn ? <p className="mt-2 text-sm text-amber-700">Withdrawn; original evidence preserved.</p> : null}</article>;
      })}</div>
    </AppShell>
  );
}

export function RegistrationQrPage() {
  const { registrationId = "" } = useParams();
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function generate() {
    try {
      const response = await apiClient.post(`/qr/registrations/${registrationId}`);
      setQrImage(response.data.qrImage);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to create QR pass."));
    }
  }
  return (
    <AppShell title="QR / check-in handoff">
      <ParticipantBackLink to={`/registrations/${registrationId}/history`} label="Back to registration history" />
      <RegistrationJourney active="qr" />
      <FormErrorSummary error={error} />
      <div className="space-y-4 rounded-2xl border bg-white p-5">
        <p className="text-sm text-slate-600">Only registration ID <strong>{registrationId}</strong> was passed into this module.</p>
        {!qrImage ? <PrimaryButton type="button" onClick={() => void generate()}>Generate secure QR pass</PrimaryButton> : <img className="h-72 w-72" src={qrImage} alt="Registration QR code" />}
      </div>
    </AppShell>
  );
}
