import type { CommunityReport } from '@workspace/api-client-react';
import type { SafetyReport } from '@/context/DemoContext';

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