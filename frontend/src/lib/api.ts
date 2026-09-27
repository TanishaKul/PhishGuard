import {
  AnalyticsData,
  ApiHealth,
  FeedbackLabel,
  ModelReport,
  ScanHistoryItem,
  ScanResult,
} from './types';

// Scoring, explanations and metrics all come from the Python API
// (api_server.py). There is deliberately no in-browser fallback: if the API is
// down, callers get an ApiError and show it instead of a made-up score.

// An empty NEXT_PUBLIC_API_URL means "same site": the web app proxies /api/*
// to the API (see API_PROXY_TARGET in next.config.ts).
const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const API_URL_KEY = 'phishguard_api_url';
const THRESHOLD_KEY = 'phishguard_threshold';
const HISTORY_LIMIT = 500;

export const SIGNED_OUT_EVENT = 'phishguard:signed-out';
export const API_URL_CHANGED_EVENT = 'phishguard:api-url-changed';
export const THRESHOLD_CHANGED_EVENT = 'phishguard:threshold-changed';

const START_API_HINT = 'Start it with: python api_server.py --port 8000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public hint?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readStorage(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode): settings just won't persist.
  }
}

export function getApiUrl(): string {
  return (readStorage(API_URL_KEY) || DEFAULT_API_URL).replace(/\/+$/, '');
}

export function setApiUrl(url: string | null) {
  const previous = readStorage(API_URL_KEY);
  const normalized = url?.replace(/\/+$/, '') || null;
  if (previous === normalized) return;
  writeStorage(API_URL_KEY, normalized);
  reportPromise = null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(API_URL_CHANGED_EVENT));
  }
}

// A user-chosen threshold from Settings; null means use the model's own.
export function getThresholdOverride(): number | null {
  const raw = readStorage(THRESHOLD_KEY);
  const value = raw === null ? NaN : Number(raw);
  return value > 0 && value < 1 ? value : null;
}

export function setThresholdOverride(threshold: number | null) {
  writeStorage(THRESHOLD_KEY, threshold === null ? null : String(threshold));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(THRESHOLD_CHANGED_EVENT));
  }
}

async function request<T>(path: string, init?: RequestInit, baseUrl = getApiUrl()): Promise<T> {
  const url = `${baseUrl}${path}`;
  let response: Response;
  try {
    // Send the session cookie; the API only accepts credentials from allowed origins.
    response = await fetch(url, { ...init, credentials: 'include' });
  } catch {
    const where = baseUrl || `${window.location.origin} (proxied)`;
    throw new ApiError(`Cannot reach the fraud-detection API at ${where}.`, 0, START_API_HINT);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body; handled below.
  }

  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    // Session expired mid-use; the app shell listens and redirects to sign-in.
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
  if (!response.ok) {
    const err = (body ?? {}) as { error?: string; hint?: string };
    throw new ApiError(
      err.error || `The API returned HTTP ${response.status}.`,
      response.status,
      err.hint
    );
  }
  if (body === null) {
    throw new ApiError(`The API returned an unreadable response from ${path}.`, response.status);
  }
  return body as T;
}

export function getHealth(): Promise<ApiHealth> {
  return request<ApiHealth>('/api/health');
}

export function testApiHealth(baseUrl: string): Promise<ApiHealth> {
  return request<ApiHealth>('/api/health', undefined, baseUrl.replace(/\/+$/, ''));
}

let reportPromise: Promise<ModelReport> | null = null;

// The report only changes when the model is retrained, so fetch it once per page load.
export function getModelReport(): Promise<ModelReport> {
  if (!reportPromise) {
    const pending = request<ModelReport>('/api/metrics').catch((err) => {
      if (reportPromise === pending) reportPromise = null;
      throw err;
    });
    reportPromise = pending;
  }
  return reportPromise;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export interface SessionUser {
  email: string;
  isAdmin: boolean;
}

export interface AdminStats {
  users: number;
  scans: number;
  fraudScans: number;
  feedback: number;
  reportedWrong: number;
  scansByDay: { date: string; count: number }[];
  model: string | null;
}

export interface AdminFeedbackItem {
  scanId: string;
  message: string;
  predicted: 'FRAUD' | 'LEGITIMATE';
  probability: number;
  correctLabel: 'fraud' | 'legit';
  wrong: boolean;
  note: string | null;
  createdAt: string;
}

export function getAdminStats(): Promise<AdminStats> {
  return request<AdminStats>('/api/admin/stats');
}

export async function getAdminFeedback(): Promise<AdminFeedbackItem[]> {
  const items: AdminFeedbackItem[] = [];
  let offset = 0;
  while (true) {
    const page = await request<{ items: AdminFeedbackItem[] }>(
      `/api/admin/feedback?limit=500&offset=${offset}`
    );
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length < 500) break;
  }
  return items;
}

export function register(email: string, password: string): Promise<SessionUser> {
  return postJson<SessionUser>('/api/auth/register', { email, password });
}

export function login(email: string, password: string): Promise<SessionUser> {
  return postJson<SessionUser>('/api/auth/login', { email, password });
}

export async function forgotPassword(email: string): Promise<string> {
  const res = await postJson<{ message: string }>('/api/auth/forgot', { email });
  return res.message;
}

export function resetPassword(token: string, password: string): Promise<SessionUser> {
  return postJson<SessionUser>('/api/auth/reset', { token, password });
}

export async function logout(): Promise<void> {
  await postJson('/api/auth/logout');
}

// The signed-in user, or null when there is no valid session.
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    return await request<SessionUser>('/api/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function scanMessage(message: string): Promise<ScanResult> {
  const threshold = getThresholdOverride();
  return postJson<ScanResult>('/api/scan', threshold === null ? { message } : { message, threshold });
}

// The signed-in user's scans, newest first, from the API's database.
export async function getScanHistory(): Promise<ScanHistoryItem[]> {
  const items: ScanHistoryItem[] = [];
  let offset = 0;
  let total = 0;
  do {
    const page = await request<{ total: number; items: ScanHistoryItem[] }>(
      `/api/history?limit=${HISTORY_LIMIT}&offset=${offset}`
    );
    total = page.total;
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length === 0) break;
  } while (offset < total);
  return items;
}

// Scan ids look like "scan-12"; the API routes use the number.
function scanNumber(scanId: string): string {
  return encodeURIComponent(scanId.replace(/^scan-/, ''));
}

export async function sendFeedback(scanId: string, correctLabel: FeedbackLabel): Promise<void> {
  await postJson(`/api/scans/${scanNumber(scanId)}/feedback`, { correctLabel });
}

export async function removeFeedback(scanId: string): Promise<void> {
  await request(`/api/scans/${scanNumber(scanId)}/feedback`, { method: 'DELETE' });
}

export async function clearScanHistory(): Promise<number> {
  const res = await request<{ deleted: number }>('/api/history', { method: 'DELETE' });
  return res.deleted;
}

const CATEGORY_LABELS: Record<string, { name: string; color: string }> = {
  account_threat: { name: 'Account / Security Threat', color: '#ef4444' },
  reward_scam: { name: 'Prize & Reward Bait', color: '#f59e0b' },
  urgency: { name: 'Urgency & Coercion', color: '#f97316' },
  financial: { name: 'Financial & Payment', color: '#8b5cf6' },
  action_request: { name: 'Call-to-Action', color: '#06b6d4' },
  entity_url: { name: 'Contains Link', color: '#ec4899' },
  entity_shortcode: { name: 'Shortcode', color: '#14b8a6' },
  entity_phone: { name: 'Phone Number', color: '#84cc16' },
  entity_currency: { name: 'Currency', color: '#eab308' },
  entity_email: { name: 'Email Address', color: '#64748b' },
  exclamation: { name: 'Exclamation Density', color: '#a855f7' },
  link_risk: { name: 'Risky Link', color: '#dc2626' },
};

// API timestamps are ISO-8601 in IST (+05:30); always render them in IST.
export const IST_TIME_ZONE = 'Asia/Kolkata';

export function formatTimestamp(timestamp: string, style: 'datetime' | 'time' = 'datetime'): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return style === 'time'
    ? date.toLocaleTimeString('en-IN', { timeZone: IST_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : date.toLocaleString('en-IN', { timeZone: IST_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const istDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dayKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10);
  return istDayFormatter.format(date);
}

const istHourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TIME_ZONE,
  hour: '2-digit',
  hour12: false,
});

function istHour(date: Date): number {
  return Number(istHourFormatter.format(date)) % 24;
}

function istToday(): Date {
  // Wall-clock date in IST as a local Date for day iteration.
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '01';
  return new Date(Number(get('year')), Number(get('month')) - 1, Number(get('day')));
}

// Aggregates computed from the user's scan history — nothing here is sample data.
export function getAnalyticsData(history: ScanHistoryItem[]): AnalyticsData {
  const fraud = history.filter((h) => h.prediction === 'FRAUD');

  const today = istToday();
  const timeline = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const day = history.filter((h) => dayKey(h.timestamp) === key);
    const dayFraud = day.filter((h) => h.prediction === 'FRAUD').length;
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      scans: day.length,
      fraud: dayFraud,
      legit: day.length - dayFraud,
      avgRisk: day.length
        ? Number((day.reduce((sum, h) => sum + h.riskScore, 0) / day.length).toFixed(1))
        : 0,
    };
  });

  const categoryCounts = new Map<string, number>();
  for (const item of fraud) {
    for (const category of new Set(item.detectedCategories)) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
  }
  const categoryBreakdown = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      name: CATEGORY_LABELS[category]?.name || category,
      count,
      color: CATEGORY_LABELS[category]?.color || '#64748b',
    }));

  const buckets = [
    { range: '0-10%', min: 0, max: 10 },
    { range: '10-40%', min: 10, max: 40 },
    { range: '40-70%', min: 40, max: 70 },
    { range: '70-90%', min: 70, max: 90 },
    { range: '90-100%', min: 90, max: 100.01 },
  ];
  const riskDistribution = buckets.map((b) => {
    const count = history.filter((h) => h.riskScore >= b.min && h.riskScore < b.max).length;
    return {
      range: b.range,
      count,
      percentage: history.length ? Number(((count / history.length) * 100).toFixed(1)) : 0,
      isHighRisk: b.min >= 70,
    };
  });

  const hourlyActivity = Array.from({ length: 8 }, (_, i) => {
    const inSlot = history.filter((h) => {
      const date = new Date(h.timestamp);
      return !Number.isNaN(date.getTime()) && Math.floor(istHour(date) / 3) === i;
    });
    return {
      hour: `${String(i * 3).padStart(2, '0')}:00`,
      count: inSlot.length,
      threats: inSlot.filter((h) => h.prediction === 'FRAUD').length,
    };
  });

  const signalCounts = new Map<string, { count: number; fraud: number }>();
  for (const item of history) {
    for (const category of new Set(item.detectedCategories)) {
      const entry = signalCounts.get(category) || { count: 0, fraud: 0 };
      entry.count += 1;
      if (item.prediction === 'FRAUD') entry.fraud += 1;
      signalCounts.set(category, entry);
    }
  }
  const signalDistribution = [...signalCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([category, { count, fraud: f }]) => ({
      signal: CATEGORY_LABELS[category]?.name || category,
      count,
      fraudRate: Number(((f / count) * 100).toFixed(1)),
    }));

  return {
    totalScans: history.length,
    fraudCount: fraud.length,
    legitCount: history.length - fraud.length,
    highRiskCount: history.filter((h) => h.riskLevel === 'HIGH').length,
    mediumRiskCount: history.filter((h) => h.riskLevel === 'MEDIUM').length,
    lowRiskCount: history.filter((h) => h.riskLevel === 'LOW').length,
    timeline,
    categoryBreakdown,
    riskDistribution,
    hourlyActivity,
    signalDistribution,
  };
}
