import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import apiClient from "../utils/apiClient";
import { AppShell, Field, FormErrorSummary, LoadingState, PrimaryButton, TextInput } from "../components/ui";

function useEventIdFromRouteOrQuery() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  return params.eventId ?? searchParams.get("eventId") ?? "";
}

export function EventRegistrationStartPage() {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<any>(null);

  useEffect(() => {
    void apiClient.get(`/events/${eventId}`).then((response) => setEvent(response.data.event));
  }, [eventId]);

  return (
    <AppShell title="Start registration">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{event?.eventName ?? "Selected event"}</h2>
        <p className="text-sm text-slate-600">This page is the hand-off point into the participant registration flow.</p>
        <div className="flex flex-wrap gap-3">
          <Link className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white" to={`/participants/search?eventId=${eventId}`}>
            Search existing participant
          </Link>
          <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700" to={`/participants/new?eventId=${eventId}`}>
            Create new participant
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

export function ParticipantSearchPage() {
  const eventId = useEventIdFromRouteOrQuery();
  const [name, setName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [participants, setParticipants] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const response = await apiClient.get("/participants", {
        params: {
          name: name || undefined,
          contactNumber: contactNumber || undefined,
          dateOfBirth: dateOfBirth || undefined,
        },
      });
      setParticipants(response.data.participants ?? []);
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Search failed.");
    }
  }

  return (
    <AppShell title="Participant search">
      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={handleSearch}>
          <h2 className="text-lg font-semibold">Search before create</h2>
          <FormErrorSummary error={error} />
          <Field label="Name">
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Contact number">
            <TextInput value={contactNumber} onChange={(event) => setContactNumber(event.target.value)} />
          </Field>
          <Field label="Date of birth">
            <TextInput value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} type="date" />
          </Field>
          <PrimaryButton type="submit">Search participants</PrimaryButton>
        </form>
        <section className="space-y-4">
          {participants.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
              No results yet. Search above or create a new participant.
            </div>
          ) : null}
          {participants.map((participant) => (
            <article key={participant.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-lg font-semibold">
                {participant.firstName} {participant.lastName}
              </h3>
              <p className="text-sm text-slate-600">
                {participant.contactNumber} - {new Date(participant.dateOfBirth).toLocaleDateString()}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700" to={`/participants/${participant.id}`}>
                  View profile
                </Link>
                {eventId ? (
                  <Link
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
                    to={`/events/${eventId}/participants/${participant.id}/consent`}
                  >
                    Continue registration
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}

export function ParticipantCreatePage() {
  const navigate = useNavigate();
  const eventId = useEventIdFromRouteOrQuery();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "M",
    contactNumber: "",
    emergencyContact: "",
  });
  const [error, setError] = useState<string | null>(null);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const response = await apiClient.post("/participants", form);
      const participantId = response.data.participant.id;
      if (eventId) {
        navigate(`/participants/${participantId}/emergency-contacts?eventId=${eventId}`);
      } else {
        navigate(`/participants/${participantId}`);
      }
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Unable to create participant.");
    }
  }

  return (
    <AppShell title="Create participant">
      <form className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-2" onSubmit={handleSubmit}>
        <div className="md:col-span-2">
          <FormErrorSummary error={error} />
        </div>
        <Field label="First name">
          <TextInput value={form.firstName} onChange={(event) => update("firstName", event.target.value)} required />
        </Field>
        <Field label="Last name">
          <TextInput value={form.lastName} onChange={(event) => update("lastName", event.target.value)} required />
        </Field>
        <Field label="Date of birth">
          <TextInput value={form.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} type="date" required />
        </Field>
        <Field label="Gender">
          <select
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            value={form.gender}
            onChange={(event) => update("gender", event.target.value)}
          >
            <option value="M">M</option>
            <option value="F">F</option>
            <option value="O">O</option>
          </select>
        </Field>
        <Field label="Contact number">
          <TextInput value={form.contactNumber} onChange={(event) => update("contactNumber", event.target.value)} required />
        </Field>
        <Field label="Emergency contact">
          <TextInput value={form.emergencyContact} onChange={(event) => update("emergencyContact", event.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <PrimaryButton type="submit">Create participant</PrimaryButton>
        </div>
      </form>
    </AppShell>
  );
}

export function ParticipantDetailPage() {
  const { participantId = "" } = useParams();
  const [participant, setParticipant] = useState<any>(null);

  useEffect(() => {
    void apiClient.get(`/participants/${participantId}`).then((response) => setParticipant(response.data.participant));
  }, [participantId]);

  if (!participant) {
    return (
      <AppShell title="Participant profile">
        <LoadingState label="Loading participant profile..." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Participant profile">
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-semibold">
            {participant.firstName} {participant.lastName}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {participant.contactNumber} - {participant.gender} - {new Date(participant.dateOfBirth).toLocaleDateString()}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700" to={`/participants/${participantId}/edit`}>
              Edit participant
            </Link>
            <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700" to={`/participants/${participantId}/emergency-contacts`}>
              Emergency contacts
            </Link>
            <Link className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700" to={`/participants/${participantId}/history`}>
              Registration history
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export function ParticipantEditPage() {
  const navigate = useNavigate();
  const { participantId = "" } = useParams();
  const [form, setForm] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiClient.get(`/participants/${participantId}`).then((response) => {
      const participant = response.data.participant;
      setForm({
        firstName: participant.firstName,
        lastName: participant.lastName,
        dateOfBirth: participant.dateOfBirth.slice(0, 10),
        gender: participant.gender,
        contactNumber: participant.contactNumber,
        emergencyContact: participant.emergencyContact,
      });
    });
  }, [participantId]);

  if (!form) {
    return (
      <AppShell title="Edit participant">
        <LoadingState label="Loading participant..." />
      </AppShell>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiClient.patch(`/participants/${participantId}`, form);
      navigate(`/participants/${participantId}`);
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Unable to update participant.");
    }
  }

  return (
    <AppShell title="Edit participant">
      <form className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-2" onSubmit={handleSubmit}>
        <div className="md:col-span-2">
          <FormErrorSummary error={error} />
        </div>
        {Object.entries(form).map(([key, value]) => (
          <Field key={key} label={key}>
            <TextInput
              type={key === "dateOfBirth" ? "date" : "text"}
              value={value as string}
              onChange={(event) => setForm((current: any) => ({ ...current, [key]: event.target.value }))}
            />
          </Field>
        ))}
        <div className="md:col-span-2">
          <PrimaryButton type="submit">Save participant</PrimaryButton>
        </div>
      </form>
    </AppShell>
  );
}

export function EmergencyContactsPage() {
  const navigate = useNavigate();
  const { participantId = "" } = useParams();
  const eventId = useEventIdFromRouteOrQuery();
  const [contacts, setContacts] = useState<any[]>([]);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [form, setForm] = useState({
    contactName: "",
    relationship: "",
    phoneNumber: "",
    email: "",
    isPrimary: true,
    status: "ACTIVE",
  });

  const loadContacts = async () => {
    const response = await apiClient.get(`/participants/${participantId}/emergency-contacts`);
    setContacts(response.data.contacts ?? []);
  };

  useEffect(() => {
    void loadContacts();
  }, [participantId]);

  function startEdit(contact: any) {
    setEditingContactId(contact.id);
    setForm({
      contactName: contact.contactName,
      relationship: contact.relationship,
      phoneNumber: contact.phoneNumber,
      email: contact.email ?? "",
      isPrimary: contact.isPrimary,
      status: contact.status,
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (editingContactId) {
      await apiClient.patch(`/participants/${participantId}/emergency-contacts/${editingContactId}`, form);
    } else {
      await apiClient.post(`/participants/${participantId}/emergency-contacts`, form);
    }

    setEditingContactId(null);
    setForm({
      contactName: "",
      relationship: "",
      phoneNumber: "",
      email: "",
      isPrimary: true,
      status: "ACTIVE",
    });
    await loadContacts();
  }

  return (
    <AppShell title="Emergency contacts">
      <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
        <section className="space-y-4">
          {contacts.map((contact) => (
            <article key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{contact.contactName}</h3>
                  <p className="text-sm text-slate-600">
                    {contact.relationship} - {contact.phoneNumber}
                  </p>
                </div>
                <button className="text-sm text-slate-700 underline" onClick={() => startEdit(contact)} type="button">
                  Edit
                </button>
              </div>
            </article>
          ))}
          {eventId ? (
            <PrimaryButton type="button" onClick={() => navigate(`/events/${eventId}/participants/${participantId}/consent`)}>
              Continue to consent
            </PrimaryButton>
          ) : null}
        </section>
        <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={handleSubmit}>
          <h2 className="text-lg font-semibold">{editingContactId ? "Edit contact" : "Add contact"}</h2>
          <Field label="Contact name">
            <TextInput value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} required />
          </Field>
          <Field label="Relationship">
            <TextInput value={form.relationship} onChange={(event) => setForm((current) => ({ ...current, relationship: event.target.value }))} required />
          </Field>
          <Field label="Phone number">
            <TextInput value={form.phoneNumber} onChange={(event) => setForm((current) => ({ ...current, phoneNumber: event.target.value }))} required />
          </Field>
          <Field label="Email">
            <TextInput value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} type="email" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={form.isPrimary}
              onChange={(event) => setForm((current) => ({ ...current, isPrimary: event.target.checked }))}
              type="checkbox"
            />
            Primary contact
          </label>
          <PrimaryButton type="submit">{editingContactId ? "Save contact" : "Add contact"}</PrimaryButton>
        </form>
      </div>
    </AppShell>
  );
}

export function ConsentPage() {
  const navigate = useNavigate();
  const { participantId = "", eventId = "" } = useParams();
  const [consentForm, setConsentForm] = useState<any>(null);
  const [consentStatus, setConsentStatus] = useState("ACCEPTED");
  const [signerName, setSignerName] = useState("");
  const [signerRelationship, setSignerRelationship] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiClient.get("/participants/active-consent-form").then((response) => setConsentForm(response.data.consentForm));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiClient.post(`/participants/${participantId}/events/${eventId}/consent`, {
        consentFormVersionId: consentForm.id,
        consentStatus,
        signerName,
        signerRelationship,
      });
      navigate(`/events/${eventId}/participants/${participantId}/review`);
    } catch (rawError: any) {
      setError(rawError.response?.data?.error ?? "Unable to save consent.");
    }
  }

  return (
    <AppShell title="Consent">
      {!consentForm ? <LoadingState label="Loading active consent form..." /> : null}
      {consentForm ? (
        <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">{consentForm.title}</h2>
            <p className="mt-2 text-sm text-slate-600">
              Form code: {consentForm.formCode} - Version: {consentForm.versionNumber}
            </p>
            <p className="mt-4 text-sm text-slate-600">
              This is a placeholder content block for the versioned consent document. The final UI can replace this with the rendered document content later.
            </p>
          </section>
          <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5" onSubmit={handleSubmit}>
            <FormErrorSummary error={error} />
            <Field label="Consent decision">
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                value={consentStatus}
                onChange={(event) => setConsentStatus(event.target.value)}
              >
                <option value="ACCEPTED">Accepted</option>
                <option value="DECLINED">Declined</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </select>
            </Field>
            <Field label="Signer name">
              <TextInput value={signerName} onChange={(event) => setSignerName(event.target.value)} />
            </Field>
            <Field label="Signer relationship">
              <TextInput value={signerRelationship} onChange={(event) => setSignerRelationship(event.target.value)} />
            </Field>
            <PrimaryButton type="submit">Save consent</PrimaryButton>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}

export function RegistrationReviewPage() {
  const navigate = useNavigate();
  const { participantId = "", eventId = "" } = useParams();
  const [review, setReview] = useState<any>(null);

  useEffect(() => {
    void apiClient
      .get(`/participants/${participantId}/events/${eventId}/review`)
      .then((response) => setReview(response.data));
  }, [participantId, eventId]);

  async function handleCreateRegistration() {
    const response = await apiClient.post("/registrations", {
      participantId,
      eventId,
    });
    navigate(`/registrations/${response.data.registration.id}/confirmation`);
  }

  if (!review) {
    return (
      <AppShell title="Registration review">
        <LoadingState label="Loading review summary..." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Registration review">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">
          {review.participant.firstName} {review.participant.lastName}
        </h2>
        <p className="text-sm text-slate-600">Event: {review.event.eventName}</p>
        <p className="text-sm text-slate-600">
          Consent: {review.latestConsent?.consentStatus ?? "No consent on file"}
        </p>
        <div className="rounded-xl bg-slate-100 p-4 text-sm text-slate-700">
          This page intentionally focuses on the data hand-off and registration confirmation logic instead of the final visual design.
        </div>
        <PrimaryButton type="button" onClick={handleCreateRegistration}>
          Create registration
        </PrimaryButton>
      </div>
    </AppShell>
  );
}

export function RegistrationConfirmationPage() {
  const { registrationId = "" } = useParams();
  const [registration, setRegistration] = useState<any>(null);

  useEffect(() => {
    void apiClient.get(`/registrations/${registrationId}`).then((response) => setRegistration(response.data.registration));
  }, [registrationId]);

  if (!registration) {
    return (
      <AppShell title="Registration confirmed">
        <LoadingState label="Loading registration..." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Registration confirmed">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-xl font-semibold text-emerald-900">Registration created successfully</h2>
        <p className="mt-2 text-sm text-emerald-800">
          Registration ID: {registration.id} - Queue number: {registration.queueNumber}
        </p>
        <p className="mt-2 text-sm text-emerald-800">
          Participant: {registration.participant.firstName} {registration.participant.lastName}
        </p>
      </div>
    </AppShell>
  );
}

export function ParticipantHistoryPage() {
  const { participantId = "" } = useParams();
  const [registrations, setRegistrations] = useState<any[]>([]);

  useEffect(() => {
    void apiClient.get(`/participants/${participantId}/registrations`).then((response) => setRegistrations(response.data.registrations ?? []));
  }, [participantId]);

  return (
    <AppShell title="Participant registration history">
      <div className="space-y-4">
        {registrations.map((registration) => (
          <article key={registration.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold">{registration.event.eventName}</h2>
            <p className="text-sm text-slate-600">
              Status: {registration.registrationStatus} - Queue: {registration.queueNumber}
            </p>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
