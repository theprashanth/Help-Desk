import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area, 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { 
  CheckCircle2, FolderClosed, Clock, ShieldAlert, Users, 
  UserCheck, RefreshCw, BarChart2
} from 'lucide-react';
import Button from '../../components/ui/Button';

const BACKEND_URL = 'http://localhost:3000';

interface AnalyticsData {
  summary: {
    openTickets: number;
    resolvedToday: number;
    avgResponseTime: string;
    avgResolutionTime: string;
    activeCustomers: number;
    onlineAgents: number;
  };
  charts: {
    dailyTickets: Array<{ day: string; count: number }>;
    conversationVolume: Array<{ day: string; volume: number }>;
    responseTimeTrends: Array<{ day: string; minutes: number }>;
    agentPerformance: Array<{ name: string; assigned: number; resolved: number }>;
  };
}

export const Analytics: React.FC = () => {
  const token = useStore((state) => state.token);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAnalytics = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/analytics`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const payload = await res.json();
        setData(payload);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [token]);

  if (!data) {
    return (
      <div className="flex-1 h-full bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-brand-500" />
        <span className="text-xs">Calculating dashboard metrics...</span>
      </div>
    );
  }

  const { summary, charts } = data;

  const cardItems = [
    { label: 'Open Tickets', value: summary.openTickets, icon: <ShieldAlert className="w-5 h-5 text-amber-500" />, bg: 'bg-amber-500/10' },
    { label: 'Resolved Today', value: summary.resolvedToday, icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />, bg: 'bg-emerald-500/10' },
    { label: 'Avg Response Time', value: summary.avgResponseTime, icon: <Clock className="w-5 h-5 text-violet-500" />, bg: 'bg-violet-500/10' },
    { label: 'Avg Resolution Time', value: summary.avgResolutionTime, icon: <FolderClosed className="w-5 h-5 text-blue-500" />, bg: 'bg-blue-500/10' },
    { label: 'Active Customers', value: summary.activeCustomers, icon: <Users className="w-5 h-5 text-pink-500" />, bg: 'bg-pink-500/10' },
    { label: 'Online Agents', value: summary.onlineAgents, icon: <UserCheck className="w-5 h-5 text-indigo-500" />, bg: 'bg-indigo-500/10' },
  ];

  return (
    <div className="flex-1 h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto flex flex-col gap-6 select-none">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-brand-500" /> Support Analytics Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Real-time resolution rates and team performance indexes.</p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          loading={loading}
          onClick={fetchAnalytics}
          className="gap-2 border bg-white shadow-sm"
        >
          Refresh Data
        </Button>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cardItems.map((item, idx) => (
          <div 
            key={idx} 
            className="bg-white dark:bg-slate-900 p-5 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex flex-col gap-3"
          >
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{item.label}</span>
              <div className={`p-1.5 rounded-lg ${item.bg}`}>{item.icon}</div>
            </div>
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-50 font-mono tracking-tight">
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Daily ticket volume (Area Chart) */}
        <div className="bg-white dark:bg-slate-900 p-5 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Daily New Tickets</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.dailyTickets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTickets" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                <Area type="monotone" dataKey="count" name="Tickets" stroke="#8B5CF6" strokeWidth={2} fillOpacity={1} fill="url(#colorTickets)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Message volume (Line Chart) */}
        <div className="bg-white dark:bg-slate-900 p-5 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Message Volume (Outbound/Inbound)</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.conversationVolume} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                <Line type="monotone" dataKey="volume" name="Messages" stroke="#10B981" strokeWidth={2.5} activeDot={{ r: 6 }} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Response time trends (Line Chart) */}
        <div className="bg-white dark:bg-slate-900 p-5 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Average Response Time Trend (mins)</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.responseTimeTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                <Line type="monotone" dataKey="minutes" name="Response Time" stroke="#EC4899" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Agent Performance (Bar Chart) */}
        <div className="bg-white dark:bg-slate-900 p-5 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Agent Performance (Assigned vs Resolved)</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.agentPerformance} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="assigned" name="Assigned" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={24} />
                <Bar dataKey="resolved" name="Resolved" fill="#10B981" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
