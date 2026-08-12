import type { QueueStationWorkload } from "../../features/queue/queueApi";

interface StationWorkloadProps {
  stations: QueueStationWorkload[];
}

const workloadLine = (workload: QueueStationWorkload["workload"]) =>
  `${workload.WAITING} waiting · ${workload.CALLED} called · ${workload.IN_PROGRESS} in progress`;

export function StationWorkload({ stations }: StationWorkloadProps) {
  if (stations.length === 0) {
    return (
      <section className="rounded-2xl border border-[#E2E1DC] bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-bold">Station workload</h2>
        <p className="text-sm text-[#7A7870]">No stations are configured for this event yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#E2E1DC] bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-bold">Station workload</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stations.map((station) => {
          const next = station.nextUp;
          const waiting = station.workload.WAITING;
          return (
            <div key={station.stationId} className="rounded-xl border border-[#EFEEE9] bg-[#F9F9F8] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold">{station.stationName}</p>
                <span className="rounded-full bg-[#E9E7E0] px-2.5 py-0.5 text-xs font-semibold text-[#6B6970]">
                  {station.stationType.replace(/_/g, " ").toLowerCase()}
                </span>
              </div>
              <p className="mt-2 text-xs text-[#7A7870]">{workloadLine(station.workload)}</p>
              {next ? (
                <p className="mt-2 text-xs">
                  <span className="font-semibold">Next up</span>{" "}
                  <span className="font-mono font-semibold">#{next.queueNumber}</span>
                  {next.isPriority && (
                    <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                      priority
                    </span>
                  )}
                  {next.participantDisplayName ? (
                    <span className="ml-1.5 text-[#7A7870]">· {next.participantDisplayName}</span>
                  ) : null}
                </p>
              ) : waiting > 0 ? (
                <p className="mt-2 text-xs text-[#7A7870]">Computing next up…</p>
              ) : (
                <p className="mt-2 text-xs text-[#7A7870]">No one waiting</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
