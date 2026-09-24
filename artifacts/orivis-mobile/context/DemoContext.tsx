import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createReport as submitCommunityReport,
  getListReportsQueryKey,
  updateReport as saveCommunityReport,
  useListReports,
  type CommunityReportInput,
  type CommunityReportUpdate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useClerk } from '@clerk/expo';
import { toSafetyReport } from '@/lib/reportApi';
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
export type TripStep = 'waiting' | 'boarded' | 'off' | 'arrived';

export interface SelectedJourney {
  id: string;
  name: string;
  startStop: string;
  destinationStop: string;
  destination: string;
  durationMinutes: number;
  walkingMeters: number;
  transfers: number;
  delayMinutes: number;
  alerts: string[];
  source: 'live' | 'demo';
}

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
}

export interface ChildProfile {
  name: string;
  school: string;
}

export interface SafetyReport {
  id: string;
  category: ReportCategory;
  summary: string;
  description: string;
  severity: number;
  status: CaseStatus;
  location: string;
  x: number;
  y: number;
  photoUri?: string;
  submittedAt: string;
  updatedAt?: string;
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
  child: ChildProfile;
  invitationCode: string;
  childLogin: { username: string; password: string } | null;
  tripStep: TripStep;
  tripUpdatedAt: string | null;
  selectedJourney: SelectedJourney | null;
  busDelayed: boolean;
  rewardPoints: number;
  rewardHistory: string[];
  reports: SafetyReport[];
  notifications: DemoNotification[];
  sosActive: boolean;
  sosTriggers: string[];
  sosMessages: SOSMessage[];
  sosEvents: SOSEvent[];
}

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function makeReport(
  id: string,
  category: ReportCategory,
  description: string,
  severity: number,
  status: CaseStatus,
  location: string,
  x: number,
  y: number,
  hoursAgo: number,
  assignedTeam?: string,
): SafetyReport {
  const department = category === 'Poor lighting' || category === 'Unsafe bus stops'
    ? 'Transportation & Public Works'
    : category === 'Damaged sidewalks'
      ? 'Public Works'
      : 'Environmental Services';
  const submittedAt = ago(hoursAgo);
  return {
    id,
    category,
    summary: description,
    description,
    severity,
    status,
    location,
    x,
    y,
    submittedAt,
    updatedAt: submittedAt,
    recommendedDepartment: department,
    priority: severity >= 8 ? 'High' : severity >= 5 ? 'Medium' : 'Low',
    assignedTeam,
    awardedPoints: status === 'Resolved',
  };
}

export function createInitialDemoState(): DemoState {
  return {
    account: null,
    familyName: 'The Chen family',
    child: { name: 'Maya Chen', school: 'River Glen Elementary' },
    invitationCode: '1234',
    childLogin: null,
    tripStep: 'waiting',
    tripUpdatedAt: null,
    selectedJourney: null,
    busDelayed: true,
    rewardPoints: 320,
    rewardHistory: ['+50 points · Willow Glen sidewalk report resolved'],
    reports: [
      makeReport(
        'OR-2481',
        'Illegal dumping',
        'Several bags and loose debris beside the trail entrance.',
        9,
        'Assigned',
        'Downtown San Jose',
        49,
        42,
        7,
        'San Jose – West Clean Team',
      ),
      makeReport(
        'OR-2478',
        'Poor lighting',
        'The pedestrian crossing near the stop is very dark after sunset.',
        7,
        'Under Review',
        'Japantown',
        37,
        29,
        18,
      ),
      makeReport(
        'OR-2474',
        'Damaged sidewalks',
        'Raised pavement near the school crossing could be a trip hazard.',
        6,
        'Submitted',
        'Willow Glen',
        31,
        70,
        29,
      ),
      makeReport(
        'OR-2469',
        'Blight',
        'Litter around the park entrance has now been cleared.',
        3,
        'Resolved',
        'Alum Rock',
        78,
        26,
        75,
        'Parks Response Team',
      ),
      makeReport(
        'OR-2463',
        'Unsafe bus stops',
        'The sidewalk at the northbound stop is cracked and difficult to navigate.',
        6,
        'Assigned',
        'East San Jose',
        76,
        60,
        49,
        'San Jose – West Clean Team',
      ),
      makeReport(
        'OR-2459',
        'Other concerns',
        'A recycling bin is overflowing at the transit plaza.',
        4,
        'Submitted',
        'Santa Clara',
        18,
        47,
        92,
      ),
    ],
    notifications: [
      {
        id: 'notif-demo-sos',
        title: 'Practice SOS completed',
        body: 'A sample, simulated family safety drill was closed. No services were contacted.',
        kind: 'SOS',
        createdAt: ago(26),
        channel: 'In-app',
        unread: false,
      },
      {
        id: 'notif-bus-delay',
        title: 'Route 22 is delayed',
        body: 'A simulated 8-minute delay is posted for the River Glen stop.',
        kind: 'Transit',
        createdAt: ago(2),
        channel: 'In-app',
        unread: true,
      },
      {
        id: 'notif-reward',
        title: 'You earned 50 points',
        body: 'A family community report was verified and resolved.',
        kind: 'Reward',
        createdAt: ago(75),
        channel: 'In-app',
        unread: false,
      },
    ],
    sosActive: false,
    sosTriggers: [],
    sosMessages: [],
    sosEvents: [
      {
        id: 'SOS-DEMO-01',
        location: 'Civic Center, San Jose · demo location',
        time: ago(26),
        situation: 'Sample practice event shown for demonstration.',
        status: 'Ended',
        triggers: [],
        sharedMessages: [],
      },
    ],
  };
}

const STORAGE_KEY = 'orivis-demo-v2';

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

function analyzeDescription(description: string, selected?: ReportCategory) {
  const text = description.toLowerCase();
  const category =
    selected ||
    (text.includes('dump') || text.includes('bags') || text.includes('debris')
      ? 'Illegal dumping'
      : text.includes('light') || text.includes('dark')
        ? 'Poor lighting'
        : text.includes('sidewalk') || text.includes('crack') || text.includes('pavement')
          ? 'Damaged sidewalks'
          : text.includes('bus stop') || text.includes('transit')
            ? 'Unsafe bus stops'
            : text.includes('suspicious')
              ? 'Suspicious activity'
              : 'Other concerns');
  const alarming = /unsafe|danger|broken|dark|trip|glass|traffic|sharp/.test(text);
  const score = Math.min(10, Math.max(2, (alarming ? 7 : 4) + (description.length > 115 ? 1 : 0)));
  const recommendedDepartment =
    category === 'Poor lighting' || category === 'Unsafe bus stops'
      ? 'Transportation & Public Works'
      : category === 'Damaged sidewalks'
        ? 'Public Works'
        : 'Environmental Services';
  return {
    category,
    severity: score,
    priority: (score >= 8 ? 'High' : score >= 5 ? 'Medium' : 'Low') as SafetyReport['priority'],
    recommendedDepartment,
  };
}

interface DemoContextValue {
  state: DemoState;
  hydrated: boolean;
  reportsError: boolean;
  reportsLoading: boolean;
  verifyFamilyInvite: (code: string) => boolean;
  createFamily: (familyName: string, childName: string, inviteCode: string) => void;
  joinFamily: (code: string, childName: string, username: string, password: string) => boolean;
  setAccount: (account: DemoUser | null) => void;
  signOut: () => void;
  resetDemo: () => void;
  updateTripStep: (step: TripStep) => void;
  selectJourney: (journey: SelectedJourney) => void;
  simulateMissedCheckin: () => void;
  reportBusDelay: () => void;
  createReport: (input: {
    description: string;
    location: string;
    photoBase64?: string;
    contentType?: 'image/jpeg' | 'image/png' | 'image/webp';
    category?: ReportCategory;
  }) => Promise<void>;
  updateManagerReport: (id: string, changes: Partial<Pick<SafetyReport, 'category' | 'description' | 'severity' | 'status' | 'location'>>) => Promise<void>;
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
  const queryClient = useQueryClient();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { signOut: clerkSignOut } = useClerk();
  const storageKey = userId ? `${STORAGE_KEY}:${userId}` : null;
  const reportsQuery = useListReports({
    query: {
      queryKey: [...getListReportsQueryKey(), userId ?? 'signed-out'],
      enabled: authLoaded && hydrated && Boolean(userId),
      refetchInterval: 30_000,
      staleTime: 5_000,
    },
  });

  useEffect(() => {
    if (!reportsQuery.data || !hydrated || !userId || !storageKey) return;
    const serverReports = reportsQuery.data.map(toSafetyReport);
    const serverIds = new Set(serverReports.map((report) => report.id));
    const initialIds = new Set(createInitialDemoState().reports.map((report) => report.id));
    setState((current) => {
      // Preserve older device-only submissions until they can be resubmitted.
      const legacy = current.reports.filter((report) => !serverIds.has(report.id) && !initialIds.has(report.id));
      const reports = [...serverReports, ...legacy].sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
      );
      if (JSON.stringify(current.reports) === JSON.stringify(reports)) return current;
      const next = { ...current, reports };
      void AsyncStorage.setItem(storageKey, JSON.stringify({ ...next, account: null }));
      return next;
    });
  }, [reportsQuery.data, hydrated, userId, storageKey]);

  useEffect(() => {
    if (!authLoaded) return;
    setHydrated(false);
    setState(createInitialDemoState());
    if (!storageKey) {
      setHydrated(true);
      return;
    }
    let mounted = true;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!mounted) return;
        if (raw) {
          try {
            const saved = { ...createInitialDemoState(), ...JSON.parse(raw) as Partial<DemoState> };
            saved.account = null;
            if (mounted) setState(saved);
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
  }, [authLoaded, storageKey]);

  const update = useCallback((recipe: (current: DemoState) => DemoState) => {
    setState((current) => {
      const next = recipe(current);
      if (storageKey) {
        void AsyncStorage.setItem(storageKey, JSON.stringify({ ...next, account: null })).catch(() => undefined);
      }
      return next;
    });
  }, [storageKey]);

  const verifyFamilyInvite = useCallback(
    (code: string) => code.trim() === state.invitationCode && code.trim().length > 0,
    [state.invitationCode],
  );

  const createFamily = useCallback((familyName: string, childName: string, inviteCode: string) => {
    update((current) => ({
      ...current,
      familyName: familyName.trim() || 'The Orivis family',
      child: { ...current.child, name: childName.trim() || 'New family member' },
      invitationCode: inviteCode.trim() || '1234',
      childLogin: null,
    }));
  }, [update]);

  const joinFamily = useCallback((code: string, childName: string, username: string, password: string) => {
    if (!verifyFamilyInvite(code) || username.trim().length < 3 || password.length < 4 || !childName.trim()) {
      return false;
    }
    update((current) => ({
      ...current,
      child: { ...current.child, name: childName.trim() },
      childLogin: { username: username.trim(), password },
    }));
    return true;
  }, [update, verifyFamilyInvite]);

  const setAccount = useCallback((account: DemoUser | null) => {
    update((current) => ({ ...current, account }));
  }, [update]);

  const signOut = useCallback(() => {
    void queryClient.clear();
    void clerkSignOut();
    update((current) => ({ ...current, account: null }));
  }, [clerkSignOut, queryClient, update]);

  const resetDemo = useCallback(() => {
    const initial = { ...createInitialDemoState(), account: state.account };
    setState(initial);
    if (storageKey) {
      void AsyncStorage.setItem(storageKey, JSON.stringify({ ...initial, account: null })).catch(() => undefined);
    }
  }, [state.account, storageKey]);

  const updateTripStep = useCallback((step: TripStep) => {
    update((current) => {
      if (current.account?.role !== 'child') return current;
      const sequence: TripStep[] = ['waiting', 'boarded', 'off', 'arrived'];
      if (sequence.indexOf(step) !== sequence.indexOf(current.tripStep) + 1) return current;
      const detail: Record<TripStep, string> = {
        waiting: 'is ready at the starting stop.',
        boarded: 'confirmed boarding Route 22.',
        off: 'confirmed getting off at the destination stop.',
        arrived: 'confirmed arriving safely at school.',
      };
      return {
        ...current,
        tripStep: step,
        tripUpdatedAt: new Date().toISOString(),
        notifications: [
          notification(`${current.child.name} checked in · simulated text`, `${current.child.name} ${detail[step]} No text was actually sent.`, 'Transit', 'Simulated text'),
          notification(`${current.child.name} checked in`, `${current.child.name} ${detail[step]} (simulated family alert).`, 'Transit'),
          ...current.notifications,
        ],
      };
    });
  }, [update]);

  const selectJourney = useCallback((journey: SelectedJourney) => {
    update((current) => ({
      ...current,
      selectedJourney: journey,
      tripStep: 'waiting',
      busDelayed: false,
      tripUpdatedAt: new Date().toISOString(),
      notifications: [
        notification('Journey selected', `${current.child.name} selected ${journey.name} from ${journey.startStop} to ${journey.destinationStop}.`, 'Transit'),
        ...current.notifications,
      ],
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
  }) => {
    const created = await submitCommunityReport({
      description: input.description.trim(),
      location: input.location as CommunityReportInput['location'],
      category: input.category,
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
    changes: Partial<Pick<SafetyReport, 'category' | 'description' | 'severity' | 'status' | 'location'>>,
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
          notification('SOS practice activated', `A simulated alert for ${current.child.name} is visible in the Orivis demo.`, 'SOS'),
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

  const value = useMemo<DemoContextValue>(() => ({
    state,
    hydrated,
    reportsError: reportsQuery.isError,
    reportsLoading: reportsQuery.isPending || reportsQuery.isFetching,
    verifyFamilyInvite,
    createFamily,
    joinFamily,
    setAccount,
    signOut,
    resetDemo,
    updateTripStep,
    selectJourney,
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
    hydrated,
    reportsQuery.isError,
    reportsQuery.isPending,
    reportsQuery.isFetching,
    verifyFamilyInvite,
    createFamily,
    joinFamily,
    setAccount,
    signOut,
    resetDemo,
    updateTripStep,
    selectJourney,
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