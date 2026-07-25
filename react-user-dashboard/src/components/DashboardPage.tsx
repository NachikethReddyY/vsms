import React from 'react';

const DashboardPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-blue-500 text-white p-4">
        <h1 className="text-xl font-bold">Dashboard</h1>
      </header>
      <main className="p-4">
        <p>Welcome to your dashboard!</p>
        <p>Here you can manage your account and view your data.</p>
      </main>
    </div>
  );
};

export default DashboardPage;
