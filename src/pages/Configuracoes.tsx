import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { PluggyConnect } from 'react-pluggy-connect';
import { PiggyBank, TrendingUp, Landmark, FileText, Bell, LogOut, ChevronRight, CreditCard, Banknote, RefreshCw, Link2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { enablePushNotifications, isPushEnabled } from '../lib/push';
import { api } from '../lib/api';

interface BankConnection {
  id: string;
  itemId: string;
  institutionName: string | null;
  lastSyncedAt: string | null;
}

const menuItems = [
  { to: '/cartoes', label: 'Cartões', Icon: CreditCard },
  { to: '/orcamento', label: 'Orçamento', Icon: PiggyBank },
  { to: '/investimentos', label: 'Investimentos', Icon: TrendingUp },
  { to: '/financiamentos', label: 'Financiamentos', Icon: Landmark },
  { to: '/relatorios', label: 'Relatórios', Icon: FileText },
];

export default function Configuracoes() {
  const [pushStatus, setPushStatus] = useState<'checking' | 'enabled' | 'disabled'>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [itemIdInput, setItemIdInput] = useState('');
  const [addingConnection, setAddingConnection] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);

  useEffect(() => {
    isPushEnabled().then((enabled) => setPushStatus(enabled ? 'enabled' : 'disabled'));
    loadConnections();
  }, []);

  function loadConnections() {
    api.get<BankConnection[]>('/bank-connections').then(setConnections).catch(() => {});
  }

  /** Botão "Conectar banco" — pede o token e abre o widget oficial da Pluggy dentro do próprio app. */
  async function handleOpenConnect() {
    setLoadingToken(true);
    setBankError(null);
    try {
      const { accessToken } = await api.post<{ accessToken: string }>('/bank-connections/connect-token');
      setConnectToken(accessToken);
    } catch (e: any) {
      setBankError(e.message);
    } finally {
      setLoadingToken(false);
    }
  }

  /** Widget concluiu a conexão — salva o Item ID automaticamente, sem o usuário precisar copiar/colar nada. */
  async function handleConnectSuccess(data: { item: { id: string } }) {
    setConnectToken(null);
    try {
      await api.post('/bank-connections', { itemId: data.item.id });
      loadConnections();
      handleSync();
    } catch (e: any) {
      setBankError(e.message);
    }
  }

  async function handleAddConnection() {
    if (!itemIdInput.trim()) return;
    setAddingConnection(true);
    setBankError(null);
    try {
      await api.post('/bank-connections', { itemId: itemIdInput.trim() });
      setItemIdInput('');
      loadConnections();
    } catch (e: any) {
      setBankError(e.message?.includes('duplicate key') ? 'Essa conexão já está adicionada.' : e.message);
    } finally {
      setAddingConnection(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setBankError(null);
    setSyncResult(null);
    try {
      const result = await api.post<{
        results: Array<{ institutionName: string | null; status: string; message?: string; accountsFound: number; transactionsImported: number }>;
      }>('/bank-connections/sync');

      const summary = result.results
        .map((r) => {
          const label = r.institutionName || 'Conexão';
          if (r.status === 'UPDATING') return `${label}: ainda sincronizando no banco, tente de novo em instantes.`;
          if (r.accountsFound === 0) return `${label}: nenhuma conta encontrada (status: ${r.status}).`;
          return `${label}: ${r.accountsFound} conta(s), ${r.transactionsImported} movimentação(ões) importada(s).`;
        })
        .join(' ');

      setSyncResult(summary || 'Sincronizado.');
      loadConnections();
    } catch (e: any) {
      setBankError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleEnablePush() {
    const result = await enablePushNotifications();
    if (result === 'enabled') {
      setPushStatus('enabled');
      setMessage('Avisos de vencimento ativados neste dispositivo.');
    } else if (result === 'denied') {
      setMessage('Permissão de notificação negada — ative manualmente nas configurações do navegador.');
    } else {
      setMessage('Este navegador não tem suporte a notificações push.');
    }
  }

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <h1 className="text-lg font-medium mb-4">Mais</h1>

      <div className="flex flex-col gap-2">
        {menuItems.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 bg-bg-card border border-border-default rounded-xl p-3.5 text-sm text-text-primary"
          >
            <div className="w-9 h-9 rounded-lg bg-income-green/15 flex items-center justify-center shrink-0">
              <Icon size={18} strokeWidth={1.75} className="text-income-green" />
            </div>
            <span className="flex-1">{label}</span>
            <ChevronRight size={16} className="text-text-muted" />
          </Link>
        ))}
      </div>

      <div className="bg-bg-card border border-border-default rounded-xl p-3.5 mt-4">
        <div className="flex items-center gap-2 mb-1">
          <Banknote size={15} className="text-income-green" strokeWidth={1.75} />
          <div className="text-[12.5px] text-text-primary">Contas bancárias (Open Finance)</div>
        </div>
        <div className="text-[11px] text-text-secondary mb-3">
          Conecte seu banco direto aqui — a autorização acontece no próprio app do
          banco, o app nunca vê sua senha.
        </div>
        <div className="text-[10px] text-text-muted mb-3">
          Pra testar sem usar um banco real: escolha "Pluggy Bank" na lista, use
          usuário <code className="text-income-green">user-ok</code>, senha{' '}
          <code className="text-income-green">password-ok</code>, código MFA{' '}
          <code className="text-income-green">123456</code> se pedir.
        </div>

        {connections.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-3">
            {connections.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-bg-base rounded-lg px-2.5 py-2">
                <span className="text-[11.5px] text-text-primary truncate">
                  {c.institutionName || `Item ${c.itemId.slice(0, 8)}...`}
                </span>
                <span className="text-[10px] text-text-muted shrink-0">
                  {c.lastSyncedAt ? `sinc. ${new Date(c.lastSyncedAt).toLocaleDateString('pt-BR')}` : 'nunca sincronizado'}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleOpenConnect}
          disabled={loadingToken}
          className="w-full flex items-center justify-center gap-1.5 bg-income-green text-bg-base text-[13px] font-medium py-2.5 rounded-lg disabled:opacity-50 mb-2"
        >
          <Link2 size={14} strokeWidth={2} />
          {loadingToken ? 'Abrindo...' : 'Conectar banco'}
        </button>

        <details className="mb-2">
          <summary className="text-[10.5px] text-text-muted cursor-pointer select-none">
            Já tenho um Item ID (colar manualmente)
          </summary>
          <div className="flex items-center gap-2 mt-2">
            <input
              value={itemIdInput}
              onChange={(e) => setItemIdInput(e.target.value)}
              placeholder="Cole o Item ID aqui"
              className="flex-1 bg-bg-base border border-border-default rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-income-green"
            />
            <button
              onClick={handleAddConnection}
              disabled={addingConnection || !itemIdInput.trim()}
              className="bg-bg-base border border-border-default text-text-primary text-[12px] font-medium px-3 py-2 rounded-lg disabled:opacity-50 shrink-0"
            >
              {addingConnection ? '...' : 'Adicionar'}
            </button>
          </div>
        </details>

        {connectToken && (
          <PluggyConnect
            connectToken={connectToken}
            includeSandbox={true}
            onSuccess={handleConnectSuccess}
            onError={(err) => setBankError(err.message)}
            onClose={() => setConnectToken(null)}
          />
        )}

        {connections.length > 0 && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full flex items-center justify-center gap-1.5 bg-bg-base border border-border-default text-text-primary text-[12.5px] font-medium py-2.5 rounded-lg disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={2} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>
        )}

        {bankError && <div className="text-[10.5px] text-expense-red mt-2">{bankError}</div>}
        {syncResult && <div className="text-[10.5px] text-income-green mt-2">{syncResult}</div>}
      </div>

      <div className="bg-bg-card border border-border-default rounded-xl p-3.5 mt-4">
        <div className="flex items-center gap-2 mb-1">
          <Bell size={15} className="text-warning-amber" strokeWidth={1.75} />
          <div className="text-[12.5px] text-text-primary">Avisos de vencimento</div>
        </div>
        <div className="text-[11px] text-text-secondary mb-3">
          {pushStatus === 'enabled'
            ? 'Ativados — você recebe avisos 10, 5 e 2 dias antes, e 3 vezes no dia do vencimento.'
            : 'Ainda não ativados neste dispositivo.'}
        </div>
        {pushStatus !== 'enabled' && (
          <button
            onClick={handleEnablePush}
            className="w-full bg-income-green text-bg-base text-center text-[13px] font-medium py-2.5 rounded-lg"
          >
            Ativar avisos neste dispositivo
          </button>
        )}
        {message && <div className="text-[10.5px] text-text-muted mt-2">{message}</div>}
      </div>

      <div className="bg-bg-card border border-border-default rounded-xl p-3.5 mt-4 text-[11.5px] text-text-secondary">
        A captura automática de SMS neste PWA funciona por compartilhamento (Android) ou colando o texto
        manualmente — navegadores não têm acesso direto à caixa de mensagens do celular, em nenhuma plataforma.
      </div>

      <button
        onClick={() => supabase.auth.signOut()}
        className="w-full flex items-center justify-center gap-2 mt-6 text-center text-[13px] text-expense-red py-2"
      >
        <LogOut size={15} strokeWidth={1.75} />
        Sair da conta
      </button>
    </div>
  );
}
