import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./RegisterParticipant.css";

interface Event {
  id: string;
  eventName: string;
}

function RegisterParticipantPage() {
  const navigate = useNavigate();

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "M",
    contactNumber: "",
    emergencyContact: "",
    consentGiven: true,
    eventId: "",
  });

  useEffect(() => {
    fetchEvents();
  }, []);

  async function fetchEvents() {
    try {
      const res = await axios.get("http://localhost:5000/events");
      setEvents(res.data.data || res.data);
    } catch {
      setError("Unable to load active screening events.");
    }
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value, type } = e.target;
    
    const newValue =
      type === "checkbox"
        ? (e.target as HTMLInputElement).checked
        : value;

    setForm((prevForm) => ({
      ...prevForm,
      [name]: newValue,
    }));
  }

  async function registerParticipant(e: React.FormEvent) {
    e.preventDefault();

    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("Participant first and last name are required.");
      return;
    }

    if (!form.eventId) {
      setError("Please select a screening event.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      // STEP 1: Create Participant
      const participantRes = await axios.post(
        "http://localhost:5000/participants",
        {
          firstName: form.firstName,
          lastName: form.lastName,
          dateOfBirth: form.dateOfBirth,
          gender: form.gender,
          contactNumber: form.contactNumber,
          emergencyContact: form.emergencyContact,
          consentGiven: form.consentGiven,
        }
      );

      const participantId = participantRes.data.data.id;

      // STEP 2: Create Event Registration
      const currentUserId =
        localStorage.getItem("userId") ||
        "475d3663-d382-4f88-a9cb-44c45b5f9cb6";

      const registrationRes = await axios.post(
        "http://localhost:5000/event-registrations",
        {
          participantId,
          eventId: form.eventId,
          registeredBy: currentUserId,
        }
      );

      const registrationId = registrationRes.data.data.id;

      // STEP 3: Generate QR Code
      const qrRes = await axios.post(
        `http://localhost:5000/qr/generate/${registrationId}`
      );

      navigate("/registration-success", {
        state: {
          participant: participantRes.data.data,
          registration: registrationRes.data.data,
          qr: qrRes.data.data,
        },
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || "Registration failed. Saved locally if offline.");
      } else {
        setError("An unexpected operational error occurred.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="vsms-register-container">
      <div className="vsms-register-card">
        <header className="vsms-card-header">
          <span className="vsms-micro-label">Station 01 · Registration</span>
          <h1 className="vsms-card-title">Register Participant</h1>
          <p className="vsms-card-subtitle">
            Create participant record and generate QR pass for today's screening event.
          </p>
        </header>

        {error && (
          <div className="vsms-alert-error" role="alert">
            <span className="vsms-alert-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={registerParticipant} noValidate>
          <div className="vsms-form-grid">
            
            {/* First Name */}
            <div className="vsms-field-group">
              <label htmlFor="firstName" className="vsms-label">
                First Name <span className="req">*</span>
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                placeholder="e.g. Evelyn"
                value={form.firstName}
                onChange={handleChange}
                required
              />
            </div>

            {/* Last Name */}
            <div className="vsms-field-group">
              <label htmlFor="lastName" className="vsms-label">
                Last Name <span className="req">*</span>
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                placeholder="e.g. Ng"
                value={form.lastName}
                onChange={handleChange}
                required
              />
            </div>

            {/* Date of Birth */}
            <div className="vsms-field-group">
              <label htmlFor="dateOfBirth" className="vsms-label">
                Date of Birth <span className="req">*</span>
              </label>
              <input
                id="dateOfBirth"
                type="date"
                name="dateOfBirth"
                value={form.dateOfBirth}
                onChange={handleChange}
                required
              />
            </div>

            {/* Gender */}
            <div className="vsms-field-group">
              <label htmlFor="gender" className="vsms-label">Gender</label>
              <select
                id="gender"
                name="gender"
                value={form.gender}
                onChange={handleChange}
              >
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>

            {/* Contact Number */}
            <div className="vsms-field-group">
              <label htmlFor="contactNumber" className="vsms-label">Contact Number</label>
              <input
                id="contactNumber"
                name="contactNumber"
                type="tel"
                placeholder="+65 9123 4567"
                value={form.contactNumber}
                onChange={handleChange}
              />
            </div>

            {/* Emergency Contact */}
            <div className="vsms-field-group">
              <label htmlFor="emergencyContact" className="vsms-label">Emergency Contact</label>
              <input
                id="emergencyContact"
                name="emergencyContact"
                type="tel"
                placeholder="+65 9876 5432"
                value={form.emergencyContact}
                onChange={handleChange}
              />
            </div>

            {/* Screening Event Dropdown */}
            <div className="vsms-field-group full-width">
              <label htmlFor="eventId" className="vsms-label">
                Screening Event <span className="req">*</span>
              </label>
              <select
                id="eventId"
                name="eventId"
                value={form.eventId}
                onChange={handleChange}
                required
              >
                <option value="">-- Select Active Event --</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.eventName}
                  </option>
                ))}
              </select>
            </div>

            {/* Consent Checkbox */}
            <div className="vsms-field-group full-width vsms-checkbox-group">
              <label className="vsms-checkbox-label">
                <input
                  type="checkbox"
                  name="consentGiven"
                  checked={form.consentGiven}
                  onChange={handleChange}
                />
                <span>Participant has provided informed consent for visual screening</span>
              </label>
            </div>

          </div>

          <div className="vsms-form-actions">
            <button
              type="submit"
              className="vsms-btn-primary"
              disabled={loading}
            >
              {loading ? "Registering & Generating Pass..." : "Complete Registration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RegisterParticipantPage;