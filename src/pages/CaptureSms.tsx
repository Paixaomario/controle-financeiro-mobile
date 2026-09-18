import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { MessageSquareText } from 'lucide-react';
import { api } from '../lib/api';
import { formatCentsToBRL } from '../lib/money';

interface ParsedResult {
  recognized: boolean;
  confidence: number;
  amountCents: string | null;
  merchantName: string | null;
  city: string | null;
  paymentMethod: string | null;
  bankGuess: string | null;
  isLoanOrFinancing: boolean;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  needsAiFallback: boolean;
}

interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
}

/**
 * Recebe o texto de duas formas:
 * 1. Web Share Target — o Android manda ?text=... quando o usuário
 *    compartilha o SMS direto na folha de compartilhamento nativa.
 * 2. Colar manual — campo de texto nesta própria tela (funciona em
 *    qualquer plataforma, inclusive iOS).
 * Em ambos os casos, chama POST /sms-parser/parse e SEMPRE mostra a
 * confirmação antes de criar a transação — nunca cria automaticamente.
 */
export default function CaptureSms() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const sharedText = searchParams.get('text') || '';
  const [rawText, setRawText] = useState(sharedText);
  const [sender, setSender] = useState('');
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Category[]>('/categories').then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    if (sharedText) void handleParse(sharedText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedText]);

  async function handleParse(text: string) {
    if (!text.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const parsed = await api.post<ParsedResult>('/sms-parser/parse', {
        sender: sender || 'desconhecido',
        body: text,
      });
      setResult(parsed);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirm() {
    if (!result?.amountCents || !selectedCategoryId) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/transactions/ingest', {
        type: result.isLoanOrFinancing ? 'EXPENSE' : 'EXPENSE',
        amountCents: result.amountCents,
        occurredAt: new Date().toISOString(),
        categoryId: selectedCategoryId,
        merchantName: result.merchantName,
        merchantCity: result.city,
        paymentMethod: result.paymentMethod,
        bankUsed: result.bankGuess,
        sourceConfidence: result.confidence,
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
      <h1 className="text-lg font-medium mb-1 flex items-center gap-2">
        <MessageSquareText size={19} strokeWidth={1.75} className="text-text-secondary" />
        Adicionar via SMS
      </h1>
      <p className="text-[11px] text-text-secondary mb-4">
        Compartilhe o SMS/notificação bancária direto para este app, ou cole o texto abaixo.
      </p>

      {!result && (
        <>
          <label className="text-[10.5px] text-text-secondary block mb-1">Remetente (opcional)</label>
          <input
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder="Ex: Nubank"
            className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:border-income-green"
          />

          <label className="text-[10.5px] text-text-secondary block mb-1">Texto da mensagem</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={4}
            placeholder="Cole aqui o texto do SMS ou notificação"
            className="w-full bg-bg-card border border-border-default rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:border-income-green"
          />

          <button
            onClick={() => handleParse(rawText)}
            disabled={parsing || !rawText.trim()}
            className="w-full bg-income-green text-bg-base text-center text-sm font-medium py-3 rounded-xl disabled:opacity-50"
          >
            {parsing ? 'Analisando...' : 'Analisar mensagem'}
          </button>
        </>
      )}

      {error && <div className="text-expense-red text-xs mt-3">{error}</div>}

      {result && (
        <div>
          {result.recognized ? (
            <div className="bg-bg-card border border-border-default rounded-xl p-4 mb-4">
              <div className="flex items-center gap-1.5 text-[10.5px] text-income-green mb-3">
                ✉ reconhecido {result.bankGuess ? `— ${result.bankGuess}` : ''}
                {result.isLoanOrFinancing && ' · possível financiamento'}
              </div>

              <div className="text-[26px] font-medium text-text-primary mb-3">
                {formatCentsToBRL(result.amountCents)}
              </div>

              <div className="flex flex-col gap-2 text-[12.5px] text-text-secondary mb-3">
                {result.merchantName && (
                  <div>
                    Estabelecimento: <span className="text-text-primary">{result.merchantName}</span>
                  </div>
                )}
                {result.city && (
                  <div>
                    Cidade: <span className="text-text-primary">{result.city}</span>
                  </div>
                )}
                {result.paymentMethod && (
                  <div>
                    Forma de pagamento: <span className="text-text-primary">{result.paymentMethod}</span>
                  </div>
                )}
                {result.installmentCurrent && (
                  <div>
                    Parcela:{' '}
                    <span className="text-text-primary">
                      {result.installmentCurrent}/{result.installmentTotal}
                    </span>
                  </div>
                )}
              </div>

              <label className="text-[10.5px] text-text-secondary block mb-1">Categoria</label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full bg-bg-base border border-border-default rounded-lg px-3 py-2.5 text-sm mb-4 outline-none focus:border-income-green"
              >
                <option value="">Selecione...</option>
                {categories
                  .filter((c) => c.kind === 'EXPENSE')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>

              {result.isLoanOrFinancing && (
                <div className="bg-[#2A2412] border border-warning-amber/30 rounded-lg px-3 py-2.5 mb-4 text-[11.5px] text-warning-amber">
                  Isso parece parcela de financiamento/empréstimo. Depois de salvar, cadastre o financiamento completo em "Financiamentos" para gerar o cronograma de parcelas.
                </div>
              )}

              <button
                onClick={handleConfirm}
                disabled={!selectedCategoryId || saving}
                className="w-full bg-income-green text-bg-base text-center text-sm font-medium py-3 rounded-xl disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Confirmar lançamento'}
              </button>
            </div>
          ) : (
            <div className="bg-bg-card border border-border-default rounded-xl p-4 mb-4 text-center">
              <div className="text-[13px] text-text-secondary mb-1">
                Não consegui reconhecer os dados automaticamente.
              </div>
              <div className="text-[11px] text-text-muted">
                Você pode lançar manualmente na tela de Extrato.
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setResult(null);
              setRawText('');
            }}
            className="w-full text-center text-[12.5px] text-text-secondary py-2"
          >
            Analisar outra mensagem
          </button>
        </div>
      )}
    </div>
  );
}
