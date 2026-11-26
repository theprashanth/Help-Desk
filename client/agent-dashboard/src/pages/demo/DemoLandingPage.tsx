import React, { useEffect } from 'react';
import MessengerWidget from '../../components/customer/MessengerWidget';
import { Globe, ArrowRight, ShieldCheck, Zap, Heart, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { API_URL } from '../../lib/config';

export const DemoLandingPage: React.FC = () => {
  // Browser tab shows the organisation's customer-facing name (Settings > General)
  useEffect(() => {
    fetch(`${API_URL}/api/workspace/public`)
      .then(r => (r.ok ? r.json() : null))
      .then(ws => { if (ws?.name) useStore.getState().setWorkspaceName(ws.name); })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between overflow-x-hidden relative text-slate-800 dark:text-slate-100 font-sans select-none">
      
      {/* Navbar */}
      <header className="px-6 py-4 border-b border-slate-200/50 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md sticky top-0 z-30 flex justify-between items-center max-w-7xl w-full mx-auto rounded-b-2xl shadow-sm">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-brand-500 rounded-lg text-white">
            <Globe className="w-5 h-5 animate-pulse" />
          </div>
          <span className="font-bold text-slate-900 dark:text-slate-50 tracking-wide text-sm">Chai Shots</span>
        </div>

        <nav className="hidden md:flex gap-6 text-xs font-bold text-slate-500 dark:text-slate-400">
          <a href="#features" className="hover:text-brand-500 transition-colors">Features</a>
          <a href="#pricing" className="hover:text-brand-500 transition-colors">Pricing</a>
          <a href="#about" className="hover:text-brand-500 transition-colors">About Us</a>
        </nav>

        <div className="flex gap-3">
          <Link
            to="/agent"
            className="px-4 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-250 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-all"
          >
            Agent Portal
          </Link>
          <a
            href="#pricing"
            className="px-4 py-2 text-xs font-bold bg-brand-500 hover:bg-brand-600 text-white rounded-xl shadow-md shadow-brand-500/10 transition-all"
          >
            Get Started
          </a>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-16 flex flex-col gap-16 justify-center">
        <section className="text-center flex flex-col items-center gap-6 max-w-3xl mx-auto py-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-50 dark:bg-brand-950/40 rounded-full border border-brand-100 dark:border-brand-900 text-[11px] font-bold text-brand-600 dark:text-brand-400">
            <Sparkles className="w-3.5 h-3.5" /> Unleash next-generation workflow speed
          </div>
          
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 leading-tight">
            Simplify Customer Inquiries With <span className="bg-gradient-to-r from-brand-600 to-indigo-500 bg-clip-text text-transparent">Chai Shots</span>
          </h1>

          <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed max-w-xl">
            Integrate customizable communication flows, coordinate ticket priority queues, and automate agent assignments using a localhost support playground.
          </p>

          <div className="flex flex-col sm:flex-row gap-3.5 mt-2">
            <button
              onClick={() => {
                // Focus simulated widget bubble
                const bubble = document.querySelector('button[className*="bg-brand-500"]') as HTMLButtonElement;
                bubble?.click();
              }}
              className="px-6 py-3 font-semibold text-sm bg-brand-500 hover:bg-brand-600 text-white rounded-xl shadow-xl shadow-brand-500/20 active:scale-95 transition-all flex items-center gap-2"
            >
              Simulate Customer Support Chat <ArrowRight className="w-4 h-4" />
            </button>
            
            <Link
              to="/agent"
              className="px-6 py-3 font-semibold text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-xl transition-all"
            >
              Open Agent Dashboard
            </Link>
          </div>
        </section>

        {/* Feature grid */}
        <section id="features" className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          <div className="bg-white dark:bg-slate-900 p-6 border border-slate-200/60 dark:border-slate-850 rounded-2xl shadow-sm flex flex-col gap-3">
            <div className="p-2.5 bg-brand-50 dark:bg-brand-950/40 rounded-xl text-brand-500 w-fit">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Vibrant Real-Time Speed</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Equipped with Socket.IO channels supporting instant status, live text syncing, typing states, and notifications.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 border border-slate-200/60 dark:border-slate-850 rounded-2xl shadow-sm flex flex-col gap-3">
            <div className="p-2.5 bg-brand-50 dark:bg-brand-950/40 rounded-xl text-brand-500 w-fit">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Dual Database Resiliency</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Switches seamlessly to low-dependency local JSON file stores if your host MongoDB engine fails to respond.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 border border-slate-200/60 dark:border-slate-850 rounded-2xl shadow-sm flex flex-col gap-3">
            <div className="p-2.5 bg-brand-50 dark:bg-brand-950/40 rounded-xl text-brand-500 w-fit">
              <Heart className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Premium Developer Shell</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Provides an interactive mock panel containing reset triggers, seeder scripts, and message loop simulators.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full bg-slate-900 border-t border-slate-800 text-slate-500 text-xs py-8 mt-16 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <span>&copy; 2026 Chai Shots. Running completely on localhost.</span>
          <div className="flex gap-4">
            <a href="#privacy" className="hover:text-slate-350">Privacy</a>
            <a href="#terms" className="hover:text-slate-350">Terms</a>
            <Link to="/agent" className="hover:text-slate-350 font-bold text-brand-400">Launch Agent Area</Link>
          </div>
        </div>
      </footer>

      {/* Floating Messenger Widget */}
      <MessengerWidget />
    </div>
  );
};

export default DemoLandingPage;
