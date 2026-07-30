interface QueueStatsProps {
  currentServing: number;
  totalWaiting: number;
  completedToday: number;
}

export default function QueueStatsCards({ currentServing, totalWaiting, completedToday }: QueueStatsProps) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Current Serving</span>
        <p className="text-3xl font-extrabold text-blue-600 mt-1">#{currentServing}</p>
      </div>
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total Waiting</span>
        <p className="text-3xl font-extrabold text-gray-900 mt-1">{totalWaiting}</p>
      </div>
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Completed Today</span>
        <p className="text-3xl font-extrabold text-green-600 mt-1">{completedToday}</p>
      </div>
    </section>
  );
}