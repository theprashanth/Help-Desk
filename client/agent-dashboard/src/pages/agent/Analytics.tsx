import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area, 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { 
  CheckCircle2, FolderClosed, Clock, ShieldAlert, Users, 
  UserCheck, RefreshCw, BarChart2, Smile
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

interface DayPoint { day: string; date: string }

interface AnalyticsData {
  range: { days: number; from: string; to: string };
  summary: {
    openTickets: number;
    resolvedToday: number;
    activeCustomers: number;
    onlineAgents: number;
    conversationsInRange: number;
    medianFirstResponseSec: number | null;
    avgFirstResponseSec: number | null;
    firstResponseCount: number;
    medianResolutionSec: number | null;
    avgResolutionSec: number | null;
    resolutionCount: number;
    csatScore: number | null;
    csatAverage: number | null;
    csatCount: number;
  };
  charts: {
    dailyTickets: Array<DayPoint & { count: number }>;
    conversationVolume: Array<DayPoint & { inbound: number; outbound: number }>;
    responseTimeTrends: Array<DayPoint & { minutes: number | null }>;
    agentPerformance: Array<{ agentId: string; name: string; assigned: number; replied: number; resolved: number }>;
  };
}

const RANGES = [7, 30, 90];

/** 42 -> "42s", 750 -> "12.5m", 9000 -> "2.5h", 200000 -> "2.3d"; null -> "—". */
function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const min = sec / 60;
  if (min < 60) return `${Math.round(min * 10) / 10}m`;
  const h = min / 60;
  if (h < 48) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}

const EmptyChart: React.FC<{ text?: string }> = ({ text = 'No data yet' }) => (
  <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-faint">
    <BarChart2 className="w-5 h-5" />
    <span className="text-[13px]">{text}</span>
  </div>
);

const ChartCard: React.FC<{ title: string; empty: boolean; emptyText?: string; children: React.ReactElement }> = ({ title, empty, emptyText, children }) => (
  <div className="ic-card p-6 flex flex-col gap-4">
    <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
    <div className="h-64 w-full">
      {empty ? <EmptyChart text={emptyText} /> : <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>}
    </div>
  </div>
);

export const Analytics: React.FC = () => {
  const token = useStore((state) => state.token);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchAnalytics = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/analytics?days=${days}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setData(await res.json());
        setError(null);
      } else {
        setError('Could not load reports.');
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
      setError('Could not load reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [token, days]);

  if (!data) {
    return (
      <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
        <div className="ic-panel-header">
          <h1 className="ic-title">Reports</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3">
          {error ? (
            <>
              <span className="text-[13px]">{error}</span>
              <Button variant="secondary" size="sm" onClick={fetchAnalytics}>Try again</Button>
            </>
          ) : (
            <>
              <RefreshCw className="w-6 h-6 animate-spin text-faint" />
              <span className="text-[13px]">Calculating dashboard metrics...</span>
            </>
          )}
        </div>
      </div>
    );
  }

  const { summary, charts } = data;
  const rangeLabel = `last ${data.range.days} days`;

  const cardItems = [
    { label: 'Open conversations', value: summary.openTickets, hint: 'Open or waiting', icon: <ShieldAlert className="w-4 h-4" /> },
    { label: 'Resolved today', value: summary.resolvedToday, hint: 'Resolved or closed since midnight', icon: <CheckCircle2 className="w-4 h-4" /> },
    {
      label: 'First response (median)',
      value: formatDuration(summary.medianFirstResponseSec),
      hint: summary.firstResponseCount
        ? `Avg ${formatDuration(summary.avgFirstResponseSec)} · ${summary.firstResponseCount} replied`
        : `No replies in the ${rangeLabel}`,
      icon: <Clock className="w-4 h-4" />,
    },
    {
      label: 'Resolution time (median)',
      value: formatDuration(summary.medianResolutionSec),
      hint: summary.resolutionCount
        ? `Avg ${formatDuration(summary.avgResolutionSec)} · ${summary.resolutionCount} resolved`
        : `None resolved in the ${rangeLabel}`,
      icon: <FolderClosed className="w-4 h-4" />,
    },
    { label: 'Customers', value: summary.activeCustomers, hint: 'All contacts', icon: <Users className="w-4 h-4" /> },
    { label: 'Online agents', value: summary.onlineAgents, hint: 'Connected and not away', icon: <UserCheck className="w-4 h-4" /> },
    {
      label: 'CSAT',
      value: summary.csatScore == null ? '—' : `${summary.csatScore}%`,
      hint: summary.csatCount ? `Avg ${summary.csatAverage}/5 · ${summary.csatCount} rating${summary.csatCount === 1 ? '' : 's'}` : 'No ratings yet',
      icon: <Smile className="w-4 h-4" />,
    },
  ];

  const noTickets = charts.dailyTickets.every(d => d.count === 0);
  const noVolume = charts.conversationVolume.every(d => d.inbound === 0 && d.outbound === 0);
  const noTrend = charts.responseTimeTrends.every(d => d.minutes == null);
  const dense = data.range.days > 7;
  const xAxisProps = {
    dataKey: 'day', stroke: CHART_AXIS, tick: CHART_TICK, axisLine: false, tickLine: false,
    interval: dense ? ('preserveStartEnd' as const) : 0, minTickGap: 16,
  };

  return (
    <div className="ic-panel flex-1 min-w-0 h-full flex flex-col">
      {/* Header */}
      <div className="ic-panel-header justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <BarChart2 className="w-5 h-5 text-muted shrink-0" />
          <h1 className="ic-title">Reports</h1>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="ic-select h-8 w-[140px]"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            aria-label="Date range"
          >
            {RANGES.map(r => <option key={r} value={r}>Last {r} days</option>)}
          </select>
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
      </div>

      <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8">
        <div>
          <h2 className="ic-section-title">Support analytics</h2>
          <p className="text-[14px] text-muted mt-1">
            Response and resolution times for the {rangeLabel}, from your conversation history.
          </p>
        </div>

        {/* Metrics Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {cardItems.map((item) => (
            <div key={item.label} className="ic-card p-5 flex flex-col gap-2 min-w-0">
              <div className="flex justify-between items-center gap-2 text-muted">
                <span className="text-[13px] text-muted truncate">{item.label}</span>
                <span className="shrink-0 text-faint">{item.icon}</span>
              </div>
              <span className="text-[26px] leading-8 font-semibold text-ink tracking-tight tabular-nums truncate">
                {item.value}
              </span>
              <span className="text-[12px] text-faint truncate" title={item.hint}>{item.hint}</span>
            </div>
          ))}
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <ChartCard title="New conversations per day" empty={noTickets}>
            <AreaChart data={charts.dailyTickets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
              <XAxis {...xAxisProps} />
              <YAxis stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ stroke: CHART_GRID }} />
              <Area type="monotone" dataKey="count" name="Conversations" stroke={SERIES.blue} strokeWidth={2} fill={SERIES.blue} fillOpacity={0.08} />
            </AreaChart>
          </ChartCard>

          <ChartCard title="Message volume (customer / agent)" empty={noVolume}>
            <LineChart data={charts.conversationVolume} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
              <XAxis {...xAxisProps} />
              <YAxis stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ stroke: CHART_GRID }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px', color: CHART_AXIS }} />
              <Line type="monotone" dataKey="inbound" name="From customers" stroke={SERIES.teal} strokeWidth={2} activeDot={{ r: 5 }} dot={dense ? false : { r: 3 }} />
              <Line type="monotone" dataKey="outbound" name="Agent replies" stroke={SERIES.violet} strokeWidth={2} activeDot={{ r: 5 }} dot={dense ? false : { r: 3 }} />
            </LineChart>
          </ChartCard>

          <ChartCard title="Median first response per day (mins)" empty={noTrend} emptyText="No agent replies yet">
            <LineChart data={charts.responseTimeTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
              <XAxis {...xAxisProps} />
              <YAxis stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ stroke: CHART_GRID }} />
              <Line type="linear" dataKey="minutes" name="Median first response (min)" stroke={SERIES.orange} strokeWidth={2} activeDot={{ r: 5 }} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ChartCard>

          <ChartCard title="Agent performance" empty={charts.agentPerformance.length === 0} emptyText="No agent activity yet">
            <BarChart data={charts.agentPerformance} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
              <XAxis dataKey="name" stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} />
              <YAxis stroke={CHART_AXIS} tick={CHART_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'rgba(156,155,151,0.12)' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px', color: CHART_AXIS }} />
              <Bar dataKey="assigned" name="Assigned" fill={SERIES.blue} radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="replied" name="Replied" fill={SERIES.violet} radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="resolved" name="Resolved" fill={SERIES.teal} radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ChartCard>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
