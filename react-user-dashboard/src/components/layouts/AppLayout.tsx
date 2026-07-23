import { Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import "./AppLayout.css";

export function AppLayout() {
  return (
    <div className="vsms-app-shell">
      <TopBar />
      <div className="vsms-app-body">
        <Sidebar />
        <main className="vsms-main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}