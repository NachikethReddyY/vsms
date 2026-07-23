import React, { useState } from "react";
import "./DashboardPage.css";

interface QueueItem {
  id: string;
  queueNo: string;
  name: string;
  age: number;
  station: string;
  waitTime: string;
  status: "Waiting" | "Screening" | "Review" | "Referral" | "Urgent" | "Complete";
  flagReason?: string;
}

const mockQueue: QueueItem[] = [
  {
    id: "VSMS-240719-035",
    queueNo: "03",
    name: "Evelyn Ng",
    age: 68,
    station: "Clinical review",
    waitTime: "12m",
    status: "Review",
    flagReason:
      "Flagged for reviewer assessment. Distance acuity crossed the configured review threshold. Final decision made by reviewer.",
  },
  {
    id: "VSMS-240719-036",
    queueNo: "04",
    name: "Marcus Tan",
    age: 72,
    station: "Refraction",
    waitTime: "24m",
    status: "Waiting",
  },
  {
    id: "VSMS-240719-037",
    queueNo: "05",
    name: "Sarah Jenkins",
    age: 61,
    station: "Colour vision",
    waitTime: "4m",
    status: "Urgent",
    flagReason: "Flagged for reviewer assessment. Asymmetry detected between OD/OS colour perception.",
  },
  {
    id: "VSMS-240719-038",
    queueNo: "06",
    name: "David Chen",
    age: 65,
    station: "Eye health",
    waitTime: "18m",
    status: "Screening",
  },
];

const DashboardPage: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string>("VSMS-240719-035");
  const [filterStation, setFilterStation] = useState<string>("All");
  const [urgentFirst, setUrgentFirst] = useState<boolean>(false);

  const selectedParticipant = mockQueue.find((p) => p.id === selectedId) || mockQueue[0];

  const getStatusClass = (status: QueueItem["status"]) => {
    switch (status) {
      case "Waiting":
        return "vsms-status-waiting";
      case "Screening":
        return "vsms-status-screening";
      case "Review":
        return "vsms-status-review";
      case "Referral":
        return "vsms-status-referral";
      case "Urgent":
        return "vsms-status-urgent";
      case "Complete":
        return "vsms-status-complete";
      default:
        return "";
    }
  };

  return (
    <div className="vsms-workspace">
      {/* Central Queue Surface */}
      <section className="vsms-queue-surface">
        {/* Workspace Title Row */}
        <div className="vsms-title-row">
          <div className="vsms-title-group">
            <h1 className="vsms-workspace-title">Live Queue (18)</h1>
            <span className="vsms-inline-summary">
              146 registered · 18 waiting · 72 complete · 12 require review · 3 pending sync
            </span>
          </div>
        </div>

        {/* Operational Toolbar */}
        <div className="vsms-toolbar">
          <div className="vsms-toolbar-left">
            <input
              type="text"
              className="vsms-control-input"
              placeholder="Filter queue..."
            />
            <select
              className="vsms-control-select"
              value={filterStation}
              onChange={(e) => setFilterStation(e.target.value)}
            >
              <option value="All">All Stations</option>
              <option value="Acuity">Visual Acuity</option>
              <option value="Refraction">Refraction</option>
              <option value="Colour">Colour Vision</option>
              <option value="Health">Eye Health</option>
              <option value="Review">Clinical Review</option>
            </select>
          </div>

          <div className="vsms-toolbar-right">
            <button
              className={`vsms-toggle-btn ${urgentFirst ? "active" : ""}`}
              onClick={() => setUrgentFirst(!urgentFirst)}
            >
              <svg className="vsms-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              Urgent first
            </button>
          </div>
        </div>

        {/* Live Queue Table (Continuous Surface - No Cards) */}
        <div className="vsms-queue-list">
          <div className="vsms-queue-header">
            <span className="col-participant">Participant</span>
            <span className="col-station">Station</span>
            <span className="col-wait">Wait</span>
            <span className="col-status">Status</span>
            <span className="col-action">Action</span>
          </div>

          {mockQueue.map((item) => {
            const isSelected = item.id === selectedId;
            return (
              <div
                key={item.id}
                className={`vsms-queue-row ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="col-participant">
                  <div className="vsms-participant-name">{item.name}</div>
                  <div className="vsms-participant-meta">
                    {item.id} · Queue {item.queueNo}
                  </div>
                </div>

                <div className="col-station">{item.station}</div>

                <div className="col-wait vsms-num">{item.waitTime}</div>

                <div className="col-status">
                  <span className={`vsms-status-indicator ${getStatusClass(item.status)}`}>
                    <span className="status-dot" />
                    {item.status}
                  </span>
                </div>

                <div className="col-action">
                  <button className="vsms-row-action">
                    {item.status === "Review" || item.status === "Urgent" ? "Start review" : "Continue"}
                    <span className="chevron">›</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Participant Inspector Panel (§5.5 design.md) */}
      <aside className="vsms-inspector">
        <header className="vsms-inspector-header">
          <div className="vsms-inspector-title-group">
            <h2 className="vsms-inspector-name">{selectedParticipant.name}</h2>
            <div className="vsms-inspector-meta">
              {selectedParticipant.age} years · {selectedParticipant.id}
            </div>
            <div className="vsms-current-station">
              Current station: <strong>{selectedParticipant.station}</strong>
            </div>
          </div>
        </header>

        <div className="vsms-inspector-body">
          {/* Offline Reassurance Box */}
          <div className="vsms-reassurance-box">
            <div className="vsms-reassurance-status">Saved locally</div>
            <p className="vsms-reassurance-text">
              Saved safely on this device. Records will synchronise when the connection returns.
            </p>
          </div>

          {/* Screening Timeline (§4.2 / §5.5 design.md - Scoped Pastel Signature) */}
          <section className="vsms-inspector-section">
            <div className="vsms-section-label">SCREENING JOURNEY</div>
            <div className="vsms-timeline">
              <div className="vsms-timeline-step complete">
                <span className="vsms-tl-marker marker-registration" />
                <span className="vsms-tl-label">Registration</span>
              </div>
              <div className="vsms-timeline-step complete">
                <span className="vsms-tl-marker marker-acuity" />
                <span className="vsms-tl-label">Visual Acuity</span>
              </div>
              <div className="vsms-timeline-step active">
                <span className="vsms-tl-marker marker-review" />
                <span className="vsms-tl-label">Clinical Review</span>
              </div>
              <div className="vsms-timeline-step pending">
                <span className="vsms-tl-marker marker-health" />
                <span className="vsms-tl-label">Eye Health</span>
              </div>
            </div>
          </section>

          {/* Flag Explanation Box (Plain, Non-Diagnostic Wording) */}
          {selectedParticipant.flagReason && (
            <div className="vsms-flag-panel">
              <div className="vsms-flag-heading">Flagged for Reviewer Assessment</div>
              <p className="vsms-flag-body">{selectedParticipant.flagReason}</p>
            </div>
          )}

          {/* Primary Inspector Action */}
          <div className="vsms-inspector-actions">
            <button className="vsms-btn-pill-primary">Start Review</button>
          </div>

          {/* Collapsible Detail Rows */}
          <div className="vsms-inspector-accordion">
            <details className="vsms-accordion-item" open>
              <summary className="vsms-accordion-summary">Screening Summary</summary>
              <div className="vsms-accordion-content">
                <div className="vsms-data-row">
                  <span>Distance Acuity (OD):</span>
                  <strong className="vsms-num">6/12</strong>
                </div>
                <div className="vsms-data-row">
                  <span>Distance Acuity (OS):</span>
                  <strong className="vsms-num">6/6</strong>
                </div>
              </div>
            </details>

            <details className="vsms-accordion-item">
              <summary className="vsms-accordion-summary">Operational Notes</summary>
              <div className="vsms-accordion-content">
                <p className="vsms-note-text">Participant uses reading glasses for near work.</p>
              </div>
            </details>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default DashboardPage;