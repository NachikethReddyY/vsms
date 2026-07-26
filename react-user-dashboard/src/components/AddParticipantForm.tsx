import { useState } from "react";
import { useParams } from "react-router-dom";
import { createParticipant } from "../services/participantService";

const AddParticipantForm = () => {
  // Automatically extracts the eventId (UUID) from the URL route (e.g., /events/:eventId/participants/new)
  const { eventId } = useParams();

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      // Debug log to confirm UUID is present before sending request
      console.log("Submitting participant for Event UUID:", eventId);

      await createParticipant(eventId, formData);

      setMessage("Participant added successfully!");
      setFormData({ fullName: "", email: "", phone: "" }); // Reset form
    } catch (err) {
      setMessage("Failed to add participant. Check console/network logs.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "400px", margin: "2rem auto", padding: "1.5rem", border: "1px solid #ccc", borderRadius: "8px" }}>
      <h2>Add Participant</h2>
      {message && <p style={{ color: message.includes("success") ? "green" : "red" }}>{message}</p>}
      
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label>Full Name:</label>
          <input
            type="text"
            name="fullName"
            value={formData.fullName}
            onChange={handleChange}
            required
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </div>

        <div>
          <label>Email:</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </div>

        <div>
          <label>Phone:</label>
          <input
            type="text"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            style={{ width: "100%", padding: "0.5rem" }}
          />
        </div>

        <button type="submit" disabled={loading} style={{ padding: "0.7rem", background: "#007BFF", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
          {loading ? "Submitting..." : "Add Participant"}
        </button>
      </form>
    </div>
  );
};

export default AddParticipantForm;