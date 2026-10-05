import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getGetTrackingProfileQueryKey,
  getListReportsQueryKey,
  getReportPhoto,
  setAuthTokenGetter,
  type CommunityReport,
  type ReportSession,
} from '@workspace/api-client-react';
import type { SafetyReport } from '@/context/DemoContext';

const SESSION_KEY = 'orivis-report-session';

export function reportAccountScope(account: { role: string; username: string }) {
  return `${account.role}:${account.username.trim().toLowerCase()}`;
}

export function reportListQueryKey(scope: string) {
  return [...getListReportsQueryKey(), 'account', scope] as const;
}

export function trackingProfileQueryKey(account: { role: string; username: string } | null | undefined) {
  return [
    ...getGetTrackingProfileQueryKey(),
    'account',
    account ? reportAccountScope(account) : 'signed-out',
  ] as const;
}

// These prototype sessions share role demo identities; they are not secure personal accounts.
setAuthTokenGetter(async () => {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as ReportSession;
    if (new Date(session.expiresAt).getTime() > Date.now()) return session.accessToken;
  } catch {
    // Treat a damaged session as signed out.
  }
  await AsyncStorage.removeItem(SESSION_KEY);
  return null;
});

export async function saveReportSession(session: ReportSession) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearReportSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function hasReportSession(role: 'parent' | 'child' | 'manager' | 'worker') {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw) as ReportSession;
    return session.role === role && new Date(session.expiresAt).getTime() > Date.now();
  } catch {
    return false;
  }
}

export function toSafetyReport(report: CommunityReport): SafetyReport {
  const base = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
  return {
    ...report,
    photoUri: report.photoUri ? `${base}${report.photoUri}` : undefined,
    assignedTeam: report.assignedTeam ?? undefined,
  };
}

export async function loadReportPhotoDataUri(id: string): Promise<string> {
  const blob = await getReportPhoto(id);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The report photo could not be displayed.'));
    };
    reader.onerror = () => reject(new Error('The report photo could not be loaded.'));
    reader.readAsDataURL(blob);
  });
}

export function reportError(error: unknown): string {
  if (error instanceof Error && 'data' in error) {
    const data = (error as Error & { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return error instanceof Error ? error.message : 'The report could not be saved. Please try again.';
}