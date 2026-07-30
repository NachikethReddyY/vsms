interface CurrentServingItem {
  id: string;
  ticketNumber: string;
  station: string;
  participant: {
    fullName: string;
    age: number;
    idNumber: string;
  };
}

interface NowServingCardProps {
  currentServing: CurrentServingItem | null;
  onComplete: (id: string) => void;
  onNoShow: (id: string) => void;
}

export function NowServingCard({ currentServing, onComplete, onNoShow }: NowServingCardProps) {
  return (
    <div className="rounded-xl border border-[#2563EB]/25 bg-[#2563EB]/4 p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#2563EB]">
          Now Serving (Active Station)
        </span>
        <span className="text-xs font-medium text-[#2563EB] bg-white px-2.5 py-0.5 rounded-md border border-[#2563EB]/20 tabular-nums">
          {currentServing?.station || "General Screening"}
        </span>
      </div>

      {currentServing ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[#26251E] font-mono tabular-nums">
              {currentServing.ticketNumber}
            </h2>
            <p className="text-sm font-semibold text-[#26251E] mt-0.5">
              {currentServing.participant.fullName}{" "}
              <span className="text-xs font-normal text-[#807D72]">
                ({currentServing.participant.age} yrs · {currentServing.participant.idNumber})
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onComplete(currentServing.id)}
              className="rounded-lg bg-[#1F8A65]/10 text-[#1F8A65] border border-[#1F8A65]/20 px-4 py-1.5 text-xs font-semibold hover:bg-[#1F8A65]/20 cursor-pointer transition-colors"
            >
              Complete Station
            </button>
            <button
              onClick={() => onNoShow(currentServing.id)}
              className="rounded-lg bg-[#B45309]/10 text-[#B45309] border border-[#B45309]/20 px-4 py-1.5 text-xs font-semibold hover:bg-[#B45309]/20 cursor-pointer transition-colors"
            >
              No Show
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[#807D72]">No participant currently active. Click "Call Next Participant" above.</p>
      )}
    </div>
  );
}
