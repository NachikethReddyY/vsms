import { NavLink } from "react-router-dom";
import "./Sidebar.css";

export function Sidebar() {
  return (
    <aside className="vsms-sidebar">
      {/* Compact Event Switcher */}
      <div className="vsms-event-switcher">
        <div className="vsms-event-details">
          <span className="vsms-event-name">Northside Screening</span>
          <span className="vsms-event-meta">Jul 2026 · Event #2407</span>
        </div>
        <svg className="vsms-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      {/* Navigation Sections */}
      <nav className="vsms-sidebar-nav">
        <div className="vsms-nav-section-label">OVERVIEW</div>

        <NavLink to="/dashboard" className={({ isActive }) => `vsms-nav-item ${isActive ? "active" : ""}`}>
          <svg className="vsms-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect width="7" height="9" x="3" y="3" rx="1" />
            <rect width="7" height="5" x="14" y="3" rx="1" />
            <rect width="7" height="9" x="14" y="12" rx="1" />
            <rect width="7" height="5" x="3" y="16" rx="1" />
          </svg>
          <span>Dashboard</span>
        </NavLink>

        <div className="vsms-nav-section-label">OPERATIONS</div>

        <NavLink to="/register-participant" className={({ isActive }) => `vsms-nav-item ${isActive ? "active" : ""}`}>
          <svg className="vsms-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
          </svg>
          <span>Register Participant</span>
        </NavLink>

        <NavLink to="/live-queue" className={({ isActive }) => `vsms-nav-item ${isActive ? "active" : ""}`}>
          <svg className="vsms-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
          <span>Live Queue</span>
          <span className="vsms-nav-count">18</span>
        </NavLink>

        <NavLink to="/review-referrals" className={({ isActive }) => `vsms-nav-item ${isActive ? "active" : ""}`}>
          <svg className="vsms-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          <span>Review & Referrals</span>
          <span className="vsms-nav-count vsms-count-amber">12</span>
        </NavLink>

        <div className="vsms-nav-section-label">SYSTEM</div>

        <NavLink to="/qr-generator" className={({ isActive }) => `vsms-nav-item ${isActive ? "active" : ""}`}>
          <svg className="vsms-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect width="5" height="5" x="3" y="3" rx="1" />
            <rect width="5" height="5" x="16" y="3" rx="1" />
            <rect width="5" height="5" x="3" y="16" rx="1" />
            <path d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3M10 12h4M12 16v5" />
          </svg>
          <span>QR Event Passes</span>
        </NavLink>

        <NavLink to="/sync" className={({ isActive }) => `vsms-nav-item ${isActive ? "active" : ""}`}>
          <svg className="vsms-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M21.5 2v6h-6M2.5 22v-6h6" />
            <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8M22 12.5a10 10 0 0 1-18.8 4.2L2.5 16" />
          </svg>
          <span>Sync Centre</span>
          <span className="vsms-nav-count">3</span>
        </NavLink>
      </nav>

      {/* Connectivity & Profile Footer */}
      <div className="vsms-sidebar-footer">
        <div className="vsms-connection-status">
          <span className="vsms-status-dot vsms-dot-online" />
          <span className="vsms-status-text">Connected · Synced 2m ago</span>
        </div>
        <div className="vsms-user-profile">
          <div className="vsms-user-avatar">SN</div>
          <div className="vsms-user-meta">
            <span className="vsms-user-name">Sarah Ng</span>
            <span className="vsms-user-role">Station Lead</span>
          </div>
        </div>
      </div>
    </aside>
  );
}