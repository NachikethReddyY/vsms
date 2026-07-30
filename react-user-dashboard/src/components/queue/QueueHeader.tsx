import { ArrowPathIcon, CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, PlayIcon, UsersIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";

interface QueueHeaderProps {
  eventId?: string;
  eventName?: string;
  totalCount: number;
  waitingCount: number;
  checkedInCount: number;
  completedCount: number;
  callNextDisabled: boolean;
  onCallNext: () => void;
}

export function QueueHeader({
  eventId,
  totalCount,
  waitingCount,
  completedCount,
  onCallNext,
}: QueueHeaderProps) {
  return (
    <div className="bg-white border border-[#E2E1DC] rounded-2xl p-5 shadow-xs space-y-4">
      
      {/* Top Bar: Title & Primary Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-[#EEEDEA]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-[#1A1916]">
              Live queue
            </h1>
            <span className="inline-flex items-center rounded-full bg-[#F3F2EE] px-2.5 py-0.5 text-xs font-semibold text-[#5A5852] tabular-nums">
              {totalCount} total entries
            </span>
          </div>
          <p className="text-xs text-[#7A7870] mt-0.5">
            Real-time tracking and queue dispatch management for active clinical operations.
          </p>
        </div>

{/* Action Buttons Toolbar - Unified sizing */}
        <div className="flex items-center gap-2.5">
          <Link
            to={`/events/${eventId}/registrations`}
            className="inline-flex items-center justify-center h-10 rounded-xl border border-[#DCDAD2] bg-white px-4 text-xs font-semibold text-[#4A4843] shadow-xs hover:bg-[#F9F9F8] hover:text-[#1A1916] transition-all"
          >
            ← Registrations
          </Link>

          <button
            onClick={onCallNext}
            className="inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] active:bg-[#1D4ED8] px-4 text-xs font-semibold text-white shadow-xs cursor-pointer transition-all active:scale-[0.98]"
          >
            <PlayIcon className="w-3.5 h-3.5 fill-current text-white" />
            <span>Call Next Participant</span>
          </button>
        </div>
      </div>

      {/* Compact Bento Grid Metrics Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        
        <div className="bg-[#F9F9F8] border border-[#EFEEE9] rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#7A7870] mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Registered</span>
            <UsersIcon className="w-3.5 h-3.5 text-[#8C8A81]" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-[#1A1916] tabular-nums">{totalCount}</span>
            <span className="text-[10px] text-[#7A7870]">total</span>
          </div>
        </div>

        <div className="bg-[#F9F9F8] border border-[#EFEEE9] rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#7A7870] mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Waiting</span>
            <ClockIcon className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-blue-600 tabular-nums">{waitingCount}</span>
            <span className="text-[10px] text-[#7A7870]">in line</span>
          </div>
        </div>

        <div className="bg-[#F9F9F8] border border-[#EFEEE9] rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#7A7870] mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Complete</span>
            <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-emerald-600 tabular-nums">{completedCount}</span>
            <span className="text-[10px] text-[#7A7870]">processed</span>
          </div>
        </div>

        <div className="bg-[#F9F9F8] border border-[#EFEEE9] rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#7A7870] mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Review</span>
            <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-amber-600 tabular-nums">12</span>
            <span className="text-[10px] text-[#7A7870]">flagged</span>
          </div>
        </div>

        <div className="bg-[#F9F9F8] border border-[#EFEEE9] rounded-xl p-3 flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-[#7A7870] mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Sync Status</span>
            <ArrowPathIcon className="w-3.5 h-3.5 text-slate-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-slate-700 tabular-nums">3</span>
            <span className="text-[10px] text-[#7A7870]">pending sync</span>
          </div>
        </div>

      </div>

    </div>
  );
}
