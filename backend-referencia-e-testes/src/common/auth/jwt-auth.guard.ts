import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

/**
 * Mesmo padrão de autenticação já validado no projeto anterior:
 * verificação assimétrica (RS256/ES256) contra o endpoint JWKS do
 * Supabase — nunca usa uma chave secreta compartilhada armazenada no
 * backend, sempre valida contra a chave pública publicada pelo Supabase.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private client = jwksClient({
    jwksUri: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 3600_000,
  });

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization as string | undefined;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente');
    }

    const token = authHeader.slice('Bearer '.length);
    const decoded = await this.verify(token);

    // req.user.id é o único ponto de confiança de "de quem é esse dado"
    // em todos os services do sistema (Fase 3)
    request.user = { id: decoded.sub, email: decoded.email };
    return true;
  }

  private verify(token: string): Promise<jwt.JwtPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(
        token,
        (header, callback) => {
          this.client.getSigningKey(header.kid, (err, key) => {
            if (err || !key) return callback(err ?? new Error('Chave de assinatura não encontrada'));
            callback(null, key.getPublicKey());
          });
        },
        { algorithms: ['RS256', 'ES256'] },
        (err, decoded) => {
          if (err || !decoded) return reject(new UnauthorizedException('Token inválido'));
          resolve(decoded as jwt.JwtPayload);
        },
      );
    });
  }
}
