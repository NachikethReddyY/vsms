import { ArrowLeftIcon, CheckCircleIcon, EnvelopeIcon, PencilSquareIcon, PhoneIcon, StarIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PhoneInput } from "../../components/PhoneInput";
import type { EmergencyContact } from "../../types";
import apiClient, { getApiError } from "../../utils/apiClient";
import { isValidParticipantPhoneNumber } from "../../utils/phone";
import "./ParticipantPage.css";
import "./ParticipantEmergencyContactsPage.css";

type ContactForm = {
  contactName: string;
  relationship: string;
  phoneNumber: string;
  email: string;
  isPrimary: boolean;
  status: "ACTIVE" | "REMOVED";
};

const emptyContact: ContactForm = {
  contactName: "",
  relationship: "",
  phoneNumber: "",
  email: "",
  isPrimary: true,
  status: "ACTIVE",
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactError(form: ContactForm) {
  if (!form.contactName.trim()) return "Contact name is required.";
  if (!form.relationship.trim()) return "Relationship to the participant is required.";
  if (!isValidParticipantPhoneNumber(form.phoneNumber)) return "Enter a valid contact number.";
  if (form.email.trim() && !emailPattern.test(form.email.trim())) return "Enter a valid email address.";
  return null;
}

export default function ParticipantEmergencyContactsPage() {
  const { participantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId") ?? "";
  const profileLink = `/participants/${participantId}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`;
  const emergencyContactsPath = `/participants/${participantId}/emergency-contacts`;
  const eventRequestConfig = eventId ? { headers: { "X-Event-Id": eventId } } : undefined;
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [form, setForm] = useState<ContactForm>(emptyContact);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [primaryUpdatingId, setPrimaryUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.get(emergencyContactsPath, {
        headers: eventId ? { "X-Event-Id": eventId } : undefined,
      });
      setContacts(response.data.contacts ?? []);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to load emergency contacts."));
    } finally {
      setIsLoading(false);
    }
  }, [emergencyContactsPath, eventId]);

  useEffect(() => { void loadContacts(); }, [loadContacts]);

  const activeContacts = useMemo(() => contacts.filter((contact) => contact.status === "ACTIVE"), [contacts]);
  const hasPrimary = activeContacts.some((contact) => contact.isPrimary);

  function editContact(contact: EmergencyContact) {
    setEditingId(contact.id);
    setForm({
      contactName: contact.contactName,
      relationship: contact.relationship,
      phoneNumber: contact.phoneNumber,
      email: contact.email ?? "",
      isPrimary: contact.isPrimary,
      status: contact.status === "REMOVED" ? "REMOVED" : "ACTIVE",
    });
    setError(null);
    setNotice(null);
  }

  function startNewContact() {
    setEditingId(null);
    setForm({ ...emptyContact, isPrimary: !hasPrimary });
    setError(null);
    setNotice(null);
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = contactError(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (editingId) await apiClient.patch(`${emergencyContactsPath}/${editingId}`, form, eventRequestConfig);
      else await apiClient.post(emergencyContactsPath, form, eventRequestConfig);
      await loadContacts();
      setNotice(editingId ? "Emergency contact updated." : "Emergency contact added.");
      setEditingId(null);
      setForm({ ...emptyContact });
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to save emergency contact."));
    } finally {
      setIsSaving(false);
    }
  }

  async function makePrimary(contact: EmergencyContact) {
    if (contact.isPrimary || contact.status !== "ACTIVE") return;
    setPrimaryUpdatingId(contact.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.patch(`${emergencyContactsPath}/${contact.id}`, {
        contactName: contact.contactName,
        relationship: contact.relationship,
        phoneNumber: contact.phoneNumber,
        email: contact.email ?? "",
        isPrimary: true,
        status: "ACTIVE",
      }, eventRequestConfig);
      await loadContacts();
      setNotice(`${contact.contactName} is now the primary emergency contact.`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to update the primary contact."));
    } finally {
      setPrimaryUpdatingId(null);
    }
  }

  async function removeContact(contact: EmergencyContact) {
    if (contact.status !== "ACTIVE") return;
    setPrimaryUpdatingId(contact.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.patch(`${emergencyContactsPath}/${contact.id}`, {
        contactName: contact.contactName,
        relationship: contact.relationship,
        phoneNumber: contact.phoneNumber,
        email: contact.email ?? "",
        isPrimary: false,
        status: "REMOVED",
      }, eventRequestConfig);
      await loadContacts();
      setNotice(`${contact.contactName} was removed from the active contacts.`);
    } catch (requestError: unknown) {
      setError(getApiError(requestError, "Unable to remove emergency contact."));
    } finally {
      setPrimaryUpdatingId(null);
    }
  }

  return (
    <section className="participant-v2-page participant-emergency-page" aria-labelledby="emergency-contacts-title">
      <Link className="participant-v2-back" to={profileLink}><ArrowLeftIcon /> Back to participant profile</Link>
      <header className="participant-emergency-heading">
        <span><PhoneIcon /></span>
        <div><p>Participant details</p><h1 id="emergency-contacts-title">Emergency contacts</h1><small>Add and maintain the people staff should contact if support is needed.</small></div>
        <strong className={hasPrimary ? "complete" : "missing"}>{hasPrimary ? <><CheckCircleIcon /> Primary contact set</> : "Primary contact needed"}</strong>
      </header>

      {error ? <p className="participant-v2-alert" role="alert">{error}</p> : null}
      {notice ? <p className="participant-emergency-notice" role="status">{notice}</p> : null}

      <div className="participant-emergency-layout">
        <section className="participant-emergency-list" aria-label="Recorded emergency contacts">
          <header><div><span>Recorded contacts</span><h2>{activeContacts.length ? `${activeContacts.length} active contact${activeContacts.length === 1 ? "" : "s"}` : "No active contacts"}</h2></div></header>
          {isLoading ? <p className="participant-emergency-loading">Loading emergency contacts...</p> : null}
          {!isLoading && activeContacts.length === 0 ? <div className="participant-emergency-empty"><PhoneIcon /><h3>No emergency contact recorded</h3><p>Use the form to add a primary contact before continuing to consent and registration.</p></div> : null}
          {!isLoading && activeContacts.length > 0 ? <div className="participant-emergency-cards">{activeContacts.map((contact) => (
            <article key={contact.id} className={contact.isPrimary ? "is-primary" : ""}>
              <div className="participant-emergency-card-main"><span className="participant-emergency-avatar">{contact.contactName.slice(0, 1).toUpperCase()}</span><div className="participant-emergency-card-details"><div className="participant-emergency-card-name"><h3>{contact.contactName}</h3>{contact.isPrimary ? <strong><StarIcon /> Primary</strong> : null}</div><p>{contact.relationship}</p><div className="participant-emergency-card-meta"><a href={`tel:${contact.phoneNumber.replace(/\s/g, "")}`}><PhoneIcon /> {contact.phoneNumber}</a>{contact.email ? <a href={`mailto:${contact.email}`} title={contact.email}><EnvelopeIcon /> {contact.email}</a> : null}</div></div></div>
              <div className="participant-emergency-card-actions"><button type="button" onClick={() => editContact(contact)}><PencilSquareIcon /> Edit</button>{!contact.isPrimary ? <button className="make-primary" type="button" disabled={primaryUpdatingId === contact.id} onClick={() => void makePrimary(contact)}><StarIcon /> {primaryUpdatingId === contact.id ? "Updating..." : "Make primary"}</button> : null}<button className="remove-contact" type="button" disabled={primaryUpdatingId === contact.id} onClick={() => void removeContact(contact)} aria-label={`Remove ${contact.contactName}`}><TrashIcon /> Remove</button></div>
            </article>
          ))}</div> : null}
        </section>

        <form className="participant-emergency-form" onSubmit={saveContact} noValidate>
          <header><span>{editingId ? "Edit contact" : "New contact"}</span><h2>{editingId ? "Update emergency contact" : "Add emergency contact"}</h2><p>Mark one active contact as primary for faster staff reference.</p></header>
          <label>Full name<input value={form.contactName} maxLength={150} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label>
          <label>Relationship<input value={form.relationship} maxLength={60} onChange={(event) => setForm({ ...form, relationship: event.target.value })} /></label>
          <label>Contact number<PhoneInput value={form.phoneNumber} onChange={(value) => setForm({ ...form, phoneNumber: value })} /></label>
          <label>Email <small>optional</small><input type="email" value={form.email} maxLength={255} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          {editingId ? <label>Contact status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ContactForm["status"], isPrimary: event.target.value === "REMOVED" ? false : form.isPrimary })}><option value="ACTIVE">Active</option><option value="REMOVED">Removed</option></select></label> : null}
          <label className="participant-emergency-primary-toggle"><input type="checkbox" checked={form.isPrimary} disabled={form.status === "REMOVED"} onChange={(event) => setForm({ ...form, isPrimary: event.target.checked })} /><span><StarIcon /></span><div><strong>Primary contact</strong><small>Shown first to staff during registration and check-in.</small></div></label>
          <footer><button className="secondary" type="button" onClick={startNewContact}>Clear</button><button className="primary" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : editingId ? "Save changes" : "Add contact"}</button></footer>
        </form>
      </div>
    </section>
  );
}

