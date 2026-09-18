import { Controller, Module, Post, Body } from '@nestjs/common';
import { SmsParserService, ParsedSmsResult } from './sms-parser.service';

export class ParseSmsDto {
  sender!: string;
  body!: string;
}

/** Serializa BigInt como string — o JSON nativo não sabe lidar com BigInt. */
function serialize(result: ParsedSmsResult) {
  return { ...result, amountCents: result.amountCents?.toString() ?? null };
}

@Controller('sms-parser')
export class SmsParserController {
  constructor(private readonly parser: SmsParserService) {}

  /**
   * Usado pelos dois caminhos de captura do PWA (Fase 2-PWA):
   * 1. Web Share Target — o texto compartilhado do SMS chega aqui.
   * 2. Colar manual — usuário cola o texto na tela de "Adicionar rápido".
   * Em ambos, o resultado volta para a UI confirmar antes de criar a
   * transação de fato (nunca cria automaticamente sem confirmação).
   */
  @Post('parse')
  parse(@Body() dto: ParseSmsDto) {
    return serialize(this.parser.parse(dto.sender, dto.body));
  }
}

@Module({
  controllers: [SmsParserController],
  providers: [SmsParserService],
  exports: [SmsParserService],
})
export class SmsParserModule {}
