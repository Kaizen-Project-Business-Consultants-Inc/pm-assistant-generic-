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
      /** Belongs to a company (set by authMiddleware). The platform admin has none — see utils/platformAdmin.ts */
      hasCompany?: boolean;
      /** The person's own role. `role` is what they may do: 'pmo' for the company owner (utils/companyOwner.ts) */
      accountRole?: string;
    };
    apiKeyId?: string;
    apiKeyScopes?: string[];
    apiKeyRateLimit?: number | null;
    rawBody?: Buffer;
    projectMembership?: ProjectMember;
    /** Set during the platform admin's read-only Support view visit into one company */
    supportSession?: {
      id: string;
      organizationId: string;
      organizationName: string;
      expiresAt: string;
    };
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
