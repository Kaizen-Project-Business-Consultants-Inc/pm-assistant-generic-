import axios, { AxiosInstance, AxiosResponse } from 'axios';

/**
 * Core HTTP layer for the client API: the ONE shared axios instance and its interceptors
 * (401 -> token refresh + retry, 403 password-change / subscription handling).
 *
 * Every area class in this folder extends ApiBase only so TypeScript knows about `this.api`;
 * the area classes are never instantiated. Their methods are copied onto ApiService (../api.ts),
 * so at runtime `this` is the single `apiService` and `this.api` is this one instance.
 */
export class ApiBase {
  protected api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: import.meta.env.DEV ? 'http://localhost:3001/api/v1' : '/api/v1',
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor
    this.api.interceptors.request.use(
      (config) => {
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.api.interceptors.response.use(
      (response: AxiosResponse) => {
        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        // Handle 401 errors (token expired) — skip for login/register requests
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          !originalRequest.url?.includes('/auth/refresh') &&
          !originalRequest.url?.includes('/auth/login') &&
          !originalRequest.url?.includes('/auth/register') &&
          !originalRequest.url?.includes('/auth/me')
        ) {
          originalRequest._retry = true;

          try {
            // Try to refresh the token (empty body ensures Content-Type is sent)
            await this.api.post('/auth/refresh', {});
            return this.api(originalRequest);
          } catch (_refreshError) {
            // Refresh failed, redirect to login
            window.location.href = '/login';
            return Promise.reject(_refreshError);
          }
        }

        // Handle 403 password-change-required errors
        if (
          error.response?.status === 403 &&
          error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED'
        ) {
          window.location.href = '/change-password';
          return Promise.reject(error);
        }

        // Handle 403 subscription-required errors. 'Payment required' is the
        // awaiting-payment case — a paid signup that never completed checkout. It is
        // not a trial and not a free account, so it gets its own message.
        if (
          error.response?.status === 403 &&
          (error.response?.data?.error === 'Subscription required' ||
            error.response?.data?.error === 'Payment required')
        ) {
          // Dispatch custom event for UI components to handle
          window.dispatchEvent(new CustomEvent('subscription-required', {
            detail: error.response.data,
          }));
        }

        return Promise.reject(error);
      }
    );
  }
}
