import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthTokenGetter, type CommunityReport, type ReportSession } from '@workspace/api-client-react';
import type { SafetyReport } from '@/context/DemoContext';

const SESSION_KEY = 'orivis-report-session';

// Only demo manager/worker sessions are issued by the server. Never persist passwords.
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

export async function hasReportSession(role: 'manager' | 'worker') {
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

export function reportError(error: unknown): string {
  if (error instanceof Error && 'data' in error) {
    const data = (error as Error & { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return error instanceof Error ? error.message : 'The report could not be saved. Please try again.';
}