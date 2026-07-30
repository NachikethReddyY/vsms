import { ArrowPathIcon } from "@heroicons/react/24/outline";

interface QueueItem {
  id: string;
  queueNo: number;
  participantName: string;
  status: "WAITING" | "SERVING" | "COMPLETED";
}

interface QueueTableProps {
  queueList: QueueItem[];
  loading: boolean;
}

export default function QueueTable({ queueList, loading }: QueueTableProps) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-bold text-gray-800 text-sm">Active Queue Roster</h3>
        {loading && <ArrowPathIcon className="w-4 h-4 animate-spin text-gray-400" />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-gray-600">
          <thead className="bg-gray-50 text-gray-400 uppercase font-bold text-[10px]">
            <tr>
              <th className="px-6 py-3">Queue No</th>
              <th className="px-6 py-3">Participant Name</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {queueList.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50/50">
                <td className="px-6 py-4 font-bold text-gray-900">#{item.queueNo}</td>
                <td className="px-6 py-4 font-medium text-gray-800">{item.participantName}</td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold ${
                      item.status === "SERVING"
                        ? "bg-blue-50 text-blue-600 border border-blue-100"
                        : item.status === "COMPLETED"
                        ? "bg-green-50 text-green-600 border border-green-100"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}