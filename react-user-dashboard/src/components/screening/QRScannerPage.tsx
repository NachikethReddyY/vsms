import { useNavigate } from "react-router-dom";
import "./Queue.css";

export default function QRScannerPage() {

    const navigate = useNavigate();

    const handleScan = () => {

        navigate("/verify", {
            state: {
                qrToken: "abc123"
            }
        });

    };

    return (

        <div className="queue-page">

            <div className="queue-card">

                <h1>Scan Participant QR</h1>

                <p>
                    Position the participant's QR code inside the frame.
                </p>

                <div className="scanner-box">

                    📷

                </div>

                <button onClick={handleScan}>
                    Simulate QR Scan
                </button>

            </div>

        </div>

    );

}