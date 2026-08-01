import type { QueueItem } from "./QueueTable";

interface NowServingCardProps {
  currentServing: QueueItem | null;
  actionLoading: string | null;
  onComplete: (id: string) => void;
  onNoShow: (id: string) => void;
}

export function NowServingCard({ currentServing, actionLoading, onComplete, onNoShow }: NowServingCardProps) {
  return (
    <section className="rounded-xl border border-blue-600/25 bg-blue-600/5 p-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-700">Now serving</p>
      {currentServing ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-mono text-xl font-semibold">Queue #{currentServing.queueNumber ?? "—"}</h2>
            <p className="mt-1 font-semibold">{currentServing.participant.fullName}</p>
            <p className="text-xs text-[#807D72]">{currentServing.participant.reference}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={actionLoading === currentServing.id}
              onClick={() => onComplete(currentServing.id)}
              className="rounded-lg border border-emerald-700/20 bg-emerald-700/10 px-4 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-50"
            >
              Complete
            </button>
            <button
              type="button"
              disabled={actionLoading === currentServing.id}
              onClick={() => onNoShow(currentServing.id)}
              className="rounded-lg border border-amber-700/20 bg-amber-700/10 px-4 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
            >
              No show
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[#807D72]">No participant is currently checked in.</p>
      )}
    </section>
  );
}
