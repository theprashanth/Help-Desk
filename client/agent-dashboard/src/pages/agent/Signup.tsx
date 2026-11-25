import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Globe, Lock, Mail, User } from 'lucide-react';
import { useStore } from '../../store/useStore';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { API_URL } from '../../lib/config';

/**
 * Create a workspace: a new company gets its own empty inbox, settings and Messenger App ID, with the person
 * signing up as its first admin. Teammates are invited from Settings › Teammates afterwards.
 */
export const Signup: React.FC = () => {
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useStore(s => s.setAuth);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Couldn’t create the workspace'); return; }
      // Sign in the normal way (this also sets up the new admin's preferences)
      const login = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      const session = await login.json().catch(() => ({}));
      if (!login.ok) { navigate('/agent/login'); return; }
      setAuth(session.agent, session.token);
      navigate('/agent/settings/messenger');
    } catch {
      setError('Can’t reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px] bg-surface rounded-panel border border-line p-8">
        <div className="flex flex-col items-start">
          <div className="w-10 h-10 bg-ink text-on-ink rounded-xl flex items-center justify-center mb-6">
            <Globe className="w-5 h-5" />
          </div>
          <h2 className="text-[24px] leading-8 font-semibold tracking-tight text-ink">Create your workspace</h2>
          <p className="mt-1 text-[14px] text-muted">A new, empty inbox for your company, with its own Messenger. You’ll be its admin.</p>
        </div>
        <form className="mt-8 space-y-5" onSubmit={submit}>
          {error && (
            <div className="px-3 py-2.5 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/20 text-[13px] font-medium text-red-700 dark:text-red-300 rounded-lg">{error}</div>
          )}
          <Input label="Company name" value={companyName} onChange={e => setCompanyName(e.target.value)} required maxLength={80} icon={<Building2 className="w-4 h-4" />} />
          <Input label="Your name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} icon={<User className="w-4 h-4" />} />
          <Input label="Work email" type="email" value={email} onChange={e => setEmail(e.target.value)} required icon={<Mail className="w-4 h-4" />} />
          <Input label="Password (8+ characters)" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} icon={<Lock className="w-4 h-4" />} />
          <div className="pt-1">
            <Button type="submit" size="lg" loading={loading} className="w-full">Create workspace</Button>
          </div>
        </form>
        <p className="mt-6 border-t border-line pt-5 text-center text-[13px] text-muted">
          Already have an account? <Link to="/agent/login" className="font-medium text-ink hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
