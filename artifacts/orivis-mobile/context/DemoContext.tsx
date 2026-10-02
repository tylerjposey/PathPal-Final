import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createReport as submitCommunityReport,
  getListReportsQueryKey,
  updateReport as saveCommunityReport,
  useListReports,
  type CommunityReportInput,
  type CommunityReportUpdate,
  type ReportSession,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  reportAccountScope,
  reportListQueryKey,
  toSafetyReport,
} from '@/lib/reportApi';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Role = 'parent' | 'child' | 'manager' | 'worker';
export type ReportCategory =
  | 'Blight'
  | 'Illegal dumping'
  | 'Unsafe bus stops'
  | 'Damaged sidewalks'
  | 'Poor lighting'
  | 'Suspicious activity'
  | 'Other concerns';
export type CaseStatus = 'Submitted' | 'Under Review' | 'Assigned' | 'Resolved';

export interface SelectedJourneyLeg {
  type: 'walk' | 'bus';
  routeNumber: string | null;
  routeName: string | null;
  boardingStop: { name: string };
  alightingStop: { name: string };
  durationMinutes: number;
  delayMinutes: number | null;
  transferGuidance: string | null;
}

export interface SelectedJourney {
  id: string;
  name: string;
  startStop: string;
  destinationStop: string;
  destination: string;
  startingLocation?: string;
  originLatitude?: number;
  originLongitude?: number;
  destinationLatitude?: number;
  destinationLongitude?: number;
  durationMinutes: number;
  walkingMeters: number;
  transfers: number;
  delayMinutes: number;
  alerts: string[];
  source: 'live' | 'demo';
  mode: 'walking' | 'transit';
  legs: SelectedJourneyLeg[];
}

export type MilestoneKind = 'walk-start' | 'board' | 'alight' | 'transfer-walk' | 'arrive';

export interface JourneyMilestone {
  key: string;
  title: string;
  subtitle: string;
  kind: MilestoneKind;
  delayMinutes: number | null;
}

/**
 * Turns a saved journey's actual legs into an ordered list of confirmable
 * milestones. Walking-only journeys collapse to two steps; multi-bus journeys
 * surface every boarding, alighting, and connecting walk in order, so a
 * missed transfer can't be skipped over.
 */
export function buildJourneyMilestones(journey: SelectedJourney): JourneyMilestone[] {
  // Defensive: journeys persisted by an older build of the app predate the
  // `mode`/`legs` fields, so treat a missing/malformed legs array as absent
  // rather than throwing.
  const legs = Array.isArray(journey.legs) ? journey.legs : [];
  if (journey.mode === 'walking' || !legs.length) {
    return [
      { key: 'walk-start', title: 'Started Walking', subtitle: journey.startStop, kind: 'walk-start', delayMinutes: null },
      { key: 'walk-end', title: 'Reached Destination', subtitle: journey.destinationStop, kind: 'arrive', delayMinutes: null },
    ];
  }
  const milestones: JourneyMilestone[] = [];
  legs.forEach((leg, index) => {
    const isLastLeg = index === legs.length - 1;
    if (leg.type === 'walk') {
      milestones.push({
        key: `leg-${index}-walk`,
        title: index === 0 && !isLastLeg ? 'Started walking to the stop' : isLastLeg ? 'Reached destination' : 'Walking to next stop',
        subtitle: `${leg.boardingStop.name} to ${leg.alightingStop.name}`,
        kind: isLastLeg ? 'arrive' : 'transfer-walk',
        delayMinutes: null,
      });
    } else {
      const label = leg.routeNumber ? `Route ${leg.routeNumber}` : leg.routeName ?? 'the bus';
      milestones.push({
        key: `leg-${index}-board`,
        title: `Boarded ${label}`,
        subtitle: `at ${leg.boardingStop.name}`,
        kind: 'board',
        delayMinutes: leg.delayMinutes,
      });
      milestones.push({
        key: `leg-${index}-alight`,
        title: `Got off ${label}`,
        subtitle: `at ${leg.alightingStop.name}`,
        kind: 'alight',
        delayMinutes: leg.delayMinutes,
      });
    }
  });
  if (legs[legs.length - 1]?.type === 'bus') {
    milestones.push({ key: 'arrived', title: 'Reached destination', subtitle: journey.destinationStop, kind: 'arrive', delayMinutes: null });
  }
  return milestones;
}

export function journeyMilestoneActionLabel(milestone: JourneyMilestone): string {
  switch (milestone.kind) {
    case 'walk-start':
      return 'I started walking';
    case 'board':
      return `I boarded ${milestone.title.replace('Boarded ', '')}`;
    case 'alight':
      return `I got off ${milestone.title.replace('Got off ', '')}`;
    case 'transfer-walk':
      return "I'm walking to the next stop";
    case 'arrive':
      return 'I reached my destination';
  }
}

/** A default illustrative route so the dashboard has milestones before any real journey is saved. */
export const DEFAULT_DEMO_JOURNEY: SelectedJourney = {
  id: 'default-demo-journey',
  name: 'VTA Route 22',
  startStop: 'Willow St & Bird Ave',
  destinationStop: 'Bird Ave & Minnesota',
  destination: 'River Glen Elementary, San Jose, CA',
  durationMinutes: 30,
  walkingMeters: 350,
  transfers: 0,
  delayMinutes: 0,
  alerts: [],
  source: 'demo',
  mode: 'transit',
  legs: [
    {
      type: 'bus',
      routeNumber: '22',
      routeName: 'VTA Route 22',
      boardingStop: { name: 'Willow St & Bird Ave' },
      alightingStop: { name: 'Bird Ave & Minnesota' },
      durationMinutes: 30,
      delayMinutes: null,
      transferGuidance: null,
    },
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  parent: 'Parent',
  child: 'Child',
  manager: 'City Case Manager',
  worker: 'City Worker',
};

export const REPORT_CATEGORIES: ReportCategory[] = [
  'Blight',
  'Illegal dumping',
  'Unsafe bus stops',
  'Damaged sidewalks',
  'Poor lighting',
  'Suspicious activity',
  'Other concerns',
];

export const MAP_LOCATIONS = [
  { name: 'Downtown San Jose', x: 48, y: 43 },
  { name: 'Japantown', x: 35, y: 25 },
  { name: 'Willow Glen', x: 29, y: 69 },
  { name: 'East San Jose', x: 76, y: 58 },
  { name: 'Alum Rock', x: 79, y: 27 },
  { name: 'Santa Clara', x: 17, y: 45 },
];

export interface DemoUser {
  name: string;
  username: string;
  role: Role;
  reportServiceUnavailable?: boolean;
  reportServiceError?: string;
}

export interface PendingSignUp {
  role: 'parent' | 'child';
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  familyCode: string;
}

export interface ChildProfile {
  name: string;
  school: string;
}

export interface FamilyChildProfile extends ChildProfile {
  id: string;
}

export interface ParentProfile {
  name: string;
  email: string;
  phone: string;
}

export interface NotificationPreferences {
  journeyUpdates: boolean;
  safetyAlerts: boolean;
  communityUpdates: boolean;
  rewardUpdates: boolean;
}

export interface SafetyReport {
  id: string;
  category: ReportCategory;
  summary: string;
  description: string;
  severity: number;
  status: CaseStatus;
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  selectedCategory?: ReportCategory | null;
  managerNotes?: string | null;
  routeAssignment?: string | null;
  updatedAt?: string;
  assignedAt?: string | null;
  resolvedAt?: string | null;
  photoReference?: string;
  reporterAccountId?: string | null;
  familyAccountId?: string | null;
  x: number;
  y: number;
  photoUri?: string;
  submittedAt: string;
  recommendedDepartment: string;
  priority: 'Low' | 'Medium' | 'High';
  assignedTeam?: string;
  awardedPoints: boolean;
}

export interface DemoNotification {
  id: string;
  title: string;
  body: string;
  kind: 'Safety' | 'Transit' | 'SOS' | 'Reward' | 'Case';
  createdAt: string;
  channel?: 'In-app' | 'Simulated text';
  unread: boolean;
}

export interface SOSMessage {
  id: string;
  sender: 'child' | 'guide';
  text: string;
  createdAt: string;
}

export interface SOSEvent {
  id: string;
  location: string;
  time: string;
  situation: string;
  status: 'Active' | 'Ended';
  triggers: string[];
  sharedMessages: string[];
}

export interface DemoState {
  account: DemoUser | null;
  familyName: string;
  parentProfile: ParentProfile;
  child: ChildProfile;
  familyChildren: FamilyChildProfile[];
  invitationCode: string;
  childLogin: { username: string; password: string } | null;
  notificationPreferences: NotificationPreferences;
  /** -1 means no milestone confirmed yet for the currently selected journey. */
  milestoneIndex: number;
  tripUpdatedAt: string | null;
  selectedJourney: SelectedJourney | null;
  busDelayed: boolean;
  rewardPoints: number;
  rewardHistory: string[];
  reports: SafetyReport[];
  legacyReportsByAccount: Record<string, SafetyReport[]>;
  reportScopeKey: string | null;
  notifications: DemoNotification[];
  sosActive: boolean;
  sosTriggers: string[];
  sosMessages: SOSMessage[];
  sosEvents: SOSEvent[];
}

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export function createInitialDemoState(): DemoState {
  return {
    account: null,
    familyName: '',
    parentProfile: { name: '', email: '', phone: '' },
    child: { name: '', school: '' },
    familyChildren: [],
    invitationCode: '',
    childLogin: null,
    notificationPreferences: {
      journeyUpdates: true,
      safetyAlerts: true,
      communityUpdates: true,
      rewardUpdates: true,
    },
    milestoneIndex: -1,
    tripUpdatedAt: null,
    selectedJourney: null,
    busDelayed: true,
    rewardPoints: 320,
    rewardHistory: [],
    reports: [],
    legacyReportsByAccount: {},
    reportScopeKey: null,
    notifications: [],
    sosActive: false,
    sosTriggers: [],
    sosMessages: [],
    sosEvents: [],
  };
}

const SAMPLE_REPORT_IDS = new Set<string>();

function legacyReportsFrom(reports: SafetyReport[]) {
  return reports.filter((report) =>
    !SAMPLE_REPORT_IDS.has(report.id) &&
    !report.reporterAccountId &&
    !report.familyAccountId,
  );
}

function uniqueReports(reports: SafetyReport[]) {
  return [...new Map(reports.map((report) => [report.id, report])).values()];
}

function visibleReports(serverReports: SafetyReport[], legacyReports: SafetyReport[]) {
  const merged = new Map<string, SafetyReport>();
  for (const report of legacyReportsFrom(legacyReports)) if (!merged.has(report.id)) merged.set(report.id, report);
  for (const report of serverReports) merged.set(report.id, report);
  return [...merged.values()].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

const STORAGE_KEY = 'orivis-demo-v1';

function privateDataFree(state: DemoState): DemoState {
  return {
    ...state,
    account: null,
    familyName: '',
    parentProfile: { name: '', email: '', phone: '' },
    child: { name: '', school: '' },
    familyChildren: [],
    invitationCode: '',
    childLogin: null,
    reports: [],
    legacyReportsByAccount: {},
    reportScopeKey: null,
    notifications: [],
    notificationPreferences: {
      journeyUpdates: true,
      safetyAlerts: true,
      communityUpdates: true,
      rewardUpdates: true,
    },
    milestoneIndex: -1,
    tripUpdatedAt: null,
    selectedJourney: null,
    busDelayed: false,
    rewardPoints: 320,
    rewardHistory: [],
    sosActive: false,
    sosTriggers: [],
    sosMessages: [],
    sosEvents: [],
  };
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function notification(
  title: string,
  body: string,
  kind: DemoNotification['kind'],
  channel: DemoNotification['channel'] = 'In-app',
): DemoNotification {
  return {
    id: newId('notice'),
    title,
    body,
    kind,
    createdAt: new Date().toISOString(),
    channel,
    unread: true,
  };
}

interface DemoContextValue {
  state: DemoState;
  hydrated: boolean;
  reportsError: boolean;
  reportsLoading: boolean;
  demoSession: ReportSession | null;
  pendingSignUp: PendingSignUp | null;
  saveParentProfile: (profile: ParentProfile) => Promise<void>;
  saveChildProfile: (id: string, profile: ChildProfile) => Promise<void>;
  saveFamilySettings: (settings: { familyName: string; invitationCode: string }) => Promise<void>;
  saveNotificationPreferences: (preferences: NotificationPreferences) => Promise<void>;
  setAccount: (account: DemoUser | null) => void;
  setDemoSession: (session: ReportSession) => void;
  clearDemoSession: () => void;
  setDemoAccount: (account: DemoUser | null) => void;
  setPendingSignUp: (draft: PendingSignUp | null) => void;
  clearPendingSignUp: () => void;
  signOut: () => void;
  clearUserScopedState: () => void;
  resetDemo: () => Promise<void>;
  confirmMilestone: (index: number) => void;
  selectJourney: (journey: SelectedJourney) => void;
  syncSharedJourney: (journey: SelectedJourney | null, milestoneIndex: number, tripUpdatedAt: string | null) => void;
  simulateMissedCheckin: () => void;
  reportBusDelay: () => void;
  createReport: (input: {
    description: string;
    location: string;
    photoBase64?: string;
    contentType?: 'image/jpeg' | 'image/png' | 'image/webp';
    category?: ReportCategory;
    latitude: number;
    longitude: number;
  }) => Promise<void>;
  updateManagerReport: (id: string, changes: Partial<Pick<SafetyReport, 'category' | 'description' | 'severity' | 'status' | 'location' | 'managerNotes' | 'routeAssignment'>>) => Promise<void>;
  assignReports: (ids: string[], team: string) => Promise<void>;
  updateWorkerStatus: (id: string, status: CaseStatus) => Promise<void>;
  redeemReward: (rewardName: string, cost: number) => boolean;
  markNotificationsRead: () => void;
  activateSOS: () => void;
  setSOSSignal: (signal: string) => void;
  sendSOSMessage: (text: string) => void;
  endSOS: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(createInitialDemoState);
  const [hydrated, setHydrated] = useState(false);
  const [demoSession, setDemoSessionState] = useState<ReportSession | null>(null);
  const [pendingSignUp, setPendingSignUpState] = useState<PendingSignUp | null>(null);
  const queryClient = useQueryClient();
  const activeReportScope = state.account ? reportAccountScope(state.account) : 'anonymous';
  const reportsQuery = useListReports({
    query: {
      queryKey: reportListQueryKey(activeReportScope),
      enabled: hydrated && Boolean(state.account) && !state.account?.reportServiceUnavailable,
      refetchInterval: 30_000,
      staleTime: 5_000,
    },
  });

  useEffect(() => {
    if (!reportsQuery.isSuccess || reportsQuery.isError || !reportsQuery.data || !hydrated || !state.account || state.account.reportServiceUnavailable) return;
    const scope = reportAccountScope(state.account);
    if (reportsQuery.queryKey[1] !== 'account' || reportsQuery.queryKey[2] !== scope) return;
    const serverReports = reportsQuery.data.map(toSafetyReport);
    setState((current) => {
      if (!current.account || reportAccountScope(current.account) !== scope) return current;
      const buckets = { ...current.legacyReportsByAccount };
      const legacy = uniqueReports([
        ...legacyReportsFrom(buckets[scope] ?? []),
        ...(current.reportScopeKey === scope ? legacyReportsFrom(current.reports) : []),
      ]);
      buckets[scope] = legacy;
      const reports = visibleReports(serverReports, legacy);
      if (JSON.stringify(current.reports) === JSON.stringify(reports) && JSON.stringify(current.legacyReportsByAccount) === JSON.stringify(buckets)) return current;
      const next = { ...current, reports, legacyReportsByAccount: buckets, reportScopeKey: scope };
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(privateDataFree(next)));
      return next;
    });
  }, [reportsQuery.data, reportsQuery.isSuccess, reportsQuery.isError, reportsQuery.queryKey, hydrated, state.account]);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!mounted) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<DemoState>;
            const initial = createInitialDemoState();
            const saved = privateDataFree({ ...initial, ...parsed });
            saved.account = null;
            saved.familyName = '';
            saved.parentProfile = { name: '', email: '', phone: '' };
            saved.child = { name: '', school: '' };
            saved.familyChildren = [];
            saved.invitationCode = '';
            saved.childLogin = null;
            saved.notificationPreferences = {
              ...initial.notificationPreferences,
              ...parsed.notificationPreferences,
            };
            // Journeys saved before route legs/milestones existed lack `mode`/`legs`.
            // Drop them rather than let a stale shape crash milestone rendering; the
            // family can pick a fresh route, and check-in progress resets with it.
            if (saved.selectedJourney && (!Array.isArray(saved.selectedJourney.legs) || !saved.selectedJourney.mode)) {
              saved.selectedJourney = null;
              saved.milestoneIndex = -1;
            }
            if (mounted) {
              setState(saved);
              void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(privateDataFree(saved)));
            }
          } catch {
            setState(createInitialDemoState());
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const update = useCallback((recipe: (current: DemoState) => DemoState) => {
    setState((current) => {
      let next = recipe(current);
      const existingNotificationIds = new Set(current.notifications.map((notice) => notice.id));
      const permittedKind = (kind: DemoNotification['kind']) => {
        if (kind === 'Transit') return current.notificationPreferences.journeyUpdates;
        if (kind === 'Safety' || kind === 'SOS') return current.notificationPreferences.safetyAlerts;
        if (kind === 'Case') return current.notificationPreferences.communityUpdates;
        return current.notificationPreferences.rewardUpdates;
      };
      const notifications = next.notifications.filter((notice) =>
        existingNotificationIds.has(notice.id) || permittedKind(notice.kind),
      );
      if (notifications.length !== next.notifications.length) {
        next = { ...next, notifications };
      }
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(privateDataFree(next))).catch(() => undefined);
      return next;
    });
  }, []);

  const persistUpdate = useCallback(async (recipe: (current: DemoState) => DemoState) => {
    const next = recipe(state);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(privateDataFree(next)));
    setState(next);
  }, [state]);

  const saveParentProfile = useCallback((profile: ParentProfile) => persistUpdate((current) => {
    const parentProfile = {
      name: profile.name.trim(),
      email: profile.email.trim(),
      phone: profile.phone.trim(),
    };
    return {
      ...current,
      parentProfile,
      account: current.account?.role === 'parent'
        ? { ...current.account, name: parentProfile.name }
        : current.account,
    };
  }), [persistUpdate]);

  const saveChildProfile = useCallback((id: string, profile: ChildProfile) => persistUpdate((current) => {
    const familyChildren = current.familyChildren.map((child) =>
      child.id === id
        ? { ...child, name: profile.name.trim(), school: profile.school.trim() }
        : child,
    );
    const isPrimaryChild = current.familyChildren[0]?.id === id;
    const child = isPrimaryChild
      ? { name: profile.name.trim(), school: profile.school.trim() }
      : current.child;
    return {
      ...current,
      familyChildren,
      child,
      account: isPrimaryChild && current.account?.role === 'child'
        ? { ...current.account, name: child.name }
        : current.account,
    };
  }), [persistUpdate]);

  const saveFamilySettings = useCallback((settings: { familyName: string; invitationCode: string }) =>
    persistUpdate((current) => ({
      ...current,
      familyName: settings.familyName.trim(),
      invitationCode: settings.invitationCode.trim(),
    })),
  [persistUpdate]);

  const saveNotificationPreferences = useCallback((preferences: NotificationPreferences) =>
    persistUpdate((current) => ({
      ...current,
      notificationPreferences: preferences,
    })),
  [persistUpdate]);

  const clearUserScopedState = useCallback(() => {
    setState((current) => {
      const cleared = privateDataFree(current);
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleared)).catch(() => undefined);
      return cleared;
    });
  }, []);

  const setDemoSession = useCallback((session: ReportSession) => {
    queryClient.clear();
    setState(privateDataFree(createInitialDemoState()));
    setPendingSignUpState(null);
    setDemoSessionState(session);
  }, [queryClient]);

  const clearDemoSession = useCallback(() => {
    setDemoSessionState(null);
  }, []);

  const setDemoAccount = useCallback((account: DemoUser | null) => {
    setState((current) => ({ ...privateDataFree(current), account }));
  }, []);

  const setPendingSignUp = useCallback((draft: PendingSignUp | null) => {
    setPendingSignUpState(draft);
  }, []);

  const clearPendingSignUp = useCallback(() => {
    setPendingSignUpState(null);
  }, []);

  const setAccount = useCallback((_account: DemoUser | null) => {
    clearUserScopedState();
  }, [clearUserScopedState]);

  const signOut = useCallback(() => {
    clearUserScopedState();
    clearDemoSession();
    clearPendingSignUp();
  }, [clearUserScopedState, clearDemoSession, clearPendingSignUp]);

  const resetDemo = useCallback(async () => {
    const next = privateDataFree(createInitialDemoState());
    setState(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(privateDataFree(next)));
  }, []);

  const confirmMilestone = useCallback((index: number) => {
    update((current) => {
      if (current.account?.role !== 'child') return current;
      const journey = current.selectedJourney ?? DEFAULT_DEMO_JOURNEY;
      const milestones = buildJourneyMilestones(journey);
      if (index !== current.milestoneIndex + 1 || index < 0 || index >= milestones.length) return current;
      const milestone = milestones[index];
      const delayNote = milestone.delayMinutes ? ` A ${milestone.delayMinutes} minute delay was reported.` : '';
      const detail = `${milestone.title.toLowerCase()} ${milestone.subtitle}.${delayNote}`;
      return {
        ...current,
        milestoneIndex: index,
        tripUpdatedAt: new Date().toISOString(),
        notifications: [
          notification(`${current.child.name} checked in · simulated text`, `${current.child.name} ${detail} No text was actually sent.`, 'Transit', 'Simulated text'),
          notification(`${current.child.name} checked in`, `${current.child.name} ${detail} (simulated family alert).`, 'Transit'),
          ...current.notifications,
        ],
      };
    });
  }, [update]);

  const selectJourney = useCallback((journey: SelectedJourney) => {
    update((current) => ({
      ...current,
      selectedJourney: journey,
      milestoneIndex: -1,
      busDelayed: false,
      tripUpdatedAt: new Date().toISOString(),
      notifications: [
        notification('Journey selected', `${current.child.name} selected ${journey.name} from ${journey.startStop} to ${journey.destinationStop}.`, 'Transit'),
        ...current.notifications,
      ],
    }));
  }, [update]);

  const syncSharedJourney = useCallback((
    journey: SelectedJourney | null,
    milestoneIndex: number,
    tripUpdatedAt: string | null,
  ) => {
    update((current) => ({
      ...current,
      selectedJourney: journey,
      milestoneIndex,
      tripUpdatedAt,
      busDelayed: false,
    }));
  }, [update]);

  const simulateMissedCheckin = useCallback(() => {
    update((current) => ({
      ...current,
      notifications: [
        notification('Missed bus check-in · simulated text', `${current.child.name} has not confirmed the next trip step. Demo message only.`, 'Transit', 'Simulated text'),
        notification('Missed bus check-in', `${current.child.name} has not confirmed the next trip step. Please check in with them.`, 'Transit'),
        ...current.notifications,
      ],
    }));
  }, [update]);

  const reportBusDelay = useCallback(() => {
    update((current) => ({
      ...current,
      busDelayed: true,
      notifications: [
        notification('Bus delay reported · simulated text', `A delay was reported for ${current.selectedJourney?.name ?? 'Route 22'}. No text was actually sent.`, 'Transit', 'Simulated text'),
        notification('Bus delay reported', `The family has been notified of a reported delay on ${current.selectedJourney?.name ?? 'Route 22'}.`, 'Transit'),
        ...current.notifications,
      ],
    }));
  }, [update]);

  const createReport = useCallback(async (input: {
    description: string; location: string; photoBase64?: string;
    contentType?: 'image/jpeg' | 'image/png' | 'image/webp'; category?: ReportCategory;
    latitude: number; longitude: number;
  }) => {
    const created = await submitCommunityReport({
      description: input.description.trim(),
      location: input.location as CommunityReportInput['location'],
      category: input.category,
      latitude: input.latitude,
      longitude: input.longitude,
      photoBase64: input.photoBase64,
      contentType: input.contentType,
    });
    const report = toSafetyReport(created);
    update((current) => ({
      ...current,
      reports: [report, ...current.reports],
      notifications: [
        notification('Community report received', `${report.id} is in review. The sample AI assigned ${report.category} with ${report.priority.toLowerCase()} priority.`, 'Case'),
        ...current.notifications,
      ],
    }));
    void queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
  }, [update, queryClient]);

  const applySavedReport = useCallback((result: Awaited<ReturnType<typeof saveCommunityReport>>) => {
    const report = toSafetyReport(result.report);
    update((current) => ({
      ...current,
      reports: current.reports.map((item) => item.id === report.id ? report : item),
      rewardPoints: current.rewardPoints + (result.awardedPoints ? 50 : 0),
      rewardHistory: result.awardedPoints
        ? [`+50 points · ${report.id} resolved`, ...current.rewardHistory]
        : current.rewardHistory,
      notifications: result.awardedPoints
        ? [notification('Report resolved · +50 family points', `${report.id} was verified.`, 'Reward'), ...current.notifications]
        : current.notifications,
    }));
    void queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
  }, [update, queryClient]);

  const updateManagerReport = useCallback(async (
    id: string,
    changes: Partial<Pick<SafetyReport, 'category' | 'description' | 'severity' | 'status' | 'location' | 'managerNotes' | 'routeAssignment'>>,
  ) => {
    if (state.account?.role !== 'manager') throw new Error('Only case managers can edit reports.');
    applySavedReport(await saveCommunityReport(id, changes as CommunityReportUpdate));
  }, [state.account?.role, applySavedReport]);

  const assignReports = useCallback(async (ids: string[], team: string) => {
    if (state.account?.role !== 'manager') throw new Error('Only case managers can delegate reports.');
    for (const id of ids) {
      const report = state.reports.find((item) => item.id === id);
      if (report?.status === 'Resolved') continue;
      applySavedReport(await saveCommunityReport(id, { status: 'Assigned', assignedTeam: team }));
    }
    update((current) => ({
      ...current,
      notifications: [notification('Cleanup route delegated', `Route/task delegated to ${team}.`, 'Case'), ...current.notifications],
    }));
  }, [state.account?.role, state.reports, applySavedReport, update]);

  const updateWorkerStatus = useCallback(async (id: string, status: CaseStatus) => {
    if (state.account?.role !== 'worker') throw new Error('Only assigned workers can update task status.');
    applySavedReport(await saveCommunityReport(id, { status }));
    update((current) => ({
      ...current,
      notifications: [notification('Task status updated', `${id} is now marked ${status.toLowerCase()}.`, 'Case'), ...current.notifications],
    }));
  }, [state.account?.role, applySavedReport, update]);

  const redeemReward = useCallback((rewardName: string, cost: number) => {
    let redeemed = false;
    update((current) => {
      if (current.rewardPoints < cost || !['parent', 'child'].includes(current.account?.role ?? '')) return current;
      redeemed = true;
      return {
        ...current,
        rewardPoints: current.rewardPoints - cost,
        rewardHistory: [`−${cost} points · ${rewardName}`, ...current.rewardHistory],
        notifications: [notification(`${rewardName} redeemed`, 'Your simulated partner reward is ready to show in person.', 'Reward'), ...current.notifications],
      };
    });
    return redeemed;
  }, [update]);

  const markNotificationsRead = useCallback(() => {
    update((current) => ({
      ...current,
      notifications: current.notifications.map((item) => ({ ...item, unread: false })),
    }));
  }, [update]);

  const activateSOS = useCallback(() => {
    update((current) => {
      if (current.sosActive) return current;
      const event: SOSEvent = {
        id: `SOS-${Date.now().toString().slice(-6)}`,
        location: 'Civic Center, San Jose · simulated location',
        time: new Date().toISOString(),
        situation: 'Child requested a simulated safety check. No real contact was made.',
        status: 'Active',
        triggers: [],
        sharedMessages: [],
      };
      return {
        ...current,
        sosActive: true,
        sosTriggers: [],
        sosMessages: [
          { id: newId('guide'), sender: 'guide', text: 'I’m here with you. Find a safe, well-lit place near a trusted adult. This is a demo—if you need real help, use your local emergency number or tell a trusted adult now.', createdAt: new Date().toISOString() },
        ],
        sosEvents: [event, ...current.sosEvents],
        notifications: [
          notification('SOS practice activated', `${current.child.name} started a simulated SOS. No emergency services were contacted.`, 'SOS', 'Simulated text'),
          notification('SOS practice activated', `A simulated alert for ${current.child.name} is visible in the PathPal demo.`, 'SOS'),
          ...current.notifications,
        ],
      };
    });
  }, [update]);

  const setSOSSignal = useCallback((signal: string) => {
    update((current) => {
      if (!current.sosActive) return current;
      const triggers = current.sosTriggers.includes(signal)
        ? current.sosTriggers.filter((item) => item !== signal)
        : [...current.sosTriggers, signal];
      return {
        ...current,
        sosTriggers: triggers,
        sosEvents: current.sosEvents.map((event, index) => index === 0 ? { ...event, triggers } : event),
      };
    });
  }, [update]);

  const sendSOSMessage = useCallback((text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    update((current) => {
      if (!current.sosActive) return current;
      const messages = [
        ...current.sosMessages,
        { id: newId('child'), sender: 'child' as const, text: cleanText, createdAt: new Date().toISOString() },
      ];
      const event = current.sosEvents[0];
      return {
        ...current,
        sosMessages: messages,
        sosEvents: event
          ? [{ ...event, sharedMessages: [...event.sharedMessages, cleanText] }, ...current.sosEvents.slice(1)]
          : current.sosEvents,
      };
    });
  }, [update]);

  const endSOS = useCallback(() => {
    update((current) => ({
      ...current,
      sosActive: false,
      sosEvents: current.sosEvents.map((event, index) =>
        index === 0 && event.status === 'Active'
          ? { ...event, status: 'Ended', situation: 'Child ended the simulated SOS demo.' }
          : event,
      ),
      notifications: [notification('SOS practice ended', 'The simulated safety session was closed. No real services were contacted.', 'SOS'), ...current.notifications],
    }));
  }, [update]);

  const currentQueryMatchesScope = Boolean(
    state.account &&
    reportsQuery.queryKey[1] === 'account' &&
    reportsQuery.queryKey[2] === reportAccountScope(state.account),
  );
  const authorizedReports = useMemo(() => {
    const account = state.account;
    if (!account) return [];
    const scope = reportAccountScope(account);
    const legacy = legacyReportsFrom(state.legacyReportsByAccount[scope] ?? []);
    const serverReports = reportsQuery.isSuccess &&
      !reportsQuery.isError &&
      !account.reportServiceUnavailable &&
      currentQueryMatchesScope
      ? (reportsQuery.data ?? []).map(toSafetyReport)
      : [];
    const roleScopedServerReports = account.role === 'worker'
      ? serverReports.filter((report) => report.assignedTeam === 'San Jose – West Clean Team')
      : serverReports;
    const roleScopedLegacy = account.role === 'worker'
      ? legacy.filter((report) => report.assignedTeam === 'San Jose – West Clean Team')
      : legacy;
    return visibleReports(roleScopedServerReports, roleScopedLegacy);
  }, [
    state.account,
    state.legacyReportsByAccount,
    reportsQuery.data,
    reportsQuery.isSuccess,
    reportsQuery.isError,
    currentQueryMatchesScope,
  ]);
  const visibleState = useMemo<DemoState>(() => {
    const scope = state.account ? reportAccountScope(state.account) : null;
    const currentLegacy = scope ? legacyReportsFrom(state.legacyReportsByAccount[scope] ?? []) : [];
    return {
      ...state,
      reports: authorizedReports,
      legacyReportsByAccount: scope ? { [scope]: currentLegacy } : {},
      reportScopeKey: scope,
    };
  }, [state, authorizedReports]);

  const value = useMemo<DemoContextValue>(() => ({
    state: visibleState,
    hydrated,
    reportsError: Boolean(currentQueryMatchesScope && reportsQuery.isError && !state.account?.reportServiceUnavailable),
    reportsLoading: Boolean(currentQueryMatchesScope && state.account && !state.account.reportServiceUnavailable && (reportsQuery.isPending || reportsQuery.isFetching)),
    demoSession,
    pendingSignUp,
    saveParentProfile,
    saveChildProfile,
    saveFamilySettings,
    saveNotificationPreferences,
    setAccount,
    setDemoSession,
    clearDemoSession,
    setDemoAccount,
    setPendingSignUp,
    clearPendingSignUp,
    signOut,
    clearUserScopedState,
    resetDemo,
    confirmMilestone,
    selectJourney,
    syncSharedJourney,
    simulateMissedCheckin,
    reportBusDelay,
    createReport,
    updateManagerReport,
    assignReports,
    updateWorkerStatus,
    redeemReward,
    markNotificationsRead,
    activateSOS,
    setSOSSignal,
    sendSOSMessage,
    endSOS,
  }), [
    state,
    visibleState,
    hydrated,
    demoSession,
    pendingSignUp,
    reportsQuery.isError,
    reportsQuery.isPending,
    reportsQuery.isFetching,
    currentQueryMatchesScope,
    saveParentProfile,
    saveChildProfile,
    saveFamilySettings,
    saveNotificationPreferences,
    setAccount,
    setDemoSession,
    clearDemoSession,
    setDemoAccount,
    setPendingSignUp,
    clearPendingSignUp,
    signOut,
    clearUserScopedState,
    resetDemo,
    confirmMilestone,
    selectJourney,
    syncSharedJourney,
    simulateMissedCheckin,
    reportBusDelay,
    createReport,
    updateManagerReport,
    assignReports,
    updateWorkerStatus,
    redeemReward,
    markNotificationsRead,
    activateSOS,
    setSOSSignal,
    sendSOSMessage,
    endSOS,
  ]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo must be used inside DemoProvider.');
  return context;
}

export function heatScore(report: SafetyReport, reports: SafetyReport[]) {
  const now = Date.now();
  const nearby = reports.filter((other) => Math.hypot(other.x - report.x, other.y - report.y) < 22).length;
  const ageHours = (now - new Date(report.submittedAt).getTime()) / 3_600_000;
  const recency = ageHours < 24 ? 2 : ageHours < 72 ? 1 : 0;
  const categoryWeight = ['Unsafe bus stops', 'Suspicious activity', 'Illegal dumping'].includes(report.category) ? 1.2 : 0.4;
  return report.severity + Math.max(0, nearby - 1) * 1.1 + recency + categoryWeight;
}

export function heatColor(score: number) {
  if (score >= 9) return '#D74F48';
  if (score >= 7) return '#E99A3C';
  if (score >= 5) return '#E9C94B';
  return '#3E9A82';
}