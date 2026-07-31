// react-user-dashboard/src/components/qr/QRCodePage.tsx
import { useCallback, useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { useParams } from "react-router-dom";
import QRCode from "./QRCode";
import "./qrCodePage.css";
import apiClient from "../../utils/apiClient";
import { PrinterIcon, ArrowDownTrayIcon, ArrowPathIcon, CheckCircleIcon } from "@heroicons/react/24/outline";

export default function QRCodePage() {
    const { registrationId } = useParams<{ registrationId: string }>();
    const [step, setStep] = useState<"welcome" | "pass">("welcome");
    const [qrImage, setQrImage] = useState<string>("");
    const [token, setToken] = useState<string>("");
    const [currentQueueNo] = useState<number>(3); // Live current serving queue
    const [myQueueNo] = useState<number>(12);    // Participant's queue number
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

            const response = await apiClient.post(`/qr/generate/${registrationId}`);
            const result = response.data;

            if (!result.success) {
                throw new Error(result.message || "Failed to generate pass.");
            }

            setQrImage(result.data.qrImage);
            setToken(result.data.token);
        } catch (err: unknown) {
            setError(
                (isAxiosError<{ message?: string }>(err) && err.response?.data?.message) ||
                (err instanceof Error ? err.message : "Unexpected error occurred")
            );
        } finally {
            setLoading(false);
        }
    }, [registrationId]);

    useEffect(() => {
        fetchOrGenerateQR();
    }, [fetchOrGenerateQR]);

    const handleStartEvent = () => {
        // Triggers the registration officer indicator and opens the mobile pass view
        setStep("pass");
    };

    const handleDownload = () => {
        if (!qrImage) return;
        const imageUrl = qrImage.startsWith("data:") ? qrImage : `data:image/png;base64,${qrImage}`;
        const link = document.createElement("a");
        link.href = imageUrl;
        link.download = `qr-pass-${registrationId}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Welcome Start Screen (Optimized for Mobile Viewports)
    if (step === "welcome") {
        return (
            <main className="qr-page flex flex-col items-center justify-center min-h-[80vh] text-center">
                <div className="w-full max-w-sm bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <CheckCircleIcon className="w-14 h-14 text-blue-600 mx-auto mb-3" />
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Welcome to the Event</h1>
                    <p className="text-gray-600 mb-6 text-xs leading-relaxed">
                        Tap below to check in with the registration officer, view your real-time queue position, and load your secure mobile pass.
                    </p>
                    <button
                        onClick={handleStartEvent}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm cursor-pointer"
                    >
                        Start Check-In
                    </button>
                </div>
            </main>
        );
    }

    // Mobile Pass View with Queue Numbers & Screener Action
    return (
        <main className="qr-page">
            <section className="qr-header">
                {/* Responsive Queue Indicator Box */}
                <div className="queue-indicator-box">
                    <div className="queue-metric">
                        <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Current Serving</span>
                        <p className="text-xl font-extrabold text-blue-600">#{currentQueueNo}</p>
                    </div>
                    <div className="queue-metric">
                        <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Your Number</span>
                        <p className="text-xl font-extrabold text-gray-900">#{myQueueNo}</p>
                    </div>
                </div>

                <p className="qr-overline">PARTICIPANT MOBILE PASS</p>
                <h1 className="text-lg font-bold">Your Event Access</h1>
                <p className="qr-description text-xs text-gray-500 mt-1">
                    Present this screen to station screeners to fetch your participant details.
                </p>
            </section>

            <section className="qr-workspace">
                <div className="qr-information">
                    <div>
                        <span className="qr-label">Registration ID</span>
                        <p className="qr-value font-mono text-[11px] truncate max-w-[200px]">{registrationId || "N/A"}</p>
                    </div>
                    <div>
                        <span className="qr-label">Status</span>
                        <p className="qr-value qr-status">
                            {loading ? "● Loading..." : error ? "● Error" : "● Checked In"}
                        </p>
                    </div>
                </div>

                {loading && (
                    <div className="flex items-center justify-center gap-2 py-6 text-gray-500 text-sm">
                        <ArrowPathIcon className="w-5 h-5 animate-spin" />
                        <span>Generating secure pass...</span>
                    </div>
                )}

                {error && (
                    <div className="flex flex-col items-center gap-3">
                        <p className="qr-error text-xs" role="alert">⚠️ {error}</p>
                        <button
                            className="generate-btn flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-xs cursor-pointer"
                            onClick={fetchOrGenerateQR}
                        >
                            <ArrowPathIcon className="w-4 h-4" /> Try Again
                        </button>
                    </div>
                )}

                {qrImage && !loading && (
                    <div className="qr-result animate-fade-in flex flex-col items-center">
                        <h3 className="qr-title text-sm font-semibold mb-2">Station Verification QR</h3>

                        <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                            <QRCode qrImage={qrImage} />
                        </div>

                        <p className="qr-scan-text text-xs text-gray-500 mt-3 text-center">
                            Show this code to station screeners to pull up your profile data.
                        </p>

                        <div className="qr-token w-full mt-3 p-2 bg-gray-50 rounded-lg text-left">
                            <p className="qr-token-label text-[10px] text-gray-400 font-semibold">QR TOKEN</p>
                            <code className="break-all text-[10px] text-gray-600">{token}</code>
                        </div>

                        {/* Action buttons styled for mobile touch targets */}
                        <div className="flex gap-2 mt-4 w-full">
                            <button
                                onClick={() => window.print()}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-xs font-medium transition-colors cursor-pointer"
                            >
                                <PrinterIcon className="w-4 h-4" /> Print
                            </button>
                            <button
                                onClick={handleDownload}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-xs font-medium text-center transition-colors cursor-pointer"
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" /> Save Pass
                            </button>
                        </div>
                    </div>
                )}
            </section>
        </main>
    );
}