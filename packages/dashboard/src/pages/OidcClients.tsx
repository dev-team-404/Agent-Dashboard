import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyRound, Plus, Trash2, RefreshCw, Copy, Check, AlertCircle,
  Loader2, X, Eye, EyeOff, Pencil, Shield,
} from 'lucide-react';
import { oidcClientApi } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';

interface OidcClientRow {
  clientId: string;
  redirectUris: string[];
  createdAt: string | null;
  createdBy: string | null;
  isDefault: boolean;
}

type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | null;

export default function OidcClients({ adminRole }: { adminRole: AdminRole }) {
  const { t } = useTranslation();
  const [clients, setClients] = useState<OidcClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createId, setCreateId] = useState('');
  const [createUris, setCreateUris] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);

  // Edit modal
  const [editClient, setEditClient] = useState<OidcClientRow | null>(null);
  const [editUris, setEditUris] = useState('');
  const [editing, setEditing] = useState(false);
  const [regeneratedSecret, setRegeneratedSecret] = useState<string | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Copy feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await oidcClientApi.list();
      setClients(res.data || []);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || t('oidcClients.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Create
  const handleCreate = async () => {
    if (!createId.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const uris = createUris.trim()
        ? createUris.split('\n').map(u => u.trim()).filter(Boolean)
        : undefined;
      const res = await oidcClientApi.create({ clientId: createId.trim(), redirectUris: uris });
      setCreatedSecret(res.data.secret);
      setCreatedClientId(res.data.clientId);
      setCreateId('');
      setCreateUris('');
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || t('oidcClients.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const closeCreateModal = () => {
    setShowCreate(false);
    setCreateId('');
    setCreateUris('');
    setCreatedSecret(null);
    setCreatedClientId(null);
  };

  // Edit
  const openEdit = (client: OidcClientRow) => {
    setEditClient(client);
    setEditUris(client.redirectUris.join('\n'));
    setRegeneratedSecret(null);
  };

  const handleEdit = async (regenerate = false) => {
    if (!editClient) return;
    setEditing(true);
    setError(null);
    try {
      const uris = editUris.trim()
        ? editUris.split('\n').map(u => u.trim()).filter(Boolean)
        : undefined;
      const res = await oidcClientApi.update(editClient.clientId, {
        redirectUris: uris,
        regenerateSecret: regenerate,
      });
      if (res.data.secret) {
        setRegeneratedSecret(res.data.secret);
      }
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || t('oidcClients.editFailed'));
    } finally {
      setEditing(false);
    }
  };

  const closeEditModal = () => {
    setEditClient(null);
    setEditUris('');
    setRegeneratedSecret(null);
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await oidcClientApi.delete(deleteTarget);
      setDeleteTarget(null);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || t('oidcClients.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  if (adminRole !== 'SUPER_ADMIN') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Shield className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{t('oidcClients.superAdminOnly')}</p>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-indigo-50">
            <KeyRound className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-800 tracking-tight">{t('oidcClients.title')}</h1>
            <p className="text-sm text-pastel-500 mt-0.5">
              {t('oidcClients.description')}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          {t('oidcClients.addClient')}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3 bg-red-50 rounded-lg border border-red-100 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto p-0.5 hover:bg-red-100 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Client table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-medium text-pastel-600">Client ID</th>
                <th className="text-left px-5 py-3 font-medium text-pastel-600">Redirect URIs</th>
                <th className="text-left px-5 py-3 font-medium text-pastel-600">{t('oidcClients.colCreatedAt')}</th>
                <th className="text-left px-5 py-3 font-medium text-pastel-600">{t('oidcClients.colCreatedBy')}</th>
                <th className="text-right px-5 py-3 font-medium text-pastel-600">{t('oidcClients.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-pastel-400">
                    {t('oidcClients.noClients')}
                  </td>
                </tr>
              ) : (
                clients.map(client => (
                  <ClientRow
                    key={client.clientId}
                    client={client}
                    copiedField={copiedField}
                    onCopy={handleCopy}
                    onEdit={() => openEdit(client)}
                    onDelete={() => setDeleteTarget(client.clientId)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100/80 p-6">
        <h2 className="text-sm font-semibold text-pastel-700 mb-3">{t('oidcClients.infoTitle')}</h2>
        <div className="space-y-2 text-sm text-pastel-600">
          <p>
            {t('oidcClients.infoDesc1')}
          </p>
          <p>
            {t('oidcClients.infoDesc2Prefix')}<code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">client_id</code>{t('oidcClients.infoDesc2Mid')}
            <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">client_secret</code>{t('oidcClients.infoDesc2Suffix')}
            <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono">redirect_uri</code>{t('oidcClients.infoDesc2End')}
          </p>
          <p className="text-xs text-pastel-400 mt-1">
            {t('oidcClients.infoDefaultNote')}
          </p>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal onClose={closeCreateModal} title={t('oidcClients.createTitle')}>
          {createdSecret ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                <p className="text-sm font-medium text-green-800 mb-2">
                  {t('oidcClients.createSuccess')}
                </p>
                <p className="text-xs text-green-600 mb-3">
                  {t('oidcClients.createSecretNote')}
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs font-medium text-green-700">Client ID</label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="flex-1 px-3 py-2 bg-white rounded border border-green-200 text-sm font-mono text-green-900 select-all">
                        {createdClientId}
                      </code>
                      <CopyButton
                        text={createdClientId || ''}
                        field="created-id"
                        copiedField={copiedField}
                        onCopy={handleCopy}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-green-700">Client Secret</label>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="flex-1 px-3 py-2 bg-white rounded border border-green-200 text-sm font-mono text-green-900 select-all break-all">
                        {createdSecret}
                      </code>
                      <CopyButton
                        text={createdSecret}
                        field="created-secret"
                        copiedField={copiedField}
                        onCopy={handleCopy}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={closeCreateModal}
                className="w-full py-2.5 text-sm font-medium rounded-lg bg-gray-100 text-pastel-700 hover:bg-gray-200 transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">
                  Client ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={createId}
                  onChange={e => setCreateId(e.target.value.toLowerCase().replace(/[^a-z0-9\-_]/g, ''))}
                  placeholder={t('oidcClients.createIdPlaceholder')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-pastel-700 mb-1.5">
                  {t('oidcClients.redirectUrisLabel')}
                  <span className="text-xs font-normal text-pastel-400 ml-1.5">
                    {t('oidcClients.redirectUrisHint')}
                  </span>
                </label>
                <textarea
                  value={createUris}
                  onChange={e => setCreateUris(e.target.value)}
                  placeholder={'http://localhost:3000/callback\nhttps://my-app.example.com/callback'}
                  rows={3}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none font-mono resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={closeCreateModal}
                  className="flex-1 py-2.5 text-sm font-medium rounded-lg bg-gray-100 text-pastel-700 hover:bg-gray-200 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || createId.trim().length < 2}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {t('common.create')}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Edit Modal */}
      {editClient && (
        <Modal onClose={closeEditModal} title={t('oidcClients.editTitle', { clientId: editClient.clientId })}>
          <div className="space-y-4">
            {regeneratedSecret && (
              <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-sm font-medium text-amber-800 mb-1">{t('oidcClients.regeneratedSecretNote')}</p>
                <p className="text-xs text-amber-600 mb-2">{t('oidcClients.regeneratedSecretViewNote')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-white rounded border border-amber-200 text-sm font-mono text-amber-900 select-all break-all">
                    {regeneratedSecret}
                  </code>
                  <CopyButton
                    text={regeneratedSecret}
                    field="regen-secret"
                    copiedField={copiedField}
                    onCopy={handleCopy}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-pastel-700 mb-1.5">{t('oidcClients.redirectUrisLabel')}</label>
              <textarea
                value={editUris}
                onChange={e => setEditUris(e.target.value)}
                rows={4}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none font-mono resize-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleEdit(false)}
                disabled={editing}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
              >
                {editing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                {t('oidcClients.saveUri')}
              </button>
              <button
                onClick={() => {
                  if (window.confirm(t('oidcClients.regenerateConfirm'))) {
                    handleEdit(true);
                  }
                }}
                disabled={editing}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t('oidcClients.regenerateSecret')}
              </button>
            </div>

            <button
              onClick={closeEditModal}
              className="w-full py-2.5 text-sm font-medium rounded-lg bg-gray-100 text-pastel-700 hover:bg-gray-200 transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)} title={t('oidcClients.deleteTitle')}>
          <div className="space-y-4">
            <p className="text-sm text-pastel-600">
              <code className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-mono text-xs">{deleteTarget}</code>{t('oidcClients.deleteConfirm')}
            </p>
            <p className="text-xs text-pastel-400">
              {t('oidcClients.deleteWarning')}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 text-sm font-medium rounded-lg bg-gray-100 text-pastel-700 hover:bg-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {t('common.delete')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-pastel-800">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md transition-colors">
            <X className="w-5 h-5 text-pastel-400" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CopyButton({
  text,
  field,
  copiedField,
  onCopy,
}: {
  text: string;
  field: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}) {
  const { t } = useTranslation();
  const isCopied = copiedField === field;
  return (
    <button
      onClick={() => onCopy(text, field)}
      className="flex-shrink-0 flex items-center gap-1 px-2.5 py-2 text-xs rounded-md bg-white border border-gray-200 text-pastel-600 hover:bg-gray-50 transition-colors"
    >
      {isCopied ? <><Check className="w-3.5 h-3.5 text-green-500" /> {t('common.copied')}</> : <><Copy className="w-3.5 h-3.5" /> {t('common.copy')}</>}
    </button>
  );
}

function ClientRow({
  client,
  copiedField,
  onCopy,
  onEdit,
  onDelete,
}: {
  client: OidcClientRow;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [showId, setShowId] = useState(false);

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono text-pastel-800 font-medium">{client.clientId}</code>
          {client.isDefault && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-600 rounded">{t('common.default')}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <button
            onClick={() => setShowId(prev => !prev)}
            className="text-[11px] text-pastel-400 hover:text-pastel-600 flex items-center gap-1"
          >
            {showId ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showId ? t('oidcClients.hideId') : t('oidcClients.copyClientId')}
          </button>
          {showId && (
            <button
              onClick={() => onCopy(client.clientId, `id-${client.clientId}`)}
              className="text-[11px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5"
            >
              {copiedField === `id-${client.clientId}` ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          )}
        </div>
      </td>
      <td className="px-5 py-3.5">
        <div className="space-y-0.5">
          {client.redirectUris.map((uri, i) => (
            <code key={i} className="block text-xs font-mono text-pastel-600 truncate max-w-[300px]" title={uri}>
              {uri}
            </code>
          ))}
        </div>
      </td>
      <td className="px-5 py-3.5 text-xs text-pastel-500">
        {client.createdAt ? new Date(client.createdAt).toLocaleDateString('ko-KR') : '-'}
      </td>
      <td className="px-5 py-3.5 text-xs text-pastel-500">
        {client.createdBy || '-'}
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={onEdit}
            title={t('common.edit')}
            className="p-1.5 rounded-md text-pastel-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {!client.isDefault && (
            <button
              onClick={onDelete}
              title={t('common.delete')}
              className="p-1.5 rounded-md text-pastel-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
