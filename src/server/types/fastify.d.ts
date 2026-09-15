import 'fastify';
import { ServiceContainer } from '../container';
import { ProjectMember } from '../database/ProjectMemberRepository';

/** Shape of the JWT access token payload (signed by JWT_SECRET). */
export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  tv?: number; // token version
  type?: string; // 'refresh' for refresh tokens
  iat?: number;
  exp?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId: string;
      username: string;
      role: string;
      isGuest?: boolean;
      guestExpiresAt?: string | null;
    };
    apiKeyId?: string;
    apiKeyScopes?: string[];
    apiKeyRateLimit?: number | null;
    rawBody?: Buffer;
    projectMembership?: ProjectMember;
    tenantOrg?: {
      id: string;
      slug: string;
      dbName: string;
    };
  }

  interface FastifyInstance {
    services: ServiceContainer;
  }
}
