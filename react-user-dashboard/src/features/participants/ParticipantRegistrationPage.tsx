import { ArrowLeftIcon, ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

type RegistrationLocationState = {
  participantName?: string;
  eventName?: string;
};

export default function ParticipantRegistrationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { participantId } = useParams();
  const [searchParams] = useSearchParams();
  const state = location.state as RegistrationLocationState | null;
  const eventId = searchParams.get('eventId');

  return (
    <div className="page-frame participant-registration-page">
      <button type="button" className="back-link" onClick={() => navigate('/participant-search')}><ArrowLeftIcon />Back to participant lookup</button>
      <section className="page-heading participant-registration-heading">
        <div>
          <p className="eyebrow">Registration workspace</p>
          <h1>Register participant</h1>
          <p>This is the next screen in the flow. Registration, check-in, and queue actions have deliberately not been added yet.</p>
        </div>
      </section>
      <section className="participant-registration-placeholder" aria-labelledby="registration-placeholder-title">
        <div className="participant-registration-icon"><ClipboardDocumentCheckIcon /></div>
        <div><h2 id="registration-placeholder-title">Registration setup</h2><p>Use this page as the destination for the Register button while the full registration form is built.</p></div>
        <dl>
          <div><dt>Participant</dt><dd>{state?.participantName || `Participant ${participantId?.slice(0, 8) || 'not selected'}`}</dd></div>
          <div><dt>Event</dt><dd>{state?.eventName || (eventId ? `Selected event ${eventId.slice(0, 8)}` : 'No event selected')}</dd></div>
        </dl>
        <button type="button" className="primary" onClick={() => navigate('/participant-search')}>Return to lookup</button>
      </section>
    </div>
  );
}
