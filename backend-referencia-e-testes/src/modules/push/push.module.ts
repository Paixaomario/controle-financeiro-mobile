import { Injectable, Logger, Controller, Module, Post, Body, Req } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';

export class SubscribeDto {
  endpoint!: string;
  keys!: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(private readonly prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (publicKey && privateKey) {
      webpush.setVapidDetails('mailto:suporte@controlefinanceiro.app', publicKey, privateKey);
      this.configured = true;
    } else {
      this.logger.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas — push notifications desativadas');
    }
  }

  async subscribe(userId: string, dto: SubscribeDto) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
    });
  }

  /**
   * Envia o push para todos os dispositivos inscritos do usuário. Se o
   * endpoint não existir mais (usuário desinstalou/limpou dados), o
   * provedor de push retorna 410 — nesse caso a assinatura morta é
   * removida do banco automaticamente, para não ficar tentando pra sempre.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
          );
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          } else {
            this.logger.error(`Falha ao enviar push para ${sub.id}: ${err?.message ?? err}`);
          }
        }
      }),
    );
  }
}

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('subscribe')
  subscribe(@Req() req: any, @Body() dto: SubscribeDto) {
    return this.push.subscribe(req.user.id, dto);
  }
}

@Module({
  controllers: [PushController],
  providers: [PushService, PrismaService],
  exports: [PushService],
})
export class PushModule {}
