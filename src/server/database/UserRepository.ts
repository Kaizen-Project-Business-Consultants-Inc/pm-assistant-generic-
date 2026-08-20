import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import type { User, CreateUserData } from '../services/UserService';

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    emailVerified: Boolean(row.email_verified),
    emailVerificationToken: row.email_verification_token,
    emailVerificationExpires: row.email_verification_expires,
    passwordResetToken: row.password_reset_token,
    passwordResetExpires: row.password_reset_expires,
    stripeCustomerId: row.stripe_customer_id,
    subscriptionTier: row.subscription_tier || 'trial',
    subscriptionStatus: row.subscription_status || 'none',
    trialEndsAt: row.trial_ends_at,
    trialStartedAt: row.trial_started_at ?? null,
    emailNotificationsEnabled: row.email_notifications_enabled == null ? true : Boolean(row.email_notifications_enabled),
    digestFrequency: row.digest_frequency || 'none',
    digestPreferredHour: Number(row.digest_preferred_hour) || 7,
    digestSections: row.digest_sections ? (typeof row.digest_sections === 'string' ? JSON.parse(row.digest_sections) : row.digest_sections) : null,
    digestLastSentAt: row.digest_last_sent_at ?? null,
    lastLoginAt: row.last_login_at ?? null,
    timezone: row.timezone || 'UTC',
    locale: row.locale || 'en',
    loginVerificationToken: row.login_verification_token ?? null,
    loginVerificationExpires: row.login_verification_expires ?? null,
    notificationTypePreferences: row.notification_type_preferences
      ? (typeof row.notification_type_preferences === 'string'
        ? JSON.parse(row.notification_type_preferences)
        : row.notification_type_preferences)
      : null,
    tokenVersion: row.token_version ?? 0,
    aiMonthlyTokenBudget: row.ai_monthly_token_budget != null ? Number(row.ai_monthly_token_budget) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const USER_COLUMN_MAP: Record<string, string> = {
  username: 'username',
  email: 'email',
  passwordHash: 'password_hash',
  fullName: 'full_name',
  role: 'role',
  isActive: 'is_active',
  emailVerified: 'email_verified',
  emailVerificationToken: 'email_verification_token',
  emailVerificationExpires: 'email_verification_expires',
  passwordResetToken: 'password_reset_token',
  passwordResetExpires: 'password_reset_expires',
  stripeCustomerId: 'stripe_customer_id',
  subscriptionTier: 'subscription_tier',
  subscriptionStatus: 'subscription_status',
  trialEndsAt: 'trial_ends_at',
  trialStartedAt: 'trial_started_at',
  emailNotificationsEnabled: 'email_notifications_enabled',
  digestFrequency: 'digest_frequency',
  digestPreferredHour: 'digest_preferred_hour',
  digestSections: 'digest_sections',
  digestLastSentAt: 'digest_last_sent_at',
  lastLoginAt: 'last_login_at',
  timezone: 'timezone',
  locale: 'locale',
  organizationId: 'organization_id',
  loginVerificationToken: 'login_verification_token',
  loginVerificationExpires: 'login_verification_expires',
  notificationTypePreferences: 'notification_type_preferences',
  tokenVersion: 'token_version',
  aiMonthlyTokenBudget: 'ai_monthly_token_budget',
};

export class UserRepository extends BaseRepository<User> {
  constructor() {
    super('users', rowToUser, { controlPlane: true });
  }

  async findByUsername(username: string): Promise<User | null> {
    const rows = await this.queryRaw('SELECT * FROM users WHERE username = ?', [username]);
    return rows.length > 0 ? rowToUser(rows[0]) : null;
  }

  async findByUsernames(usernames: string[]): Promise<User[]> {
    if (usernames.length === 0) return [];
    const placeholders = usernames.map(() => '?').join(',');
    const rows = await this.queryRaw(`SELECT * FROM users WHERE username IN (${placeholders})`, usernames);
    return rows.map(rowToUser);
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.queryRaw('SELECT * FROM users WHERE email = ?', [email]);
    return rows.length > 0 ? rowToUser(rows[0]) : null;
  }

  async findByVerificationToken(token: string): Promise<User | null> {
    const rows = await this.queryRaw(
      'SELECT * FROM users WHERE email_verification_token = ? AND email_verification_expires > NOW()',
      [token],
    );
    return rows.length > 0 ? rowToUser(rows[0]) : null;
  }

  async findByResetToken(token: string): Promise<User | null> {
    const rows = await this.queryRaw(
      'SELECT * FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()',
      [token],
    );
    return rows.length > 0 ? rowToUser(rows[0]) : null;
  }

  async findByLoginVerificationToken(token: string): Promise<User | null> {
    const rows = await this.queryRaw(
      'SELECT * FROM users WHERE login_verification_token = ? AND login_verification_expires > NOW()',
      [token],
    );
    return rows.length > 0 ? rowToUser(rows[0]) : null;
  }

  async findByStripeCustomerId(customerId: string): Promise<User | null> {
    const rows = await this.queryRaw('SELECT * FROM users WHERE stripe_customer_id = ?', [customerId]);
    return rows.length > 0 ? rowToUser(rows[0]) : null;
  }

  async create(data: CreateUserData): Promise<User> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO users (id, username, email, password_hash, full_name, role, is_active, email_verified, email_verification_token, email_verification_expires, stripe_customer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.username,
        data.email,
        data.passwordHash,
        data.fullName,
        data.role || 'team_member',
        true,
        data.emailVerified ?? false,
        data.emailVerificationToken || null,
        data.emailVerificationExpires || null,
        data.stripeCustomerId || null,
      ],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: Record<string, any>): Promise<User | null> {
    const result = this.buildUpdate(data, USER_COLUMN_MAP, (key, val) => {
      if ((key === 'notificationTypePreferences' || key === 'digestSections') && val != null) return JSON.stringify(val);
      return val;
    });
    if (!result) return this.findById(id);

    result.values.push(id);
    await this.queryRaw(result.sql, result.values);
    return this.findById(id);
  }

  async list(limit = 1000): Promise<User[]> {
    return this.findAll(limit);
  }

  async listByOrganization(orgId: string): Promise<User[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM users WHERE organization_id = ? ORDER BY created_at ASC',
      [orgId],
    );
    return rows.map(rowToUser);
  }

  async getAccessibilityPrefs(userId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.queryRaw(
      'SELECT accessibility_preferences FROM users WHERE id = ?',
      [userId],
    );
    if (rows.length === 0) return null;
    const raw = rows[0].accessibility_preferences;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async updateAccessibilityPrefs(userId: string, prefs: Record<string, unknown>): Promise<void> {
    await this.queryRaw(
      'UPDATE users SET accessibility_preferences = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(prefs), userId],
    );
  }

  async getDashboardPrefs(userId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.queryRaw(
      'SELECT dashboard_preferences FROM users WHERE id = ?',
      [userId],
    );
    if (rows.length === 0) return null;
    const raw = rows[0].dashboard_preferences;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async updateDashboardPrefs(userId: string, prefs: Record<string, unknown>): Promise<void> {
    await this.queryRaw(
      'UPDATE users SET dashboard_preferences = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(prefs), userId],
    );
  }

  async getViewPrefs(userId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.queryRaw(
      'SELECT view_preferences FROM users WHERE id = ?',
      [userId],
    );
    if (rows.length === 0) return null;
    const raw = rows[0].view_preferences;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async updateViewPrefs(userId: string, prefs: Record<string, unknown>): Promise<void> {
    await this.queryRaw(
      'UPDATE users SET view_preferences = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(prefs), userId],
    );
  }
}

export const userRepository = new UserRepository();
