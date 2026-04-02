import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { statsApi } from '../../services/api';
import { useHolidayDates } from '../../hooks/useHolidayDates';
import { filterBusinessDays } from '../../utils/businessDayFilter';
import { useBusinessDayToggle } from '../../hooks/useBusinessDayToggle';

interface ModelInfo {
  id: string;
  name: string;
  displayName: string;
}

interface ChartDataItem {
  date: string;
  [modelId: string]: string | number;
}

// Color palette for different models
const MODEL_COLORS = [
  '#0c8ce6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
];

// DATE_RANGE_OPTIONS moved inside component for i18n

interface ModelUsageChartProps {
  serviceId?: string;
}

export default function ModelUsageChart({ serviceId }: ModelUsageChartProps) {
  const { t } = useTranslation();
  const DATE_RANGE_OPTIONS = [
    { label: t('charts.modelUsage.week2'), value: 14 },
    { label: t('charts.modelUsage.month1'), value: 30 },
    { label: t('charts.modelUsage.month3'), value: 90 },
    { label: t('charts.modelUsage.month6'), value: 180 },
    { label: t('charts.modelUsage.year1'), value: 365 },
  ];
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [chartData, setChartData] = useState<ChartDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const holidayDates = useHolidayDates();
  const { exclude } = useBusinessDayToggle();

  useEffect(() => {
    loadData();
  }, [days, serviceId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await statsApi.modelDailyTrend(days, serviceId);
      setModels(response.data.models);
      setChartData(response.data.chartData);
    } catch (error) {
      console.error('Failed to load model usage data:', error);
    } finally {
      setLoading(false);
    }
  };

  // 주말/휴일 제외 후 누적 데이터로 변환
  const cumulativeChartData = useMemo(() => {
    if (chartData.length === 0 || models.length === 0) return [];

    const filtered = exclude ? filterBusinessDays(chartData, (d) => d.date, holidayDates) : chartData;
    const cumulative: Record<string, number> = {};
    models.forEach((m) => (cumulative[m.id] = 0));

    return filtered.map((item) => {
      const newItem: ChartDataItem = { date: item.date };
      models.forEach((model) => {
        const dailyValue = (item[model.id] as number) || 0;
        cumulative[model.id] = (cumulative[model.id] || 0) + dailyValue;
        newItem[model.id] = cumulative[model.id];
      });
      return newItem;
    });
  }, [chartData, models, holidayDates, exclude]);

  const formatYAxis = (value: number): string => {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(0) + 'K';
    return value.toString();
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (days <= 30) {
      return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  // Calculate tick interval based on date range
  const tickInterval = useMemo(() => {
    if (days <= 14) return 1;
    if (days <= 30) return 2;
    if (days <= 90) return 7;
    if (days <= 180) return 14;
    return 30;
  }, [days]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-center justify-center h-80">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-nexus-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t('charts.modelUsage.title')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('charts.modelUsage.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {DATE_RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setDays(option.value)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                days === option.value
                  ? 'bg-samsung-blue text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {cumulativeChartData.length === 0 || models.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-gray-400">
          {t('common.noData')}
        </div>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                interval={tickInterval}
              />
              <YAxis
                tickFormatter={formatYAxis}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
                formatter={(value: number, name: string) => {
                  const model = models.find((m) => m.id === name);
                  return [formatYAxis(value), model?.displayName || name];
                }}
                labelFormatter={(label) => t('charts.modelUsage.dateLabel', { date: label })}
              />
              <Legend
                formatter={(value: string) => {
                  const model = models.find((m) => m.id === value);
                  return model?.displayName || value;
                }}
              />
              {models.map((model, index) => (
                <Line
                  key={model.id}
                  type="monotone"
                  dataKey={model.id}
                  name={model.id}
                  stroke={MODEL_COLORS[index % MODEL_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
