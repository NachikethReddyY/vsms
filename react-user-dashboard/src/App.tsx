import { Routes, Route, Navigate } from "react-router-dom";

// Layout Wrapper
import { AppLayout } from "./components/layouts/AppLayout";

// Unauthenticated / Auth Pages
import LoginPage from "./components/LoginPage";
import SignUpPage from "./components/SignUpPage";
import ForgotPasswordPage from "./components/ForgotPasswordPage";

// Authenticated Application Modules
import DashboardPage from "./components/DashboardPage";
import RegisterParticipantPage from "./components/registration/RegisterParticipantPage";
import RegistrationSuccess from "./components/registration/RegistrationSuccess";
import QRCodePage from "./components/qr/QRCodePage";

function App() {
  return (
    <Routes>
      {/* 1. Default Route - Redirect to Login */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* 2. Authentication Routes (Standalone / No App Shell Sidebar) */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      {/* 3. Operational Application Shell (Includes Enterprise Top Bar + Sidebar) */}
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/live-queue" element={<DashboardPage />} />
        
        {/* Registration Workflow */}
        <Route path="/register-participant" element={<RegisterParticipantPage />} />
        <Route path="/registration-success" element={<RegistrationSuccess />} />

        {/* QR & System Tools */}
        <Route path="/qr-generator" element={<QRCodePage />} />
      </Route>

      {/* 4. Catch-all Fallback */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;