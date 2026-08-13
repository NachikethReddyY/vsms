import type { QueueEntry } from "../../features/queue/queueApi";

interface NowServingCardProps {
  nowServing: QueueEntry | null;
  actionLoading: string | null;
  onNoShow: (id: string) => void;
}

export function NowServingCard({ nowServing, actionLoading, onNoShow }: NowServingCardProps) {
  return (
    <section className="rounded-xl border border-blue-600/25 bg-blue-600/5 p-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-700">Now serving</p>
      {nowServing ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-xl font-semibold">Queue #{nowServing.queueNumber}</h2>
            <p className="font-semibold">{nowServing.participantDisplayName || "Unnamed participant"}</p>
            {nowServing.participantReference && (
              <span className="font-mono text-xs text-[#807D72]">{nowServing.participantReference}</span>
            )}
            {nowServing.stationName && (
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-[#6B6970]">
                {nowServing.stationName}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <span className="self-center text-xs text-[#6B6970]">Saving the station result advances the route.</span>
            <button
              type="button"
              disabled={actionLoading === nowServing.id}
              onClick={() => onNoShow(nowServing.id)}
              className="rounded-lg border border-amber-700/20 bg-amber-700/10 px-4 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
            >
              No show
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[#807D72]">No participant is currently being served.</p>
      )}
    </section>
  );
}
