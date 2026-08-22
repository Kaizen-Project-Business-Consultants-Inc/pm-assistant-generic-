import { databaseService } from './connection';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  dbName: string;
  ownerUserId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionItemId: string | null;
  subscriptionTier: 'trial' | 'consultant_basic' | 'consultant_pro' | 'sme' | 'enterprise';
  subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'none';
  billingModel: 'flat' | 'per_seat';
  seatCount: number;
  seatPriceCents: number;
  trialEndsAt: string | null;
  maxUsers: number;
  viewerLimit: number;
  isActive: boolean;
  isProvisioned: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    dbName: row.db_name,
    ownerUserId: row.owner_user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    stripeSubscriptionItemId: row.stripe_subscription_item_id ?? null,
    subscriptionTier: row.subscription_tier,
    subscriptionStatus: row.subscription_status,
    billingModel: row.billing_model ?? 'flat',
    seatCount: row.seat_count ?? 1,
    seatPriceCents: row.seat_price_cents ?? 3300,
    trialEndsAt: row.trial_ends_at,
    maxUsers: row.max_users,
    viewerLimit: row.viewer_limit ?? 5,
    isActive: !!row.is_active,
    isProvisioned: !!row.is_provisioned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OrganizationRepository {
  async findById(id: string): Promise<Organization | null> {
    const rows = await databaseService.queryControlPlane(
      'SELECT * FROM organizations WHERE id = ?',
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const rows = await databaseService.queryControlPlane(
      'SELECT * FROM organizations WHERE slug = ?',
      [slug],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByOwner(userId: string): Promise<Organization | null> {
    const rows = await databaseService.queryControlPlane(
      'SELECT * FROM organizations WHERE owner_user_id = ?',
      [userId],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<Organization | null> {
    const rows = await databaseService.queryControlPlane(
      `SELECT o.* FROM organizations o
       JOIN users u ON u.organization_id = o.id
       WHERE u.id = ?`,
      [userId],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findAllActive(): Promise<Organization[]> {
    const rows = await databaseService.queryControlPlane(
      'SELECT * FROM organizations WHERE is_active = 1 ORDER BY created_at ASC',
    );
    return rows.map(mapRow);
  }

  async findAllActiveProvisioned(): Promise<Organization[]> {
    const rows = await databaseService.queryControlPlane(
      'SELECT * FROM organizations WHERE is_active = 1 AND is_provisioned = 1 ORDER BY created_at ASC',
    );
    return rows.map(mapRow);
  }

  async create(org: Omit<Organization, 'createdAt' | 'updatedAt'>): Promise<Organization> {
    await databaseService.queryControlPlane(
      `INSERT INTO organizations (id, name, slug, db_name, owner_user_id, stripe_customer_id,
        subscription_tier, subscription_status, trial_ends_at, max_users, is_active, is_provisioned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        org.id, org.name, org.slug, org.dbName, org.ownerUserId,
        org.stripeCustomerId, org.subscriptionTier, org.subscriptionStatus,
        org.trialEndsAt, org.maxUsers, org.isActive ? 1 : 0, org.isProvisioned ? 1 : 0,
      ],
    );
    return (await this.findById(org.id))!;
  }

  async update(id: string, data: Partial<Pick<Organization, 'name' | 'isActive' | 'isProvisioned' | 'subscriptionTier' | 'subscriptionStatus' | 'trialEndsAt' | 'maxUsers' | 'stripeCustomerId' | 'stripeSubscriptionId' | 'stripeSubscriptionItemId' | 'billingModel' | 'seatCount' | 'seatPriceCents' | 'viewerLimit'>>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    const columnMap: Record<string, string> = {
      name: 'name',
      isActive: 'is_active',
      isProvisioned: 'is_provisioned',
      subscriptionTier: 'subscription_tier',
      subscriptionStatus: 'subscription_status',
      trialEndsAt: 'trial_ends_at',
      maxUsers: 'max_users',
      stripeCustomerId: 'stripe_customer_id',
      stripeSubscriptionId: 'stripe_subscription_id',
      stripeSubscriptionItemId: 'stripe_subscription_item_id',
      billingModel: 'billing_model',
      seatCount: 'seat_count',
      seatPriceCents: 'seat_price_cents',
      viewerLimit: 'viewer_limit',
    };

    for (const [key, column] of Object.entries(columnMap)) {
      if (key in data) {
        fields.push(`${column} = ?`);
        let val = (data as any)[key];
        if (key === 'isActive' || key === 'isProvisioned') val = val ? 1 : 0;
        values.push(val ?? null);
      }
    }

    if (fields.length === 0) return;

    values.push(id);
    await databaseService.queryControlPlane(
      `UPDATE organizations SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
  }

  async countUsers(orgId: string): Promise<number> {
    const rows = await databaseService.queryControlPlane(
      'SELECT COUNT(*) AS cnt FROM users WHERE organization_id = ?',
      [orgId],
    );
    return Number(rows[0].cnt);
  }

  async countNonViewerUsers(orgId: string): Promise<number> {
    const rows = await databaseService.queryControlPlane(
      "SELECT COUNT(*) AS cnt FROM users WHERE organization_id = ? AND role != 'viewer' AND is_active = 1",
      [orgId],
    );
    return Number(rows[0].cnt);
  }

  async findByStripeCustomerId(stripeCustomerId: string): Promise<Organization | null> {
    const rows = await databaseService.queryControlPlane(
      'SELECT * FROM organizations WHERE stripe_customer_id = ?',
      [stripeCustomerId],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async getUserIdsInOrg(orgId: string): Promise<string[]> {
    const rows = await databaseService.queryControlPlane(
      'SELECT id FROM users WHERE organization_id = ? AND is_active = 1',
      [orgId],
    );
    return rows.map((r: any) => r.id);
  }
}

export const organizationRepository = new OrganizationRepository();
