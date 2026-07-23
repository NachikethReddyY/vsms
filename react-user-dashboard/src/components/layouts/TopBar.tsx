import "./TopBar.css";

export function TopBar() {
  return (
    <header className="vsms-topbar">
      {/* Event Identity */}
      <div className="vsms-topbar-left">
        <div className="vsms-event-identity">
          <span className="vsms-event-title">Northside Community Screening</span>
          <span className="vsms-live-badge">
            <span className="vsms-live-dot" /> Live
          </span>
        </div>
      </div>

      {/* Global Command / Participant Search */}
      <div className="vsms-topbar-center">
        <div className="vsms-search-input-wrapper">
          <svg className="vsms-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            className="vsms-search-input"
            placeholder="Search participants, IDs, commands..."
          />
          <kbd className="vsms-search-shortcut">/</kbd>
        </div>
      </div>

      {/* Sync Status & Action Items */}
      <div className="vsms-topbar-right">
        <div className="vsms-sync-indicator" title="Local storage active">
          <svg className="vsms-icon vsms-icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span className="vsms-sync-text">Saved locally · 3 pending</span>
        </div>

        <button className="vsms-icon-btn" aria-label="Notifications">
          <svg className="vsms-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </button>

        <button className="vsms-icon-btn" aria-label="Settings">
          <svg className="vsms-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}