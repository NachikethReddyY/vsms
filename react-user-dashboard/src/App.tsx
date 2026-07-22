import { Routes, Route, Navigate } from 'react-router-dom';

import LoginPage from './components/LoginPage';
import SignUpPage from './components/SignUpPage';
import ForgotPasswordPage from './components/ForgotPasswordPage';
import DashboardPage from './components/DashboardPage';
import QRCodePage from './components/qr/QRCodePage';

function App() {
  return (
    <Routes>

      {/* Default page */}
      <Route 
        path="/" 
        element={<Navigate to="/login" replace />} 
      />


      {/* Authentication */}
      <Route 
        path="/login" 
        element={<LoginPage />} 
      />

      <Route 
        path="/signup" 
        element={<SignUpPage />} 
      />

      <Route 
        path="/forgot-password" 
        element={<ForgotPasswordPage />} 
      />


      {/* Main pages */}
      <Route 
        path="/dashboard" 
        element={<DashboardPage />} 
      />


      {/* QR Generator Page */}
      <Route 
        path="/qr-generator" 
        element={<QRCodePage />} 
      />


      {/* Unknown routes redirect */}
      <Route 
        path="*" 
        element={<Navigate to="/login" replace />} 
      />

    </Routes>
  );
}

export default App;