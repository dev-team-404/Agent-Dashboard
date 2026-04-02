import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, TrendingUp, Calendar, Plus, Loader2 } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import { gpuPowerApi } from '../services/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface GpuRecord {
  timestamp: string;
  power_avg_usage_ratio: number;
}

function formatTs(iso: string) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  return `${mm}-${dd} ${hh}h`;
}

function formatTsFull(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
}

export default function GpuPowerUsage() {
  const { t } = useTranslation();
  const [data, setData] = useState<GpuRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formDatetime, setFormDatetime] = useState(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM for datetime-local
  });
  const [formRatio, setFormRatio] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadData = async () => {
    try {
      const res = await gpuPowerApi.list();
      setData(res.data.data || []);
    } catch {
      console.error('Failed to load GPU power data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const stats = useMemo(() => {
    if (data.length === 0) return { avg: 0, latest: 0, latestTs: '-', max: 0, count: 0 };
    const avg = data.reduce((s, d) => s + d.power_avg_usage_ratio, 0) / data.length;
    const latest = data[data.length - 1];
    const max = Math.max(...data.map(d => d.power_avg_usage_ratio));
    return {
      avg: Math.round(avg * 100) / 100,
      latest: latest.power_avg_usage_ratio,
      latestTs: formatTsFull(latest.timestamp),
      max: Math.round(max * 100) / 100,
      count: data.length,
    };
  }, [data]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const ratio = parseFloat(formRatio);
    if (isNaN(ratio) || ratio < 0 || ratio > 100) {
      setError(t('gpuPowerUsage.validationError'));
      return;
    }

    setSaving(true);
    try {
      const ts = new Date(formDatetime).toISOString();
      await gpuPowerApi.save({ timestamp: ts, power_avg_usage_ratio: ratio });
      setSuccess(t('gpuPowerUsage.saveSuccess', { time: formatTsFull(ts) }));
      setFormRatio('');
      await loadData();
    } catch {
      setError(t('gpuPowerUsage.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const chartData = data.map(d => ({
    ...d,
    tsLabel: formatTs(d.timestamp),
  }));

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <Zap className="w-4 h-4" />
            <span>{t('gpuPowerUsage.latestUsage')}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.latest}%</p>
          <p className="text-xs text-gray-400 mt-1">{stats.latestTs}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <TrendingUp className="w-4 h-4" />
            <span>{t('gpuPowerUsage.avg7Day')}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.avg}%</p>
          <p className="text-xs text-gray-400 mt-1">{t('gpuPowerUsage.dataCount', { count: stats.count })}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <Zap className="w-4 h-4 text-red-500" />
            <span>{t('gpuPowerUsage.maxUsage')}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.max}%</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <Calendar className="w-4 h-4" />
            <span>{t('gpuPowerUsage.dataPeriod')}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900 mt-1">
            {data.length > 0 ? `${formatTsFull(data[0].timestamp)} ~ ${formatTsFull(data[data.length - 1].timestamp)}` : '-'}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('gpuPowerUsage.chartTitle')}</h3>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            {t('gpuPowerUsage.noDataMessage')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="gpuLineColor" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="tsLabel"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  fontSize: '12px',
                }}
                formatter={(value: number) => [`${value}%`, t('gpuPowerUsage.powerUsageLabel')]}
                labelFormatter={(label) => t('gpuPowerUsage.timeLabel', { label })}
              />
              <ReferenceLine y={stats.avg} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: t('gpuPowerUsage.avgLabel', { value: stats.avg }), position: 'right', fontSize: 11, fill: '#f59e0b' }} />
              <Line
                type="monotone"
                dataKey="power_avg_usage_ratio"
                stroke="url(#gpuLineColor)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Input Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4" />
          {t('gpuPowerUsage.dataInput')}
        </h3>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('gpuPowerUsage.timeInputLabel')}</label>
            <input
              type="datetime-local"
              value={formDatetime}
              onChange={e => setFormDatetime(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('gpuPowerUsage.avgPowerUsageLabel')}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={formRatio}
              onChange={e => setFormRatio(e.target.value)}
              placeholder={t('gpuPowerUsage.examplePlaceholder')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('gpuPowerUsage.save')}
          </button>
        </form>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        {success && <p className="text-green-600 text-xs mt-2">{success}</p>}
      </div>

      {/* Data Table */}
      {data.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">{t('gpuPowerUsage.detailData')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="text-left px-6 py-3 font-medium">{t('gpuPowerUsage.colTime')}</th>
                  <th className="text-right px-6 py-3 font-medium">{t('gpuPowerUsage.colAvgPowerUsage')}</th>
                  <th className="text-left px-6 py-3 font-medium w-1/2">{t('gpuPowerUsage.colVisualization')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((row) => (
                  <tr key={row.timestamp} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-3 text-gray-700 font-medium">{formatTsFull(row.timestamp)}</td>
                    <td className="px-6 py-3 text-right text-gray-900 font-semibold">{row.power_avg_usage_ratio}%</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${row.power_avg_usage_ratio}%`,
                              background: row.power_avg_usage_ratio >= 80 ? '#ef4444' :
                                         row.power_avg_usage_ratio >= 60 ? '#f59e0b' : '#6366f1',
                            }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
