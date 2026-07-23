import { useLocation, useNavigate } from "react-router-dom";
import "./RegistrationSuccess.css";

interface LocationState {
  participant?: {
    id: string;
    firstName: string;
    lastName: string;
    contactNumber: string;
  };
  registration?: {
    id: string;
    registeredAt: string;
  };
  qr?: {
    qrCodeDataUrl: string;
  };
}

function RegistrationSuccessPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState;

  if (!state || !state.participant) {
    return (
      <div className="success-page">
        <div className="success-card">
          <h2>No Registration Found</h2>
          <p>Please register a participant first.</p>
          <button onClick={() => navigate("/register")}>Go to Register</button>
        </div>
      </div>
    );
  }

  const { participant, registration, qr } = state;

  return (
    <div className="success-page">
      <div className="success-card">
        <div className="success-badge">✓ Registration Complete</div>
        <h1>Participant Pass</h1>

        <div className="qr-container">
          {qr?.qrCodeDataUrl ? (
            <img src={qr.qrCodeDataUrl} alt="Participant QR Code" />
          ) : (
            <div className="qr-placeholder">QR Code Unavailable</div>
          )}
        </div>

        <div className="details-list">
          <div className="detail-item">
            <span>Name:</span>
            <strong>{`${participant.firstName} ${participant.lastName}`}</strong>
          </div>
          <div className="detail-item">
            <span>Participant ID:</span>
            <code>{participant.id}</code>
          </div>
          <div className="detail-item">
            <span>Registration ID:</span>
            <code>{registration?.id}</code>
          </div>
          <div className="detail-item">
            <span>Contact:</span>
            <strong>{participant.contactNumber || "N/A"}</strong>
          </div>
        </div>

        <div className="actions">
          <button onClick={() => window.print()} className="btn-secondary">
            Print Pass / QR
          </button>
          <button onClick={() => navigate("/register")} className="btn-primary">
            Register Another Participant
          </button>
        </div>
      </div>
    </div>
  );
}

export default RegistrationSuccessPage;