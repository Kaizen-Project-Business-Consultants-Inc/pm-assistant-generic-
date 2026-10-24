import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { CookieConsentBanner } from '../../components/CookieConsentBanner';
import { useAuthStore } from '../../stores/authStore';

let go: (to: string) => void;
const Nav = () => { go = useNavigate(); return null; };
const mount = (path: string) => render(
  <MemoryRouter initialEntries={[path]}><Nav /><CookieConsentBanner /></MemoryRouter>,
);
const clarityScripts = () => document.head.querySelectorAll('script[src*="clarity.ms"]').length;

describe('Clarity session replay: consent, public pages, never signed in (2026-10-24)', () => {
  const realLocation = window.location;
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    delete window.clarity;
    useAuthStore.setState({ isAuthenticated: false });
    Object.defineProperty(window, 'location', { value: { ...realLocation, hostname: 'kovarti.com' }, writable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, writable: true });
  });

  it('records nothing before the visitor answers, and nothing after Decline', () => {
    mount('/pricing');
    expect(clarityScripts()).toBe(0);
    fireEvent.click(screen.getByText('Decline'));
    expect(clarityScripts()).toBe(0);
    expect(localStorage.getItem('kovarti_analytics_consent_v2')).toBe('declined');
  });

  it('Accept on a public page loads Clarity with advertising storage denied', () => {
    mount('/pricing');
    fireEvent.click(screen.getByText('Accept'));
    expect(clarityScripts()).toBe(1);
    expect(window.clarity!.q![0]).toEqual(['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]);
  });

  it('stops when the visitor moves to the app and starts again on a public page', () => {
    localStorage.setItem('kovarti_analytics_consent_v2', 'accepted');
    mount('/pricing');
    const clarity = vi.fn();
    Object.assign(clarity, { q: [] });
    window.clarity = clarity as unknown as typeof window.clarity;
    act(() => go('/login'));
    expect(clarity).toHaveBeenCalledWith('stop');
    act(() => go('/features'));
    expect(clarity).toHaveBeenCalledWith('start');
  });

  it('never loads for a signed-in user, even on a public page', () => {
    useAuthStore.setState({ isAuthenticated: true });
    localStorage.setItem('kovarti_analytics_consent_v2', 'accepted');
    mount('/');
    expect(clarityScripts()).toBe(0);
  });

  it('someone who declined the older banner stays declined and is not asked again', () => {
    localStorage.setItem('kovarti_analytics_consent', 'declined');
    mount('/');
    expect(screen.queryByText('Accept')).toBeNull();
    expect(localStorage.getItem('kovarti_analytics_consent_v2')).toBe('declined');
    expect(clarityScripts()).toBe(0);
  });

  it('Accept clicked while signed in loads nothing', () => {
    useAuthStore.setState({ isAuthenticated: true });
    mount('/pricing');
    fireEvent.click(screen.getByText('Accept'));
    expect(clarityScripts()).toBe(0);
  });

  it('someone who accepted the older banner is asked again', () => {
    localStorage.setItem('kovarti_analytics_consent', 'accepted');
    mount('/');
    expect(screen.getByText('Accept')).toBeTruthy();
    expect(clarityScripts()).toBe(0);
  });
});
