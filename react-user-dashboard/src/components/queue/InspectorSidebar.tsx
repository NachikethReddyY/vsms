import { useState } from "react";
import { CheckCircleIcon, ClockIcon, ShieldCheckIcon, UserIcon, XMarkIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

interface InspectorSidebarProps {
  currentServing: {
    ticketNumber: string;
    participant: {
      fullName: string;
    };
  } | null;
  onSignOff: () => void;
}

export function InspectorSidebar({ currentServing, onSignOff }: InspectorSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const inspectorStations = [
    { name: "Visual Acuity", status: "completed" },
    { name: "Refraction", status: currentServing ? "in_progress" : "pending" },
    { name: "Colour Vision", status: "pending" },
    { name: "Eye Health", status: "pending" },
    { name: "Clinical Review", status: "pending" },
  ];

  return (
    <>
      {/* Trigger Button to Open Inspector Manual Sidebar */}
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-[#DCDAD2] bg-white px-4 py-2.5 text-xs font-semibold text-[#26251E] shadow-xs hover:bg-[#F9F9F8] transition-all cursor-pointer"
      >
        <ShieldCheckIcon className="w-4 h-4 text-[#3B82F6]" />
        <span>Inspector Manual</span>
        <ChevronRightIcon className="w-3.5 h-3.5 text-[#807D72]" />
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/30 backdrop-blur-xs z-40 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-over Drawer Sidebar */}
      <div className={`fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white border-l border-[#E2E1DC] shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}>
        
        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#EEEDEA]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <ShieldCheckIcon className="w-5 h-5 text-[#3B82F6]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#1A1916]">Inspector Manual</h2>
              <p className="text-[11px] text-[#7A7870]">Active station workflow & requirements</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-lg text-[#7A7870] hover:bg-[#F3F2EE] hover:text-[#1A1916] transition-colors cursor-pointer"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Sidebar Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {currentServing ? (
            <div className="space-y-5">
              <div className="bg-[#F9F9F8] p-4 rounded-xl border border-[#EEEDEA]">
                <div className="text-[11px] text-[#7A7870] uppercase tracking-wider font-semibold">Active Participant Details</div>
                <div className="text-base font-bold text-[#1A1916] mt-1">{currentServing.participant.fullName}</div>
                <div className="text-xs text-[#7A7870] font-mono mt-0.5">{currentServing.ticketNumber}</div>
              </div>

              <div className="space-y-2.5">
                <div className="text-xs font-semibold text-[#4A4843] uppercase tracking-wider px-1">Station Workflow Progress</div>
                
                {inspectorStations.map((st, idx) => {
                  const isComplete = st.status === "completed";
                  const isInProgress = st.status === "in_progress";
                  
                  return (
                    <div 
                      key={idx} 
                      className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
                        isInProgress 
                          ? "bg-blue-50/60 border-blue-200 text-blue-900" 
                          : isComplete 
                          ? "bg-emerald-50/40 border-emerald-100 text-emerald-900" 
                          : "bg-[#F9F9F8] border-[#EEEDEA] text-[#7A7870]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {isComplete ? (
                          <CheckCircleIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : isInProgress ? (
                          <ClockIcon className="w-4 h-4 text-blue-600 shrink-0 animate-pulse" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-dashed border-[#C2C0B6] shrink-0" />
                        )}
                        <span className="text-xs font-medium">{st.name}</span>
                      </div>

                      <span className="text-[10px] font-semibold uppercase tracking-wider">
                        {isComplete ? "Done" : isInProgress ? "Active" : "Pending"}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2">
                <button 
                  onClick={() => {
                    onSignOff();
                    setIsOpen(false);
                  }}
                  className="w-full rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] active:bg-[#1D4ED8] text-white py-3 text-xs font-semibold shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircleIcon className="w-4 h-4" />
                  <span>Sign off & Route to Next Station</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-16 px-4 text-[#7A7870]">
              <UserIcon className="w-10 h-10 mx-auto text-[#C2C0B6] mb-3" />
              <p className="text-xs font-medium">No participant currently in service.</p>
              <p className="text-[11px] text-[#9A9890] mt-1">Call a ticket from the queue to review their individual station logs here.</p>
            </div>
          )}

          <div className="bg-[#F9F9F8] border border-[#E2E1DC] rounded-2xl p-4 text-xs text-[#6B6961] space-y-2">
            <div className="font-semibold text-[#1A1916]">Inspector Guidelines & Manual</div>
            <p className="leading-relaxed">
              Verify that participants complete each required station in exact order. For any clinical discrepancies or missed checkpoints, log a flag immediately before completing the flow.
            </p>
          </div>
        </div>

      </div>
    </>
  );
}