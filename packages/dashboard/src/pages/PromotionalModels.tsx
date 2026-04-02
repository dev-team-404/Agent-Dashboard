import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Megaphone, Search, Star, Loader2, MessageSquare, Image, Mic, Layers } from 'lucide-react';
import { api } from '../services/api';

interface ModelItem {
  id: string;
  displayName: string;
  name: string;
  type: string;
  promoted: boolean;
  sortOrder: number;
}

const TYPE_ICONS: Record<string, { icon: typeof MessageSquare; label: string; color: string }> = {
  CHAT: { icon: MessageSquare, label: 'Chat', color: 'text-blue-500' },
  IMAGE: { icon: Image, label: 'Image', color: 'text-pink-500' },
  EMBEDDING: { icon: Layers, label: 'Embedding', color: 'text-emerald-500' },
  RERANKING: { icon: Layers, label: 'Rerank', color: 'text-orange-500' },
  ASR: { icon: Mic, label: 'ASR', color: 'text-violet-500' },
};

export default function PromotionalModels() {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const loadModels = useCallback(async () => {
    try {
      const res = await api.get('/admin/promoted-models');
      setModels(res.data.models || []);
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const togglePromoted = async (model: ModelItem) => {
    setToggling(prev => new Set(prev).add(model.id));
    try {
      await api.put(`/admin/models/${model.id}/promoted`, { promoted: !model.promoted });
      setModels(prev => prev.map(m => m.id === model.id ? { ...m, promoted: !m.promoted } : m));
    } catch (err) {
      console.error('Failed to toggle:', err);
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(model.id); return s; });
    }
  };

  const promoted = models.filter(m => m.promoted);
  const filtered = models.filter(m =>
    m.displayName.toLowerCase().includes(search.toLowerCase()) ||
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-samsung-blue" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-lg">
          <Megaphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('promotionalModels.title')}</h1>
          <p className="text-sm text-gray-500">{t('promotionalModels.description')}</p>
        </div>
      </div>

      {/* Promoted summary */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
            <Star className="w-4 h-4" />
            {t('promotionalModels.currentPromoted', { count: promoted.length })}
          </h2>
        </div>
        {promoted.length === 0 ? (
          <p className="text-sm text-amber-600">{t('promotionalModels.noPromotedModels')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {promoted.map(m => {
              const typeInfo = TYPE_ICONS[m.type] || TYPE_ICONS.CHAT;
              const Icon = typeInfo.icon;
              return (
                <span key={m.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-200 rounded-lg text-sm font-medium text-gray-800 shadow-sm">
                  <Icon className={`w-3.5 h-3.5 ${typeInfo.color}`} />
                  {m.displayName}
                  <button
                    onClick={() => togglePromoted(m)}
                    className="ml-1 text-amber-400 hover:text-red-500 transition-colors"
                    title={t('promotionalModels.removePromotion')}
                  >
                    &times;
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('promotionalModels.searchPlaceholder')}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-samsung-blue focus:border-transparent"
        />
      </div>

      {/* Model list */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left py-3 px-4 font-medium text-gray-500 w-12">{t('promotionalModels.colPromoted')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('promotionalModels.colModelName')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('promotionalModels.colModelId')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500 w-24">{t('promotionalModels.colType')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500 w-20">{t('promotionalModels.colOrder')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, idx) => {
              const typeInfo = TYPE_ICONS[m.type] || TYPE_ICONS.CHAT;
              const Icon = typeInfo.icon;
              const isToggling = toggling.has(m.id);
              return (
                <tr key={m.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => togglePromoted(m)}
                      disabled={isToggling}
                      className={`w-9 h-5 rounded-full transition-colors relative ${
                        m.promoted ? 'bg-amber-500' : 'bg-gray-300'
                      } ${isToggling ? 'opacity-50' : ''}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                        m.promoted ? 'left-[18px]' : 'left-0.5'
                      }`} />
                    </button>
                  </td>
                  <td className="py-3 px-4 font-medium text-gray-900">
                    {m.displayName}
                    {m.promoted && <Star className="w-3.5 h-3.5 text-amber-500 inline ml-1.5" fill="currentColor" />}
                  </td>
                  <td className="py-3 px-4 text-gray-500 font-mono text-xs">{m.name}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 text-xs ${typeInfo.color}`}>
                      <Icon className="w-3.5 h-3.5" />
                      {typeInfo.label}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-xs">{m.sortOrder}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-gray-400">{t('promotionalModels.noSearchResults')}</div>
        )}
      </div>
    </div>
  );
}
