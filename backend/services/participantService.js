import axios from "axios";

// Adjust your base URL if your app uses an explicit API prefix (e.g., /api)
const API_URL = "/api/participants";

/**
 * Creates a participant for a specific event
 * @param {string} eventId - Must be a valid UUID string
 * @param {Object} participantData - The participant's form fields (fullName, email, phone)
 */
export const createParticipant = async (eventId, participantData) => {
  try {
    // Safety check right before sending to catch missing IDs early
    if (!eventId) {
      throw new Error("A valid eventId (UUID) is required to create a participant.");
    }

    console.log(`Sending POST request to: ${API_URL}/${eventId}`, participantData);

    const response = await axios.post(`${API_URL}/${eventId}`, participantData, {
      withCredentials: true, // Required if your backend uses cookies for authentication/CSRF
    });

    return response.data;
  } catch (error) {
    console.error("Error in createParticipant service:", error.response?.data || error.message);
    throw error;
  }
};