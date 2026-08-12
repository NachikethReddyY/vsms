import { CheckCircleIcon, ClockIcon, PlayIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";

interface QueueHeaderProps {
  eventId?: string;
  eventName?: string;
  totalCount: number;
  waitingCount: number;
  calledCount: number;
  completedCount: number;
  callNextDisabled: boolean;
  onCallNext: () => void;
}

export function QueueHeader({
  eventId,
  eventName,
  totalCount,
  waitingCount,
  calledCount,
  completedCount,
  callNextDisabled,
  onCallNext,
}: QueueHeaderProps) {
  const metrics = [
    ["In queue", totalCount, UserGroupIcon],
    ["Waiting", waitingCount, ClockIcon],
    ["Called", calledCount, PlayIcon],
    ["Completed", completedCount, CheckCircleIcon],
  ] as const;

  return (
    <section className="space-y-4 rounded-2xl border border-[#E2E1DC] bg-white p-5 shadow-sm">
      <header className="flex flex-col gap-4 border-b border-[#EEEDEA] pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xl font-bold">{eventName ? `${eventName} queue` : "Live queue"}</p>
          <p className="mt-1 text-sm text-[#7A7870]">Live station queue, priority handling, and transfer dispatch.</p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/events/${eventId}/registrations`}
            className="inline-flex items-center rounded-xl border border-[#DCDAD2] px-4 py-2 text-xs font-semibold"
          >
            Registrations
          </Link>
          <button
            type="button"
            disabled={callNextDisabled}
            onClick={onCallNext}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            <PlayIcon className="h-4 w-4" />
            Call next
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {metrics.map(([label, value, Icon]) => (
          <div key={label} className="rounded-xl border border-[#EFEEE9] bg-[#F9F9F8] p-3">
            <div className="flex items-center justify-between text-[#7A7870]">
              <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
              <Icon className="h-4 w-4" />
            </div>
            <strong className="mt-2 block text-lg">{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
