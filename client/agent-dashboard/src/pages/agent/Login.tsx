import React, { useState } from 'react';
import { useStore } from '../../store/useStore';
import { Link, useNavigate } from 'react-router-dom';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { Globe, Lock, Mail } from 'lucide-react';
import { API_URL } from '../../lib/config';

const BACKEND_URL = API_URL;

export const Login: React.FC = () => {
  // The local test account is filled in only while developing, never on a deployed site
  const isDev = !!(import.meta as any).env?.DEV;
  const [email, setEmail] = useState(isDev ? 'admin@localhost' : '');
  const [password, setPassword] = useState(isDev ? 'admin123' : '');
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
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] bg-surface rounded-panel border border-line p-8">
        <div className="flex flex-col items-start">
          <div className="w-10 h-10 bg-ink text-on-ink rounded-xl flex items-center justify-center mb-6">
            <Globe className="w-5 h-5" />
          </div>
          <h2 className="text-[24px] leading-8 font-semibold tracking-tight text-ink">
            Agent Dashboard
          </h2>
          <p className="mt-1 text-[14px] text-muted">
            Help Desk customer support platform
          </p>
        </div>

        <form className="mt-8 space-y-5" onSubmit={handleLogin}>
          {error && (
            <div className="px-3 py-2.5 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/20 text-[13px] font-medium text-red-700 dark:text-red-300 rounded-lg">
              {error}
            </div>
          )}

          <Input
            label="Email address"
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

          <div className="pt-1">
            <Button
              type="submit"
              size="lg"
              loading={loading}
              className="w-full"
            >
              Sign in to dashboard
            </Button>
          </div>
        </form>

        <div className="mt-6 border-t border-line pt-5 text-center text-[13px] text-muted flex flex-col gap-2">
          <span>New here? <Link to="/agent/signup" className="font-medium text-ink hover:underline">Create a workspace</Link></span>
          {isDev && <span><span className="font-medium text-ink">Testing preset:</span> admin@localhost / admin123</span>}
        </div>
      </div>
    </div>
  );
};

export default Login;
