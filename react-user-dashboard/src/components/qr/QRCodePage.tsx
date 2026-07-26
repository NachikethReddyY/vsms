import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "./QRCode";
import "./qrCodePage.css";
import apiClient, { getApiError } from "../../utils/apiClient";
import { PrinterIcon, ArrowDownTrayIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

function QRCodePage() {
    const { registrationId } = useParams<{ registrationId: string }>();
    const [qrImage, setQrImage] = useState<string>("");
    const [token, setToken] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>("");

    const fetchOrGenerateQR = useCallback(async () => {
        if (!registrationId) {
            setError("Registration ID is missing from route parameters.");
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError("");

            // Automatically call backend endpoint on load
            const response = await apiClient.post(`/qr/generate/${registrationId}`);
            const result = response.data;

            if (!result.success) {
                throw new Error(result.message || "Failed to generate pass.");
            }

            setQrImage(result.data.qrImage);
            setToken(result.data.token);
        } catch (err: unknown) {
            setError(getApiError(err, err instanceof Error ? err.message : "Unexpected error occurred"));
        } finally {
            setLoading(false);
        }
    }, [registrationId]);

    // Automatically trigger pass generation as soon as the component loads
    useEffect(() => {
        fetchOrGenerateQR();
    }, [fetchOrGenerateQR]);

    return (
        <main className="qr-page">
            <section className="qr-header">
                <p className="qr-overline">PARTICIPANT ACCESS</p>
                <h1>Participant event pass</h1>
                <p className="qr-description">
                    Secure QR pass for participant check-in. Clinical information is never stored inside the QR code.
                </p>
            </section>

            <section className="qr-workspace">
                <div className="qr-information">
                    <div>
                        <span className="qr-label">Registration ID</span>
                        <p className="qr-value font-mono text-xs">{registrationId || "N/A"}</p>
                    </div>
                    <div>
                        <span className="qr-label">Status</span>
                        <p className="qr-value qr-status">
                            {loading ? "● Loading..." : error ? "● Error" : "● Ready"}
                        </p>
                    </div>
                </div>

                {loading && (
                    <div className="flex items-center justify-center gap-2 py-6 text-gray-500">
                        <ArrowPathIcon className="w-5 h-5 animate-spin" />
                        <span>Generating secure pass...</span>
                    </div>
                )}

                {error && (
                    <div className="flex flex-col items-center gap-3">
                        <p className="qr-error" role="alert">
                            ⚠️ {error}
                        </p>
                        <button
                            className="generate-btn flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-xs"
                            onClick={fetchOrGenerateQR}
                        >
                            <ArrowPathIcon className="w-4 h-4" /> Try Again
                        </button>
                    </div>
                )}

                {qrImage && !loading && (
                    <div className="qr-result animate-fade-in">
                        <h3 className="qr-title">Participant QR Code</h3>

                        <QRCode qrImage={qrImage} />

                        <p className="qr-scan-text">Scan this QR code for verification</p>

                        <div className="qr-token">
                            <p className="qr-token-label">QR Token</p>
                            <code className="break-all">{token}</code>
                        </div>

                        <div className="flex gap-2 mt-4 w-full">
                            <button
                                onClick={() => window.print()}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-xs font-medium transition-colors"
                            >
                                <PrinterIcon className="w-4 h-4" /> Print
                            </button>
                            <a
                                href={qrImage}
                                download={`qr-pass-${registrationId}.png`}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-xs font-medium text-center transition-colors"
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" /> Download
                            </a>
                        </div>
                    </div>
                )}
            </section>
        </main>
    );
}

export default QRCodePage;
