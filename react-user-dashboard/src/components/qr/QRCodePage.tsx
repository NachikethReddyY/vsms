import { useState } from "react";
import QRCode from "./QRCode";
import "./QRCodePage.css";


function QRCodePage() {

    const [qrImage, setQrImage] = useState<string>("");
    const [token, setToken] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>("");


    const participantId =
        "a7f80a89-0989-44df-a547-2a3192efc624";


    const generateQR = async () => {

        try {

            setLoading(true);
            setError("");

            const response = await fetch(
                `http://localhost:5000/qr/generate/${participantId}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );


            if (!response.ok) {
                throw new Error("Unable to generate event pass");
            }


            const data = await response.json();

            setQrImage(data.qrImage);
            setToken(data.token);


        } catch (err) {

            setError(
                err instanceof Error
                    ? err.message
                    : "Unexpected error occurred"
            );


        } finally {

            setLoading(false);

        }

    };



    return (

        <main className="qr-page">


            <section className="qr-header">

                <p className="qr-overline">
                    PARTICIPANT ACCESS
                </p>


                <h1>
                    Generate QR event pass
                </h1>


                <p className="qr-description">
                    Create a secure QR pass for participant
                    check-in. Clinical information is never
                    stored inside the QR code.
                </p>


            </section>



            <section className="qr-workspace">


                <div className="qr-information">


                    <div>

                        <span className="qr-label">
                            Participant
                        </span>

                        <p className="qr-value">
                            David Lee
                        </p>

                    </div>



                    <div>

                        <span className="qr-label">
                            Status
                        </span>

                        <p className="qr-value qr-status">
                            ● Ready
                        </p>

                    </div>


                </div>




                <button
                    className="generate-btn"
                    onClick={generateQR}
                    disabled={loading}
                >

                    {loading
                        ? "Generating..."
                        : "Generate new QR pass"
                    }

                </button>




                {
                    error && (
                        <p className="qr-error">
                            {error}
                        </p>
                    )
                }





                {
                    qrImage && (

                        <div className="qr-result">


                            <h3 className="qr-title">
                                Participant QR Code
                            </h3>



                            {/* ONLY QR IMAGE HERE */}
                            <QRCode
                                qrImage={qrImage}
                            />



                            <p className="qr-scan-text">
                                Scan this QR code for verification
                            </p>




                            <div className="qr-token">


                                <p className="qr-token-label">
                                    QR Token
                                </p>



                                <code>
                                    {token}
                                </code>


                            </div>


                        </div>

                    )
                }



            </section>


        </main>

    );

}


export default QRCodePage;