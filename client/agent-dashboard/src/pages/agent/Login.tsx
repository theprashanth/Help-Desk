import React, { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { Globe, Lock, Mail } from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('admin@localhost');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const setAuth = useStore((state) => state.setAuth);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        const data = await res.json();
        setAuth(data.agent, data.token);
        navigate('/agent/inbox');
      } else {
        const errData = await res.json();
        setError(errData.error || 'Login failed. Check your credentials.');
      }
    } catch (err: any) {
      setError('Connection refused. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 select-none">
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
        <div className="p-3 bg-brand-500 rounded-2xl text-white shadow-lg shadow-brand-500/20 mb-4">
          <Globe className="w-8 h-8" />
        </div>
        <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Agent Dashboard
        </h2>
        <p className="mt-1.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Help Desk Customer Support Platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-slate-900 py-8 px-4 border border-slate-200/50 dark:border-slate-800 shadow-xl rounded-3xl sm:px-10 glass-panel">
          <form className="space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-xs font-medium text-red-650 dark:text-red-400 rounded-xl">
                {error}
              </div>
            )}

            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              icon={<Mail className="w-4 h-4" />}
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              icon={<Lock className="w-4 h-4" />}
            />

            <div>
              <Button
                type="submit"
                loading={loading}
                className="w-full py-2.5 font-semibold shadow-brand-500/20"
              >
                Sign In to Dashboard
              </Button>
            </div>
          </form>

          <div className="mt-6 border-t pt-6 text-center text-xs text-slate-400">
            <span className="font-bold">Testing Preset:</span> admin@localhost / admin123
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
