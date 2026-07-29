import { ArrowLeftIcon, IdentificationIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getApiMessage } from '../../auth/authState';
import apiClient from '../../utils/apiClient';

type ParticipantProfile = {
  participantId: string;
  nricMasked: string;
  firstName: string;
  lastName: string;
  displayName: string;
  dateOfBirth: string | null;
  gender: string | null;
  contactNumber: string | null;
  emergencyContact: string | null;
  emergencyContactName: string | null;
  consentGiven: boolean;
  version: number;
};

type ParticipantProfileResponse = { participant: ParticipantProfile };

type ProfileForm = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  contactNumber: string;
  emergencyContactName: string;
  emergencyContact: string;
};

type ParticipantLocationState = { eventName?: string };

const toProfileForm = (participant: ParticipantProfile): ProfileForm => ({
  firstName: participant.firstName,
  lastName: participant.lastName,
  dateOfBirth: participant.dateOfBirth ?? '',
  gender: participant.gender ?? '',
  contactNumber: participant.contactNumber ?? '',
  emergencyContactName: participant.emergencyContactName ?? '',
  emergencyContact: participant.emergencyContact ?? '',
});

export default function ParticipantDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { participantId } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') ?? '';
  const eventName = (location.state as ParticipantLocationState | null)?.eventName;
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let isCurrent = true;
    const loadProfile = async () => {
      if (!participantId || !eventId) {
        setError('Open this page from a participant search so the selected event is included.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const { data } = await apiClient.get<ParticipantProfileResponse>(`/api/participants/${participantId}`, { params: { eventId } });
        if (!isCurrent) return;
        setProfile(data.participant);
        setForm(toProfileForm(data.participant));
      } catch (requestError) {
        if (isCurrent) setError(getApiMessage(requestError, 'Participant details could not be loaded. Please try again.'));
      } finally {
        if (isCurrent) setLoading(false);
      }
    };
    void loadProfile();
    return () => { isCurrent = false; };
  }, [eventId, participantId]);

  const updateField = (field: keyof ProfileForm, value: string) => {
    setForm((current) => current ? { ...current, [field]: value } : current);
    setSuccess('');
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || !form) return;

    setError('');
    if (!form.firstName.trim() || !form.lastName.trim() || !form.dateOfBirth || !form.gender || !form.contactNumber.trim() || !form.emergencyContact.trim()) {
      setError('Fill in the required basic details before saving.');
      return;
    }

    setSaving(true);
    try {
      const { data } = await apiClient.patch<ParticipantProfileResponse>(`/api/participants/${profile.participantId}`, {
        eventId,
        version: profile.version,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        contactNumber: form.contactNumber.trim(),
        emergencyContactName: form.emergencyContactName.trim() || null,
        emergencyContact: form.emergencyContact.trim(),
      });
      setProfile(data.participant);
      setForm(toProfileForm(data.participant));
      setSuccess('Participant details saved.');
    } catch (requestError) {
      setError(getApiMessage(requestError, 'Participant details could not be saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-frame participant-details-page">
      <button type="button" className="back-link" onClick={() => navigate('/participant-search')}><ArrowLeftIcon />Back to participant lookup</button>
      <section className="page-heading participant-details-heading">
        <div>
          <p className="eyebrow">Participant profile</p>
          <h1>{profile?.displayName || 'Edit participant details'}</h1>
          <p>{eventName ? `Updating details for ${eventName}.` : 'Update the participant’s basic contact and personal details.'}</p>
        </div>
      </section>

      <section className="participant-details-panel" aria-labelledby="participant-details-form-title">
        <header><div className="participant-details-icon"><PencilSquareIcon /></div><div><h2 id="participant-details-form-title">Basic details</h2><p>NRIC/FIN stays hidden. Consent is read-only here.</p></div></header>
        {loading ? <div className="participant-details-loading"><span className="spinner" />Loading participant details…</div> : profile && form ? <form onSubmit={save} noValidate>
          {error && <div className="alert error" role="alert"><span>{error}</span></div>}
          {success && <div className="alert success" role="status"><span>{success}</span></div>}
          <div className="participant-details-meta"><span><IdentificationIcon />Masked ID: <strong>{profile.nricMasked}</strong></span><span>Consent: <strong>{profile.consentGiven ? 'Recorded' : 'Not recorded'}</strong></span></div>
          <div className="participant-details-fields">
            <label><span>First name</span><input value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} maxLength={100} required /></label>
            <label><span>Last name</span><input value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} maxLength={100} required /></label>
            <label><span>Date of birth</span><input type="date" value={form.dateOfBirth} onChange={(event) => updateField('dateOfBirth', event.target.value)} required /></label>
            <label><span>Gender</span><select value={form.gender} onChange={(event) => updateField('gender', event.target.value)} required><option value="">Select</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select></label>
            <label><span>Contact number</span><input type="tel" value={form.contactNumber} onChange={(event) => updateField('contactNumber', event.target.value)} maxLength={20} required /></label>
            <label><span>Emergency contact name <small>optional</small></span><input value={form.emergencyContactName} onChange={(event) => updateField('emergencyContactName', event.target.value)} maxLength={100} /></label>
            <label><span>Emergency contact number</span><input type="tel" value={form.emergencyContact} onChange={(event) => updateField('emergencyContact', event.target.value)} maxLength={20} required /></label>
          </div>
          <footer><p>Changes are saved to the participant profile and recorded in the audit log.</p><div><button type="button" className="secondary" onClick={() => navigate('/participant-search')} disabled={saving}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button></div></footer>
        </form> : <div className="participant-details-error"><p>{error || 'Participant details are unavailable.'}</p><button type="button" className="secondary" onClick={() => navigate('/participant-search')}>Back to lookup</button></div>}
      </section>
    </div>
  );
}
