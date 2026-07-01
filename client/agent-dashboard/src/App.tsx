import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import DemoLandingPage from './pages/demo/DemoLandingPage';
import Login from './pages/agent/Login';
import Inbox from './pages/agent/Inbox';
import MessengerWidget from './components/customer/MessengerWidget';
import { useStore } from './store/useStore';

export const App: React.FC = () => {
  const token = useStore((state) => state.token);

  return (
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          {/* Mock SaaS Client homepage with integrated support widget */}
          <Route path="/" element={<DemoLandingPage />} />

          {/* Standalone Messenger Testing screen */}
          <Route 
            path="/messenger-standalone" 
            element={
              <div className="w-screen h-screen bg-slate-900 flex items-center justify-center relative">
                <div className="text-slate-400 text-sm max-w-sm text-center">
                  <h3 className="font-bold text-slate-100 text-lg mb-2">Simulated Customer Site</h3>
                  <p className="text-xs mb-4">Click the chat icon at the bottom right to start testing real-time tickets locally.</p>
                </div>
                <MessengerWidget />
              </div>
            } 
          />

          {/* Admin / Agent Dashboard Routing */}
          <Route path="/agent/login" element={!token ? <Login /> : <Navigate to="/agent/inbox" />} />
          <Route path="/agent/inbox" element={token ? <Inbox /> : <Navigate to="/agent/login" />} />
          
          {/* General Catch all redirects */}
          <Route path="/agent" element={<Navigate to={token ? '/agent/inbox' : '/agent/login'} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  );
};

export default App;
