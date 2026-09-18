import { Injectable, Controller, Module, Post, Body } from '@nestjs/common';

export class CategorizeFallbackDto {
  /** Texto do SMS já isolado no dispositivo — chega aqui só para essa
   *  chamada pontual, nunca fica persistido no backend (Fase 2). */
  smsText!: string;
  availableCategories!: string[];
}

@Injectable()
export class AiCategorizationService {
  /**
   * Chamado só quando o parser local (Fase 2/sms-parser) não conseguiu
   * extrair os dados com confiança suficiente. A CLAUDE_API_KEY nunca
   * sai do backend — o app Android nunca a recebe (parecer da Fase 2/3).
   */
  async categorizeFallback(dto: CategorizeFallbackDto) {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY não configurada no backend');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `Extraia desta mensagem financeira o valor (em centavos), o estabelecimento, o tipo (compra/pix/débito/crédito/boleto) e se é financiamento/empréstimo. Responda APENAS em JSON, sem markdown. Categorias disponíveis: ${dto.availableCategories.join(', ')}.\n\nMensagem: "${dto.smsText}"`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Falha na chamada à Claude API: ${response.status}`);
    }

    const data = await response.json();
    const textBlock = data.content?.find((b: any) => b.type === 'text');
    if (!textBlock) throw new Error('Resposta da IA sem conteúdo de texto');

    try {
      return JSON.parse(textBlock.text);
    } catch {
      throw new Error('Resposta da IA não veio em JSON válido');
    }
  }
}

@Controller('ai-categorization')
export class AiCategorizationController {
  constructor(private readonly ai: AiCategorizationService) {}

  @Post('fallback')
  fallback(@Body() dto: CategorizeFallbackDto) {
    return this.ai.categorizeFallback(dto);
  }
}

@Module({
  controllers: [AiCategorizationController],
  providers: [AiCategorizationService],
  exports: [AiCategorizationService],
})
export class AiCategorizationModule {}
