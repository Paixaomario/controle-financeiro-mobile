import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Plus, MessageSquareText, Check, X } from 'lucide-react';
import { api } from '../lib/api';
import { MoneyInput } from '../components/MoneyInput';

type Kind = 'INCOME' | 'EXPENSE';

interface Category {
  id: string;
  name: string;
  kind: Kind;
}

function todayInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Tela central de lançamento manual — não depende de SMS nenhum. O
 * seletor Entrada/Saída no topo decide o tipo, filtra as categorias
 * certas, e muda a cor de destaque (verde/vermelho) em todo o formulário.
 */
export default function NovoLancamento() {
  const navigate = useNavigate();

  const [kind, setKind] = useState<Kind>('EXPENSE');
  const [amountCents, setAmountCents] = useState('0');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayInputValue());
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCategories();
  }, []);

  // troca o tipo (entrada/saída) sempre reseta a categoria selecionada,
  // já que as listas são diferentes
  useEffect(() => {
    setCategoryId('');
  }, [kind]);

  async function loadCategories() {
    try {
      const data = await api.get<Category[]>('/categories');
      setCategories(data);
    } catch {
      // segue com a lista vazia — o usuário ainda consegue criar categorias novas
    }
  }

  const filteredCategories = categories.filter((c) => c.kind === kind);

  /**
   * Agente de Categorização Inteligente: quando o usuário termina de
   * digitar o nome do estabelecimento e ainda não escolheu categoria,
   * pergunta ao agente se ele já sabe (aprendido de lançamentos
   * anteriores) ou se a IA consegue sugerir — sem travar a tela se falhar.
   */
  async function handleDescriptionBlur() {
    if (!description.trim() || categoryId || kind !== 'EXPENSE') return;
    try {
      const { categoryId: suggested } = await api.post<{ categoryId: string | null }>(
        '/financial-coach/suggest-category',
        { merchantName: description.trim() },
      );
      if (suggested && filteredCategories.some((c) => c.id === suggested)) {
        setCategoryId(suggested);
      }
    } catch {
      // sugestão é um extra — sem categoria sugerida, o usuário escolhe manualmente
    }
  }
  async function handleAddCategory() {
    if (!newCategoryName.trim()) return;
    setSavingCategory(true);
    setError(null);
    try {
      const created = await api.post<Category>('/categories', { name: newCategoryName.trim(), kind });
      setCategories((prev) => [...prev, created]);
      setCategoryId(created.id);
      setNewCategoryName('');
      setAddingCategory(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleSave() {
    if (amountCents === '0' || !categoryId) {
      setError('Preencha o valor e escolha uma categoria.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post('/transactions', {
        type: kind,
        amountCents,
        occurredAt: new Date(`${date}T12:00:00`).toISOString(),
        categoryId,
        merchantName: description.trim() || null,
      });
      navigate('/extrato');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 pb-24 max-w-md mx-auto">
      <h1 className="text-lg font-medium mb-4">Novo lançamento</h1>

      {/* Seletor Entrada / Saída */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setKind('INCOME')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl border text-sm font-medium transition-colors ${
            kind === 'INCOME'
              ? 'bg-income-green/15 border-income-green text-income-green'
              : 'bg-bg-card border-border-default text-text-secondary'
          }`}
        >
          <ArrowUpRight size={17} strokeWidth={2} />
          Entrada
        </button>
        <button
          onClick={() => setKind('EXPENSE')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl border text-sm font-medium transition-colors ${
            kind === 'EXPENSE'
              ? 'bg-expense-red/15 border-expense-red text-expense-red'
              : 'bg-bg-card border-border-default text-text-secondary'
          }`}
        >
          <ArrowDownRight size={17} strokeWidth={2} />
          Saída
        </button>
      </div>

      {/* Valor */}
      <label className="text-[10.5px] text-text-secondary block mb-1">Valor</label>
      <MoneyInput valueCents={amountCents} onChange={setAmountCents} autoFocus />

      {/* Categoria */}
      <label className="text-[10.5px] text-text-secondary block mt-4 mb-1">
        Categoria de {kind === 'INCOME' ? 'entrada' : 'saída'}
      </label>

      {!addingCategory ? (
        <div className="flex flex-wrap gap-2">
          {filteredCategories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`px-3 py-2 rounded-lg text-[12.5px] border transition-colors ${
                categoryId === c.id
                  ? kind === 'INCOME'
                    ? 'bg-income-green/15 border-income-green text-income-green'
                    : 'bg-expense-red/15 border-expense-red text-expense-red'
                  : 'bg-bg-card border-border-default text-text-secondary'
              }`}
            >
              {c.name}
            </button>
          ))}
          <button
            onClick={() => setAddingCategory(true)}
            className="px-3 py-2 rounded-lg text-[12.5px] border border-dashed border-border-default text-text-secondary flex items-center gap-1"
          >
            <Plus size={13} strokeWidth={2} />
            Nova categoria
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder={`Nome da nova categoria de ${kind === 'INCOME' ? 'entrada' : 'saída'}`}
            autoFocus
            className="flex-1 bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm outline-none focus:border-income-green"
          />
          <button
            onClick={handleAddCategory}
            disabled={savingCategory || !newCategoryName.trim()}
            className="w-9 h-9 rounded-lg bg-income-green text-bg-base flex items-center justify-center shrink-0 disabled:opacity-50"
          >
            <Check size={16} strokeWidth={2.25} />
          </button>
          <button
            onClick={() => {
              setAddingCategory(false);
              setNewCategoryName('');
            }}
            className="w-9 h-9 rounded-lg bg-bg-card border border-border-default text-text-muted flex items-center justify-center shrink-0"
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>
      )}

      {/* Descrição e data */}
      <label className="text-[10.5px] text-text-secondary block mt-4 mb-1">Descrição (opcional)</label>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={handleDescriptionBlur}
        placeholder={kind === 'INCOME' ? 'Ex: Salário, freelance...' : 'Ex: Mercado, transporte...'}
        className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm outline-none focus:border-income-green"
      />

      <label className="text-[10.5px] text-text-secondary block mt-4 mb-1">Data</label>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm outline-none focus:border-income-green"
      />

      {error && <div className="text-expense-red text-xs mt-3">{error}</div>}

      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full text-bg-base text-center text-sm font-medium py-3 rounded-xl mt-5 disabled:opacity-50 ${
          kind === 'INCOME' ? 'bg-income-green' : 'bg-expense-red'
        }`}
      >
        {saving ? 'Salvando...' : `Salvar ${kind === 'INCOME' ? 'entrada' : 'saída'}`}
      </button>

      <button
        onClick={() => navigate('/capturar')}
        className="w-full flex items-center justify-center gap-1.5 text-center text-[12.5px] text-text-secondary py-3 mt-1"
      >
        <MessageSquareText size={14} strokeWidth={1.75} />
        Ou adicionar via SMS/notificação
      </button>
    </div>
  );
}
