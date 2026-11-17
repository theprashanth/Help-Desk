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

// Chart presentation constants (Intercom-style neutral chrome)
const CHART_GRID = '#e9e8e5';
const CHART_AXIS = '#9c9b97';
const CHART_TICK = { fill: CHART_AXIS, fontSize: 12 };
const CHART_TOOLTIP: React.CSSProperties = {
  fontSize: '13px',
  borderRadius: '8px',
  border: '1px solid rgb(var(--ic-line))',
  background: 'rgb(var(--ic-surface))',
  color: 'rgb(var(--ic-ink))',
  boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
};
const SERIES = { blue: '#2a5bd7', orange: '#e5622d', teal: '#14b8a6', violet: '#8b5cf6' };

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
      <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
        <div className="ic-panel-header">
          <h1 className="ic-title">Reports</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-faint" />
          <span className="text-[13px]">Calculating dashboard metrics...</span>
        </div>
      </div>
    );
  }

  const { summary, charts } = data;

  const cardItems = [
    { label: 'Open Tickets', value: summary.openTickets, icon: <ShieldAlert className="w-4 h-4" />, bg: '' },
    { label: 'Resolved Today', value: summary.resolvedToday, icon: <CheckCircle2 className="w-4 h-4" />, bg: '' },
    { label: 'Avg Response Time', value: summary.avgResponseTime, icon: <Clock className="w-4 h-4" />, bg: '' },
    { label: 'Avg Resolution Time', value: summary.avgResolutionTime, icon: <FolderClosed className="w-4 h-4" />, bg: '' },
    { label: 'Active Customers', value: summary.activeCustomers, icon: <Users className="w-4 h-4" />, bg: '' },
    { label: 'Online Agents', value: summary.onlineAgents, icon: <UserCheck className="w-4 h-4" />, bg: '' },
  ];

  return (
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
      {/* Header */}
      <div className="ic-panel-header justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <BarChart2 className="w-5 h-5 text-muted shrink-0" />
          <h1 className="ic-title">Reports</h1>
        </div>

        <Button
          variant="secondary"
          size="sm"
          loading={loading}
          onClick={fetchAnalytics}
          className="gap-2"
        >
          {!loading && <RefreshCw className="w-3.5 h-3.5" />}
          Refresh data
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8">
        <div>
          <h2 className="ic-section-title">Support analytics</h2>
          <p className="text-[14px] text-muted mt-1">Real-time resolution rates and team performance indexes.</p>
        </div>

        {/* Metrics Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {cardItems.map((item, idx) => (
            <div
              key={idx}
              className="ic-card p-5 flex flex-col gap-2 min-w-0"
            >
              <div className="flex justify-between items-center gap-2 text-muted">
                <span className="text-[13px] text-muted truncate">{item.label}</span>
                <span className={`shrink-0 text-faint ${item.bg}`}>{item.icon}</span>
              </div>
              <span className="text-[26px] leading-8 font-semibold text-ink tracking-tight tabular-nums truncate">
                {item.value}
              </span>
            </div>
          ))}
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Daily ticket volume (Area Chart) */}
          <div className="ic-card p-6 flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold text-ink">Daily new tickets</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts.dailyTickets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="day" stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <YAxis stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ stroke: CHART_GRID }} />
                  <Area type="monotone" dataKey="count" name="Tickets" stroke={SERIES.blue} strokeWidth={2} fill={SERIES.blue} fillOpacity={0.08} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Message volume (Line Chart) */}
          <div className="ic-card p-6 flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold text-ink">Message volume (outbound/inbound)</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.conversationVolume} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="day" stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <YAxis stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ stroke: CHART_GRID }} />
                  <Line type="monotone" dataKey="volume" name="Messages" stroke={SERIES.teal} strokeWidth={2} activeDot={{ r: 5 }} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Response time trends (Line Chart) */}
          <div className="ic-card p-6 flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold text-ink">Average response time trend (mins)</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.responseTimeTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="day" stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <YAxis stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ stroke: CHART_GRID }} />
                  <Line type="monotone" dataKey="minutes" name="Response Time" stroke={SERIES.orange} strokeWidth={2} activeDot={{ r: 5 }} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Agent Performance (Bar Chart) */}
          <div className="ic-card p-6 flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold text-ink">Agent performance (assigned vs resolved)</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.agentPerformance} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="name" stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <YAxis stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'rgba(156,155,151,0.12)' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px', color: CHART_AXIS }} />
                  <Bar dataKey="assigned" name="Assigned" fill={SERIES.blue} radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="resolved" name="Resolved" fill={SERIES.teal} radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
