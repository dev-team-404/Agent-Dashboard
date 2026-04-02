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
import { statsApi, serviceApi } from '../../services/api';
import { useHolidayDates } from '../../hooks/useHolidayDates';
import { filterBusinessDays } from '../../utils/businessDayFilter';
import { useBusinessDayToggle } from '../../hooks/useBusinessDayToggle';

interface UserInfo {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
  totalTokens: number;
}

interface ModelInfo {
  id: string;
  name: string;
  displayName: string;
}

interface ChartDataItem {
  date: string;
  [userId: string]: string | number;
}

/**
 * URL 인코딩된 사용자 이름을 디코딩
 * DB에 한글이 URL 인코딩된 상태로 저장된 경우 처리
 */
function decodeUsername(name: string | undefined | null): string {
  if (!name) return '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name; // 디코딩 실패 시 원본 반환
  }
}

// Color palette for different users
const USER_COLORS = [
  '#0c8ce6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#a855f7', '#f43f5e', '#22c55e', '#3b82f6',
  '#eab308', '#d946ef', '#0ea5e9', '#65a30d', '#e11d48',
];

// DATE_RANGE_OPTIONS moved inside component for i18n

const TOP_N_OPTIONS = [10, 20, 30, 50, 100];

interface UsersByModelChartProps {
  serviceId?: string;
}

interface AliasGroup {
  aliasName: string;
  modelIds: string[];
}

export default function UsersByModelChart({ serviceId }: UsersByModelChartProps) {
  const { t } = useTranslation();
  const DATE_RANGE_OPTIONS = [
    { label: t('charts.usersByModel.week2'), value: 14 },
    { label: t('charts.usersByModel.month1'), value: 30 },
    { label: t('charts.usersByModel.month3'), value: 90 },
    { label: t('charts.usersByModel.month6'), value: 180 },
    { label: t('charts.usersByModel.year1'), value: 365 },
  ];
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [aliasGroups, setAliasGroups] = useState<AliasGroup[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedAliasName, setSelectedAliasName] = useState<string>('');
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [chartData, setChartData] = useState<ChartDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingChart, setLoadingChart] = useState(false);
  const [days, setDays] = useState(30);
  const [topN, setTopN] = useState(10);
  const holidayDates = useHolidayDates();
  const { exclude } = useBusinessDayToggle();

  // Load models on mount or when serviceId changes
  useEffect(() => {
    loadModels();
  }, [serviceId]);

  // Load chart data when model, days, topN, or serviceId changes
  useEffect(() => {
    if (serviceId ? selectedAliasName : selectedModelId) {
      loadChartData();
    }
  }, [selectedModelId, selectedAliasName, days, topN, serviceId]);

  const loadModels = async () => {
    try {
      if (serviceId) {
        // 서비스 상세 페이지: aliasName 그룹으로 표시
        const response = await serviceApi.listModels(serviceId);
        const serviceModels: Array<{ aliasName: string; model: ModelInfo }> = response.data.serviceModels || [];
        // aliasName별로 그룹핑
        const groupMap = new Map<string, string[]>();
        for (const sm of serviceModels) {
          if (!groupMap.has(sm.aliasName)) groupMap.set(sm.aliasName, []);
          groupMap.get(sm.aliasName)!.push(sm.model.id);
        }
        const groups = [...groupMap.entries()].map(([aliasName, modelIds]) => ({ aliasName, modelIds }));
        setAliasGroups(groups);
        if (groups.length > 0) {
          setSelectedAliasName(groups[0].aliasName);
        }
      } else {
        // 글로벌 대시보드: 전체 모델
        const response = await statsApi.byModel(30);
        const modelList = response.data.models || response.data;
        setModels(Array.isArray(modelList) ? modelList : []);
        if (modelList.length > 0) {
          setSelectedModelId(modelList[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadChartData = async () => {
    setLoadingChart(true);
    try {
      const response = serviceId && selectedAliasName
        ? await statsApi.modelUserTrend('', days, topN, serviceId, selectedAliasName)
        : await statsApi.modelUserTrend(selectedModelId, days, topN, serviceId);
      setUsers(response.data.users);
      setChartData(response.data.chartData);
    } catch (error) {
      console.error('Failed to load user trend data:', error);
    } finally {
      setLoadingChart(false);
    }
  };

  // 주말/휴일 제외 후 누적 데이터로 변환
  const cumulativeChartData = useMemo(() => {
    if (chartData.length === 0 || users.length === 0) return [];

    const filtered = exclude ? filterBusinessDays(chartData, (d) => d.date, holidayDates) : chartData;
    const cumulative: Record<string, number> = {};
    users.forEach((u) => (cumulative[u.id] = 0));

    return filtered.map((item) => {
      const newItem: ChartDataItem = { date: item.date };
      users.forEach((user) => {
        const dailyValue = (item[user.id] as number) || 0;
        cumulative[user.id] = (cumulative[user.id] || 0) + dailyValue;
        newItem[user.id] = cumulative[user.id];
      });
      return newItem;
    });
  }, [chartData, users, holidayDates, exclude]);

  const formatYAxis = (value: number): string => {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(0) + 'K';
    return value.toString();
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  const tickInterval = useMemo(() => {
    if (days <= 14) return 1;
    if (days <= 30) return 2;
    if (days <= 90) return 7;
    if (days <= 180) return 14;
    return 30;
  }, [days]);

  const selectedModel = serviceId
    ? (selectedAliasName ? { displayName: selectedAliasName } : null)
    : models.find((m) => m.id === selectedModelId);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-nexus-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('charts.usersByModel.title')}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {selectedModel ? t('charts.usersByModel.subtitle', { model: selectedModel.displayName, topN }) : t('charts.usersByModel.selectModel')}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Model selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">{t('charts.usersByModel.modelLabel')}</label>
            {serviceId && aliasGroups.length > 0 ? (
              <select
                value={selectedAliasName}
                onChange={(e) => setSelectedAliasName(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-nexus-500 focus:border-transparent"
              >
                {aliasGroups.map((g) => (
                  <option key={g.aliasName} value={g.aliasName}>
                    {g.aliasName}{g.modelIds.length > 1 ? ` (${t('charts.usersByModel.mergedCount', { count: g.modelIds.length })})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-nexus-500 focus:border-transparent"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Top N selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Top:</label>
            <select
              value={topN}
              onChange={(e) => setTopN(parseInt(e.target.value))}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-nexus-500 focus:border-transparent"
            >
              {TOP_N_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {t('charts.usersByModel.usersUnit', { count: n })}
                </option>
              ))}
            </select>
          </div>

          {/* Date range buttons */}
          <div className="flex items-center gap-2 ml-auto">
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
      </div>

      {loadingChart ? (
        <div className="h-96 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-nexus-600"></div>
        </div>
      ) : cumulativeChartData.length === 0 || users.length === 0 ? (
        <div className="h-96 flex items-center justify-center text-gray-400">
          {t('common.noData')}
        </div>
      ) : (
        <>
          <div className="h-96">
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
                    maxHeight: '300px',
                    overflow: 'auto',
                  }}
                  formatter={(value: number, name: string) => {
                    const user = users.find((u) => u.id === name);
                    return [formatYAxis(value), decodeUsername(user?.username) || user?.loginid || name];
                  }}
                  labelFormatter={(label) => t('charts.usersByModel.dateLabel', { date: label })}
                />
                <Legend
                  formatter={(value: string) => {
                    const user = users.find((u) => u.id === value);
                    return decodeUsername(user?.username) || user?.loginid || value;
                  }}
                  wrapperStyle={{ fontSize: '11px' }}
                />
                {users.map((user, index) => (
                  <Line
                    key={user.id}
                    type="monotone"
                    dataKey={user.id}
                    name={user.id}
                    stroke={USER_COLORS[index % USER_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* User ranking table */}
          <div className="mt-6 border-t pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">{t('charts.usersByModel.rankingTitle')}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {users.slice(0, 10).map((user, index) => (
                <div
                  key={user.id}
                  className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"
                >
                  <span
                    className="w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: USER_COLORS[index % USER_COLORS.length] }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-900 truncate">{decodeUsername(user.username)}</p>
                    <p className="text-xs text-gray-500">{formatYAxis(user.totalTokens)} tokens</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
