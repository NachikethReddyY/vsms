import { useEffect, useState } from "react";
import { useParams } from "react";
import axios from "axios";
import "./ParticipantStatus.css"; // optional custom CSS

interface ParticipantData {
  qrId: string;
  registrationId: string;
  participant: {
    id: string;
    firstName: string;
    lastName: string;
    nric: string;
  };
  event: {
    id: string;
    eventName: string;
  };
  queueNumber?: number | string;
  expiresAt: string;
  isActive: boolean;
}

function ParticipantStatusPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ParticipantData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (token) {
      fetchParticipantStatus(token);
    }
  }, [token]);

  async function fetchParticipantStatus(qrToken: string) {
    try {
      setLoading(true);
      // Fetch participant details using the token from the backend
      const res = await axios.get(
        `http://${window.location.hostname}:5000/qr/participant/${qrToken}`
      );
      
      const payload = res.data?.data || res.data;
      setData(payload);
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || "Invalid or expired QR pass.");
      } else {
        setError("Unable to load participant pass status.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", fontFamily: "sans-serif" }}>
        <h2>⌛ Loading Participant Pass...</h2>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#d9534f", fontFamily: "sans-serif" }}>
        <h2>⚠️ Invalid or Expired Pass</h2>
        <p>{error || "The scanned QR pass could not be verified."}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "500px", margin: "30px auto", padding: "20px", fontFamily: "sans-serif" }}>
      <div
        style={{
          border: "1px solid #e0e0e0",
          borderRadius: "12px",
          padding: "24px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          backgroundColor: "#fff",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <span style={{ fontSize: "12px", textTransform: "uppercase", color: "#0066cc", fontWeight: "bold" }}>
            Visual Screening Pass
          </span>
          <h2 style={{ margin: "8px 0", color: "#111" }}>
            {data.participant.firstName} {data.participant.lastName}
          </h2>
          <span
            style={{
              display: "inline-block",
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: "bold",
              backgroundColor: data.isActive ? "#e6f4ea" : "#fce8e6",
              color: data.isActive ? "#137333" : "#c5221f",
            }}
          >
            {data.isActive ? "ACTIVE PASS" : "REVOKED / INACTIVE"}
          </span>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "20px 0" }} />

        <div style={{ lineHeight: "1.8", color: "#444" }}>
          <p>
            <strong>Event:</strong> {data.event?.eventName || "N/A"}
          </p>
          <p>
            <strong>Queue Number:</strong>{" "}
            <span style={{ fontSize: "18px", fontWeight: "bold", color: "#0066cc" }}>
              #{data.queueNumber || "N/A"}
            </span>
          </p>
          <p>
            <strong>Participant ID:</strong> <code>{data.participant.id}</code>
          </p>
          <p>
            <strong>Expires At:</strong> {new Date(data.expiresAt).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

export default ParticipantStatusPage;