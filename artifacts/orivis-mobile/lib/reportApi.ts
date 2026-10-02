import { getListReportsQueryKey, getReportPhoto, type CommunityReport } from '@workspace/api-client-react';
import type { SafetyReport } from '@/context/DemoContext';

export function reportAccountScope(account: { role: string; username: string }) {
  return `${account.role}:${account.username.trim().toLowerCase()}`;
}

export function reportListQueryKey(scope: string) {
  return [...getListReportsQueryKey(), 'account', scope] as const;
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
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
}