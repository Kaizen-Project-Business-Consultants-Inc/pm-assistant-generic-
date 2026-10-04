/**
 * The client API — one `apiService` object for every server call.
 *
 * The methods live by area in ./apiAreas/ (auth, billing, projects, schedules, …). This file
 * stitches them back into one ApiService so every caller keeps
 * `import { apiService } from '../services/api'` and the same method names and types.
 *
 * - ./apiAreas/http.ts holds the ONE axios instance and its interceptors (ApiBase).
 * - Each area class extends ApiBase only for typing; its methods are copied onto
 *   ApiService.prototype below, so `this.api` is always the single shared instance.
 * - Two areas defining the same method name is an error at load time (never silently overwritten).
 * - Guard: src/client/src/__tests__/services/apiService.split.test.ts (method list fixture,
 *   one axios instance, sample verb + URL per area).
 */
import { ApiBase } from './apiAreas/http';
import { AuthApi } from './apiAreas/auth';
import { BillingApi } from './apiAreas/billing';
import { ProjectsApi } from './apiAreas/projects';
import { SchedulesApi } from './apiAreas/schedules';
import { SchedulingApi } from './apiAreas/scheduling';
import { AgileApi } from './apiAreas/agile';
import { ResourcesApi } from './apiAreas/resources';
import { RaidApi } from './apiAreas/raid';
import { MeetingsApi } from './apiAreas/meetings';
import { AiApi } from './apiAreas/ai';
import { ReportsApi } from './apiAreas/reports';
import { WorkflowsApi } from './apiAreas/workflows';
import { IntegrationsApi } from './apiAreas/integrations';
import { AdminApi } from './apiAreas/admin';
import { MiscApi } from './apiAreas/misc';

export type { RescheduledTask } from './apiAreas/schedules';
export type { ProjectSponsor } from './apiAreas/raid';
export type {
  CompanyHoliday,
  WorkingCalendarData,
  WorkingCalendarChange,
  CompanyHolidayChange,
  CalendarChangePreview,
} from './apiAreas/scheduling';
export type { RateCardEntry, RateInput } from './apiAreas/resources';

/** Every area, in the order their methods appeared in the original single-file ApiService. */
export const API_AREAS = [
  AuthApi,
  BillingApi,
  ProjectsApi,
  SchedulesApi,
  SchedulingApi,
  AgileApi,
  ResourcesApi,
  RaidApi,
  MeetingsApi,
  AiApi,
  ReportsApi,
  WorkflowsApi,
  IntegrationsApi,
  AdminApi,
  MiscApi,
] as const;

// Type side: ApiService has every area's methods (declaration merging with the class below).
interface ApiService
  extends AuthApi,
    BillingApi,
    ProjectsApi,
    SchedulesApi,
    SchedulingApi,
    AgileApi,
    ResourcesApi,
    RaidApi,
    MeetingsApi,
    AiApi,
    ReportsApi,
    WorkflowsApi,
    IntegrationsApi,
    AdminApi,
    MiscApi {}

// Runtime side: ApiBase's constructor creates the one axios instance; area methods are copied on.
class ApiService extends ApiBase {}

for (const area of API_AREAS) {
  for (const name of Object.getOwnPropertyNames(area.prototype)) {
    if (name === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(ApiService.prototype, name)) {
      throw new Error(`apiService: method "${name}" is defined in more than one API area`);
    }
    Object.defineProperty(ApiService.prototype, name, Object.getOwnPropertyDescriptor(area.prototype, name)!);
  }
}

export const apiService = new ApiService();
