import { Feather } from '@expo/vector-icons';
import { useAuth, useClerk } from '@clerk/expo';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getGetAccountStatusQueryKey,
  getGetMyFamilyQueryKey,
  getGetReportMapDataQueryKey,
  getListNotificationsQueryKey,
  getListReportsQueryKey,
  setAuthTokenGetter,
  useAcceptStaffInvitation,
  useApproveFamilyJoinRequest,
  useBootstrapInitialManager,
  useCreateChildAccount,
  useCreateParentAccount,
  useCreateReport,
  useCreateStaffInvitation,
  useGetAccountStatus,
  useGetMyFamily,
  useGetReportMapData,
  useListNotifications,
  useListReports,
  useMarkNotificationRead,
  useRejectFamilyJoinRequest,
  useUpdateReport,
  type CommunityReport,
  type CommunityReportCategory,
  type CommunityReportLocation,
  type CommunityReportStatus,
  type ReportMapMarker,
} from '@workspace/api-client-react';
import { BrandMark, Button, Card, Field, ScreenHeader, SectionTitle } from '@/components/OrivisUI';
import { useColors } from '@/hooks/useColors';
import { loadReportPhotoDataUri, reportError } from '@/lib/reportApi';
import { useDemo } from '@/context/DemoContext';
import { JourneyScreen } from '@/components/JourneyScreen';
import { SimulatedSOSPanel } from '@/components/SimulatedSOSPanel';

type Page = 'overview' | 'reports' | 'map' | 'family' | 'notifications' | 'account' | 'travel';
type ReportNeighborhood = { name: CommunityReportLocation; latitude: number; longitude: number };

const neighborhoods: ReportNeighborhood[] = [
  { name: 'Downtown San Jose', latitude: 37.3382, longitude: -121.8863 },
  { name: 'Japantown', latitude: 37.3487, longitude: -121.8943 },
  { name: 'Willow Glen', latitude: 37.3032, longitude: -121.9006 },
  { name: 'East San Jose', latitude: 37.3524, longitude: -121.8278 },
  { name: 'Alum Rock', latitude: 37.3661, longitude: -121.8272 },
  { name: 'Santa Clara', latitude: 37.3541, longitude: -121.9552 },
];

const reportCategories: CommunityReportCategory[] = [
  'Blight',
  'Illegal dumping',
  'Unsafe bus stops',
  'Damaged sidewalks',
  'Poor lighting',
  'Suspicious activity',
  'Other concerns',
];

const statusOrder: CommunityReportStatus[] = ['Submitted', 'Under Review', 'Assigned', 'Resolved'];

function isAuthorizedWorkspace(status?: string) {
  return status === 'parent' || status === 'child_approved' || status === 'manager' || status === 'worker';
}

function errorMessage(error: unknown) {
  return reportError(error);
}

export function SecureWorkspace() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { userId, getToken } = useAuth();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const demo = useDemo();
  const previousUser = useRef<string | null>(null);
  const [page, setPage] = useState<Page>('overview');
  const [selectedReport, setSelectedReport] = useState<CommunityReport | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [globalError, setGlobalError] = useState('');

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    if (previousUser.current !== (userId ?? null)) {
      queryClient.clear();
      demo.clearUserScopedState();
      setPage('overview');
      setSelectedReport(null);
    }
    previousUser.current = userId ?? null;
    return () => setAuthTokenGetter(null);
  }, [getToken, userId, queryClient, demo.clearUserScopedState]);

  const accountQuery = useGetAccountStatus({
    query: { queryKey: getGetAccountStatusQueryKey(), enabled: !!userId, retry: false },
  });
  const { approveRequest, rejectRequest, markRead } = useWorkspaceActions();
  const account = accountQuery.data;
  const familyAllowed = account?.status === 'parent' || account?.status === 'child_approved';
  const staffAllowed = account?.status === 'manager' || account?.status === 'worker';
  const reportAllowed = isAuthorizedWorkspace(account?.status);
  const userScope = [userId ?? '', account?.status ?? '', account?.familyId ?? '', account?.teamName ?? ''];
  const familyQuery = useGetMyFamily({
    query: { queryKey: [...getGetMyFamilyQueryKey(), ...userScope], enabled: !!userId && familyAllowed },
  });
  const reportsQuery = useListReports({
    query: { queryKey: [...getListReportsQueryKey(), ...userScope], enabled: !!userId && reportAllowed, staleTime: 8_000 },
  });
  const mapQuery = useGetReportMapData({
    query: { queryKey: [...getGetReportMapDataQueryKey(), ...userScope], enabled: !!userId && reportAllowed, staleTime: 12_000 },
  });
  const notificationsQuery = useListNotifications({
    query: { queryKey: [...getListNotificationsQueryKey(), ...userScope], enabled: !!userId && isAuthorizedWorkspace(account?.status), staleTime: 8_000 },
  });
  const invalidateAccount = () => queryClient.invalidateQueries({ queryKey: getGetAccountStatusQueryKey() });
  const invalidateFamily = () => queryClient.invalidateQueries({ queryKey: getGetMyFamilyQueryKey() });
  const invalidateNotifications = () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  const invalidateReports = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetReportMapDataQueryKey() }),
  ]);

  const unreadCount = notificationsQuery.data?.filter((notice) => !notice.readAt).length ?? 0;
  const visibleReports = useMemo(() => {
    const rows = reportsQuery.data ?? [];
    if (account?.status !== 'worker') return rows;
    return rows.filter((report) => !!account.teamName && report.assignedTeam === account.teamName);
  }, [reportsQuery.data, account?.status, account?.teamName]);

  const onSignOut = async () => {
    setAuthTokenGetter(null);
    queryClient.clear();
    demo.clearUserScopedState();
    previousUser.current = null;
    try {
      await signOut();
    } catch (error) {
      setGlobalError(errorMessage(error));
    }
  };

  if (accountQuery.isPending) return <LoadingScreen label="Securing your PathPal account" />;
  if (accountQuery.isError) {
    return (
      <StatusPage
        eyebrow="ACCOUNT CONNECTION"
        title="We couldn’t load your account."
        detail={errorMessage(accountQuery.error)}
        action="Try again"
        onAction={() => { void accountQuery.refetch(); }}
      />
    );
  }
  if (!account) {
    return <StatusPage eyebrow="ACCOUNT" title="Account details are unavailable." detail="Sign out and sign in again to refresh your secure session." action="Sign out" onAction={() => { void onSignOut(); }} />;
  }
  if (account.status === 'needs_setup') {
    return (
      <AccountSetup
        displayName={account.displayName}
        onComplete={() => { void invalidateAccount(); }}
        onSignOut={() => { void onSignOut(); }}
      />
    );
  }
  if (account.status === 'child_pending' || account.status === 'child_rejected') {
    return (
      <ChildAccessState
        rejected={account.status === 'child_rejected'}
        deadline={account.approvalDeadline}
        onSignOut={() => { void onSignOut(); }}
      />
    );
  }

  const roleLabel = account.status === 'parent' ? 'Family account'
    : account.status === 'child_approved' ? 'Approved child'
      : account.status === 'manager' ? 'City manager' : 'City worker';
  const isFamily = familyAllowed;
  const nav: { id: Page; label: string; icon: keyof typeof Feather.glyphMap }[] = isFamily
    ? [
        { id: 'overview', label: 'Home', icon: 'home' },
        { id: 'travel', label: 'Travel', icon: 'navigation' },
        { id: 'reports', label: 'Reports', icon: 'file-text' },
        { id: 'map', label: 'Map', icon: 'map' },
        { id: 'family', label: 'Family', icon: 'users' },
      ]
    : account.status === 'manager'
      ? [
          { id: 'overview', label: 'Cases', icon: 'grid' },
          { id: 'map', label: 'Map', icon: 'map' },
          { id: 'reports', label: 'Reports', icon: 'inbox' },
          { id: 'account', label: 'More', icon: 'menu' },
        ]
      : [
          { id: 'overview', label: 'My team', icon: 'home' },
          { id: 'map', label: 'Route', icon: 'map' },
          { id: 'reports', label: 'Tasks', icon: 'check-square' },
          { id: 'account', label: 'More', icon: 'menu' },
        ];

  return (
    <View style={[styles.app, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 8), borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.brandRow}>
          <BrandMark size={34} />
          <View>
            <Text style={[styles.brand, { color: colors.foreground }]}>PathPal</Text>
            <Text style={[styles.brandSub, { color: colors.mutedForeground }]}>{roleLabel}</Text>
          </View>
        </View>
        <View style={styles.topActions}>
          <Pressable testID="open-notifications" accessibilityRole="button" accessibilityLabel="Open notifications" onPress={() => setPage('notifications')} style={styles.iconButton}>
            <Feather name="bell" size={20} color={colors.foreground} />
            {unreadCount > 0 ? <View style={[styles.unreadDot, { backgroundColor: colors.destructive }]} /> : null}
          </Pressable>
          <Pressable testID="open-account" accessibilityRole="button" accessibilityLabel="Open account" onPress={() => setPage('account')} style={styles.iconButton}>
            <Feather name="user" size={20} color={colors.foreground} />
          </Pressable>
        </View>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={[styles.pageContent, { paddingBottom: Math.max(insets.bottom, 14) + 86 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {globalError ? <InlineNotice message={globalError} error /> : null}
        {page === 'notifications' ? (
          <NotificationsPage
            data={notificationsQuery.data ?? []}
            loading={notificationsQuery.isPending}
            error={notificationsQuery.isError ? errorMessage(notificationsQuery.error) : ''}
            onRetry={() => { void notificationsQuery.refetch(); }}
            onRead={(id) => markRead.mutate({ id })}
            onBack={() => setPage('overview')}
          />
        ) : page === 'family' && account.status === 'parent' ? (
          <FamilyPage
            family={familyQuery.data}
            loading={familyQuery.isPending}
            error={familyQuery.isError ? errorMessage(familyQuery.error) : ''}
            onRetry={() => { void familyQuery.refetch(); }}
            onApprove={(id) => approveRequest.mutate({ id })}
            onReject={(id) => rejectRequest.mutate({ id })}
            onBack={() => setPage('overview')}
          />
        ) : page === 'family' && account.status === 'child_approved' ? (
          <ChildFamilyPage family={familyQuery.data} loading={familyQuery.isPending} error={familyQuery.isError ? errorMessage(familyQuery.error) : ''} onRetry={() => { void familyQuery.refetch(); }} />
        ) : page === 'account' ? (
          <AccountPage account={account} onSignOut={onSignOut} onInvite={() => setInviteOpen(true)} />
        ) : page === 'travel' && isFamily ? (
          <TravelPage />
        ) : page === 'reports' ? (
          <ReportsPage
            role={account.status}
            teamName={account.teamName}
            reports={visibleReports}
            loading={reportsQuery.isPending}
            error={reportsQuery.isError ? errorMessage(reportsQuery.error) : ''}
            onRetry={() => { void reportsQuery.refetch(); }}
            onCreate={() => setComposerOpen(true)}
            onSelect={setSelectedReport}
          />
        ) : page === 'map' ? (
          <ReportMapPage
            role={account.status}
            teamName={account.teamName}
            data={mapQuery.data}
            loading={mapQuery.isPending}
            error={mapQuery.isError ? errorMessage(mapQuery.error) : ''}
            onRetry={() => { void mapQuery.refetch(); }}
          />
        ) : (
          <>
            <OverviewPage
              account={account}
              family={familyQuery.data}
              reports={visibleReports}
              loadingReports={reportAllowed && reportsQuery.isPending}
              onPage={setPage}
              onCreate={() => setComposerOpen(true)}
              onSelect={setSelectedReport}
              onInvite={() => setInviteOpen(true)}
            />
            {account.status === 'child_approved' ? (
              <View style={{ marginTop: 12 }}>
                <SimulatedSOSPanel />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      {page !== 'notifications' ? (
        <View style={[styles.tabbar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 8) }]}>
          {nav.map((item) => {
            const active = page === item.id;
            return (
              <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }} testID={`secure-tab-${item.id}`} onPress={() => setPage(item.id)} style={styles.tab}>
                <View style={[styles.tabIcon, { backgroundColor: active ? colors.secondary : 'transparent' }]}>
                  <Feather name={item.icon} size={19} color={active ? colors.primary : colors.mutedForeground} />
                </View>
                <Text style={[styles.tabLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Modal visible={composerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setComposerOpen(false)}>
        <ReportComposer
          role={account.status}
          onClose={() => setComposerOpen(false)}
          onSaved={() => { setComposerOpen(false); void invalidateReports(); }}
        />
      </Modal>
      <Modal visible={!!selectedReport} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedReport(null)}>
        {selectedReport ? (
          <ReportDetail
            report={selectedReport}
            role={account.status}
            teamName={account.teamName}
            onClose={() => setSelectedReport(null)}
            onSaved={() => { setSelectedReport(null); void invalidateReports(); }}
          />
        ) : null}
      </Modal>
      <Modal visible={inviteOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setInviteOpen(false)}>
        <InviteStaff onClose={() => setInviteOpen(false)} onSaved={() => setInviteOpen(false)} />
      </Modal>
    </View>
  );
}

// Keep mutation hooks in a dedicated child so the main view remains role-driven.
function useWorkspaceActions() {
  const queryClient = useQueryClient();
  const approveRequest = useApproveFamilyJoinRequest({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetMyFamilyQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetAccountStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  } } });
  const rejectRequest = useRejectFamilyJoinRequest({ mutation: { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getGetMyFamilyQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetAccountStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  } } });
  const markRead = useMarkNotificationRead({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) } });
  return { approveRequest, rejectRequest, markRead };
}

function LoadingScreen({ label }: { label: string }) {
  const colors = useColors();
  return <View style={[styles.centerScreen, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{label}</Text></View>;
}

function StatusPage({ eyebrow, title, detail, action, onAction }: { eyebrow: string; title: string; detail: string; action: string; onAction: () => void }) {
  const colors = useColors();
  return <View style={[styles.statusPage, { backgroundColor: colors.background }]}><View style={[styles.statusGlyph, { backgroundColor: colors.accent }]}><Feather name="shield" size={24} color={colors.primary} /></View><ScreenHeader eyebrow={eyebrow} title={title} subtitle={detail} /><Button label={action} icon="arrow-right" onPress={onAction} /></View>;
}

function AccountSetup({ displayName, onComplete, onSignOut }: { displayName: string; onComplete: () => void; onSignOut: () => void }) {
  const colors = useColors();
  const [flow, setFlow] = useState<'choose' | 'parent' | 'child' | 'staff'>('choose');
  const [name, setName] = useState(displayName);
  const [familyName, setFamilyName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const afterSetup = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetAccountStatusQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetMyFamilyQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    ]);
    onComplete();
  };
  const parent = useCreateParentAccount({ mutation: { onSuccess: () => { void afterSetup(); }, onError: (err) => setError(errorMessage(err)) } });
  const child = useCreateChildAccount({ mutation: { onSuccess: () => { void afterSetup(); }, onError: (err) => setError(errorMessage(err)) } });
  const staff = useAcceptStaffInvitation({ mutation: { onSuccess: () => { void afterSetup(); }, onError: (err) => setError(errorMessage(err)) } });
  const manager = useBootstrapInitialManager({ mutation: { onSuccess: () => { void afterSetup(); }, onError: (err) => setError(errorMessage(err)) } });
  const busy = parent.isPending || child.isPending || staff.isPending || manager.isPending;
  const colorsForFlow = flow === 'parent' ? 'Start a family account.' : flow === 'child' ? 'Join your family.' : 'Accept a city team invitation.';
  return (
    <ScrollView style={[styles.setupScreen, { backgroundColor: colors.background }]} contentContainerStyle={styles.setupContent} keyboardShouldPersistTaps="handled">
      <View style={styles.setupTop}><BrandMark size={38} /><Pressable onPress={onSignOut} accessibilityRole="button"><Text style={[styles.signOutText, { color: colors.primary }]}>Sign out</Text></Pressable></View>
      <Text style={[styles.kicker, { color: colors.primary }]}>ACCOUNT SETUP</Text>
      <Text style={[styles.setupTitle, { color: colors.foreground }]}>{flow === 'choose' ? `Welcome, ${displayName}.` : colorsForFlow}</Text>
      <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Choose the invitation or family path that applies to you. Access is set by your verified account and server permissions.</Text>
      {flow === 'choose' ? (
        <View style={styles.setupOptions}>
          <SetupOption icon="users" title="Create a family" detail="Parent or guardian account" onPress={() => { setError(''); setFlow('parent'); }} />
          <SetupOption icon="user-plus" title="Join a family" detail="Child account with a family code" onPress={() => { setError(''); setFlow('child'); }} />
          <SetupOption icon="briefcase" title="Join a city team" detail="Invited staff account" onPress={() => { setError(''); setFlow('staff'); }} />
          <Card style={styles.maintainerCard} tone="soft">
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Maintainer setup</Text>
            <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Create the first city manager only if this verified account is authorized by the service maintainer.</Text>
            {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
            <Button label="Check manager eligibility" icon="shield" loading={manager.isPending} disabled={busy} onPress={() => { setError(''); manager.mutate(); }} />
          </Card>
        </View>
      ) : (
        <Card style={styles.setupForm}>
          <Field label="Your name" value={name} onChangeText={setName} autoCapitalize="words" />
          {flow === 'parent' ? <Field label="Family name" value={familyName} onChangeText={setFamilyName} autoCapitalize="words" /> : null}
          {flow !== 'parent' ? <Field label={flow === 'child' ? 'Family invitation code' : 'City invitation code'} value={code} onChangeText={setCode} autoCapitalize="none" /> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
          <Button
            label={flow === 'parent' ? 'Create family' : flow === 'child' ? 'Request to join' : 'Accept invitation'}
            icon="arrow-right"
            loading={busy}
            disabled={busy || !name.trim() || (flow === 'parent' ? !familyName.trim() : !code.trim())}
            onPress={() => {
              setError('');
              if (flow === 'parent') parent.mutate({ data: { displayName: name.trim(), familyName: familyName.trim() } });
              if (flow === 'child') child.mutate({ data: { displayName: name.trim(), invitationCode: code.trim() } });
              if (flow === 'staff') staff.mutate({ data: { displayName: name.trim(), invitationCode: code.trim() } });
            }}
          />
          <Pressable onPress={() => { setFlow('choose'); setError(''); }} style={styles.backLink}><Text style={[styles.signOutText, { color: colors.primary }]}>Choose another setup</Text></Pressable>
        </Card>
      )}
      <View style={styles.privacyNote}><Feather name="lock" size={15} color={colors.primary} /><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Children do not see family details until a parent approves the request.</Text></View>
    </ScrollView>
  );
}

function SetupOption({ icon, title, detail, onPress }: { icon: keyof typeof Feather.glyphMap; title: string; detail: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.setupOption, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.76 : 1 }]}><View style={[styles.setupOptionIcon, { backgroundColor: colors.secondary }]}><Feather name={icon} size={19} color={colors.primary} /></View><View style={styles.grow}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{detail}</Text></View><Feather name="chevron-right" size={18} color={colors.mutedForeground} /></Pressable>;
}

function ChildAccessState({ rejected, deadline, onSignOut }: { rejected: boolean; deadline: string | null; onSignOut: () => void }) {
  const colors = useColors();
  const title = rejected ? 'This request was not approved.' : 'Waiting for a parent to approve.';
  const detail = rejected
    ? 'You can ask your parent or guardian for a new family invitation code and submit a new request.'
    : 'Your account is private while the request is reviewed. No family name, members, reports, photos, or map markers are available yet.';
  return (
    <View style={[styles.childState, { backgroundColor: colors.background }]}>
      <View style={[styles.stateShield, { backgroundColor: colors.accent }]}><Feather name={rejected ? 'slash' : 'clock'} size={25} color={colors.primary} /></View>
      <Text style={[styles.kicker, { color: colors.primary }]}>{rejected ? 'REQUEST CLOSED' : 'ACCESS PENDING'}</Text>
      <Text style={[styles.childTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{detail}</Text>
      {!rejected && deadline ? <Text style={[styles.deadline, { color: colors.mutedForeground }]}>Review deadline · {new Date(deadline).toLocaleDateString()}</Text> : null}
      <Card tone="soft" style={styles.privacyCard}><Feather name="lock" size={18} color={colors.primary} /><Text style={[styles.bodyText, { color: colors.foreground }]}>Only your display name and request status are available until access is approved.</Text></Card>
      <Button label="Sign out" icon="log-out" variant="ghost" onPress={onSignOut} />
    </View>
  );
}

function OverviewPage({ account, family, reports, loadingReports, onPage, onCreate, onSelect, onInvite }: {
  account: { status: string; displayName: string; familyName: string | null; teamName: string | null };
  family?: { familyName: string | null; pendingRequests: { membershipId: number }[] };
  reports: CommunityReport[];
  loadingReports: boolean;
  onPage: (page: Page) => void;
  onCreate: () => void;
  onSelect: (report: CommunityReport) => void;
  onInvite: () => void;
}) {
  const colors = useColors();
  const familyRole = account.status === 'parent' || account.status === 'child_approved';
  const manager = account.status === 'manager';
  const activeReports = reports.filter((report) => report.status !== 'Resolved');
  return (
    <>
      <ScreenHeader
        eyebrow={manager ? 'SANTA CLARA COUNTY · OPERATIONS' : account.status === 'worker' ? account.teamName ?? 'CITY TEAM' : 'FAMILY TRAVEL'}
        title={manager ? 'Cases that need a hand.' : account.status === 'worker' ? 'Your assigned work.' : `Good to see you, ${account.displayName.split(' ')[0]}.`}
        subtitle={manager ? 'Review neighborhood reports and coordinate the next fix.' : account.status === 'worker' ? 'Only cases assigned to your team are shown here.' : 'Plan the trip together. Share neighborhood issues with the people who can help.'}
      />
      {familyRole ? (
        <>
          <Card tone="navy" style={styles.familyHero}>
            <View style={styles.heroFamilyMark}><Feather name="users" size={19} color={colors.primary} /></View>
            <Text style={[styles.heroEyebrow, { color: colors.accent }]}>FAMILY SPACE</Text>
            <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{family?.familyName ?? account.familyName ?? 'Your family'}</Text>
            <Text style={[styles.heroText, { color: colors.primaryForeground }]}>Family information stays within your approved circle.</Text>
          </Card>
          {account.status === 'parent' && family?.pendingRequests?.length ? (
            <Pressable onPress={() => onPage('family')} style={[styles.approvalBanner, { backgroundColor: colors.accent }]}>
              <Feather name="user-plus" size={18} color={colors.primary} />
              <Text style={[styles.cardTitle, styles.grow, { color: colors.foreground }]}>{family.pendingRequests.length} join request{family.pendingRequests.length === 1 ? '' : 's'} need review</Text>
              <Feather name="arrow-right" size={17} color={colors.primary} />
            </Pressable>
          ) : null}
          <View style={styles.quickActions}>
            <ActionTile icon="navigation" title="Trip plan" detail="Open family travel" onPress={() => onPage('travel')} />
            <ActionTile icon="camera" title="Report an issue" detail="Tell your city team" onPress={onCreate} />
          </View>
          <SectionTitle title="Your family reports" action="See all" onAction={() => onPage('reports')} />
          {loadingReports ? <SkeletonCard /> : reports.slice(0, 3).map((report) => <ReportRow key={report.id} report={report} onPress={() => onSelect(report)} />)}
          {!loadingReports && reports.length === 0 ? <EmptyState icon="file-text" title="No reports yet" detail="Reports you submit will appear here, visible only to your family and authorized city staff." /> : null}
        </>
      ) : manager ? (
        <>
          <View style={styles.metricsRow}>
            <MetricCard label="Open cases" value={loadingReports ? '—' : String(activeReports.length)} icon="inbox" />
            <MetricCard label="Resolved" value={loadingReports ? '—' : String(reports.filter((row) => row.status === 'Resolved').length)} icon="check-circle" />
          </View>
          <Card style={styles.managerCard}>
            <View style={styles.managerCardHead}><View style={[styles.iconTile, { backgroundColor: colors.secondary }]}><Feather name="users" size={19} color={colors.primary} /></View><View style={styles.grow}><Text style={[styles.cardTitle, { color: colors.foreground }]}>City staff access</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Invite a manager or a worker to the right team.</Text></View></View>
            <Button label="Create staff invitation" icon="user-plus" onPress={onInvite} />
          </Card>
          <SectionTitle title="Priority queue" action="All cases" onAction={() => onPage('reports')} />
          {loadingReports ? <SkeletonCard /> : activeReports.slice(0, 4).map((report) => <ReportRow key={report.id} report={report} onPress={() => onSelect(report)} />)}
          {!loadingReports && !activeReports.length ? <EmptyState icon="check-circle" title="No open cases" detail="New authorized reports will appear here." /> : null}
          <SectionTitle title="Authorized case map" action="Open map" onAction={() => onPage('map')} />
        </>
      ) : (
        <>
          <Card tone="navy" style={styles.teamHero}>
            <View style={styles.teamBadge}><Feather name="tool" size={18} color={colors.primary} /></View>
            <Text style={[styles.heroEyebrow, { color: colors.accent }]}>ASSIGNED TEAM</Text>
            <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{account.teamName ?? 'Your city team'}</Text>
            <Text style={[styles.heroText, { color: colors.primaryForeground }]}>Case details are limited to your assigned team. You can update status only.</Text>
          </Card>
          <View style={styles.metricsRow}>
            <MetricCard label="Assigned stops" value={String(activeReports.length)} icon="map-pin" />
            <MetricCard label="Resolved" value={String(reports.filter((row) => row.status === 'Resolved').length)} icon="check-circle" />
          </View>
          <SectionTitle title="Your assigned cases" action="View route" onAction={() => onPage('map')} />
          {loadingReports ? <SkeletonCard /> : activeReports.map((report) => <ReportRow key={report.id} report={report} onPress={() => onSelect(report)} />)}
          {!loadingReports && !activeReports.length ? <EmptyState icon="check-circle" title="Nothing assigned right now" detail="New work for your team will show up here." /> : null}
        </>
      )}
    </>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name={icon} size={17} color={colors.primary} /><Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text><Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text></View>;
}

function ActionTile({ icon, title, detail, onPress }: { icon: keyof typeof Feather.glyphMap; title: string; detail: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.actionTile, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.74 : 1 }]}><View style={[styles.iconTile, { backgroundColor: colors.secondary }]}><Feather name={icon} size={19} color={colors.primary} /></View><Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{detail}</Text></Pressable>;
}

function ReportsPage({ role, teamName, reports, loading, error, onRetry, onCreate, onSelect }: {
  role: string; teamName: string | null; reports: CommunityReport[]; loading: boolean; error: string; onRetry: () => void; onCreate: () => void; onSelect: (report: CommunityReport) => void;
}) {
  const colors = useColors();
  const family = role === 'parent' || role === 'child_approved';
  return (
    <>
      <ScreenHeader eyebrow={family ? 'FAMILY REPORTS' : role === 'manager' ? 'CITY OPERATIONS' : teamName ?? 'TEAM WORK'} title={family ? 'Reports you shared.' : role === 'manager' ? 'Neighborhood cases.' : 'Assigned work.'} subtitle={family ? 'Only your approved family can see this report list.' : role === 'worker' ? 'Your team’s cases only. Status updates are available from a case.' : 'Review citywide cases and coordinate the next step.'} right={family ? <Pressable accessibilityRole="button" onPress={onCreate} style={[styles.roundAction, { backgroundColor: colors.primary }]}><Feather name="plus" size={20} color={colors.primaryForeground} /></Pressable> : null} />
      {role === 'manager' ? <View style={[styles.privacyStrip, { backgroundColor: colors.accent }]}><Feather name="shield" size={15} color={colors.primary} /><Text style={[styles.bodyText, { color: colors.accentForeground }]}>Reporter identity and family scope are protected by the server.</Text></View> : null}
      {loading ? <><SkeletonCard /><SkeletonCard /></> : error ? <EmptyState icon="wifi-off" title="Reports are unavailable" detail={error} action="Try again" onAction={onRetry} /> : reports.map((report) => <ReportRow key={report.id} report={report} onPress={() => onSelect(report)} />)}
      {!loading && !error && reports.length === 0 ? <EmptyState icon="file-text" title={family ? 'No family reports yet' : 'No cases to show'} detail={family ? 'A report you submit will appear here.' : 'The server has not returned any authorized cases for this view.'} action={family ? 'Create a report' : undefined} onAction={family ? onCreate : undefined} /> : null}
    </>
  );
}

function ReportRow({ report, onPress }: { report: CommunityReport; onPress: () => void }) {
  const colors = useColors();
  const statusColor = report.status === 'Resolved' ? colors.success : report.status === 'Assigned' ? colors.warning : colors.primary;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.reportRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}><View style={[styles.reportIcon, { backgroundColor: colors.secondary }]}><Feather name={report.status === 'Resolved' ? 'check' : report.status === 'Assigned' ? 'tool' : 'alert-circle'} size={18} color={statusColor} /></View><View style={styles.grow}><Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>{report.category}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]} numberOfLines={2}>{report.summary}</Text><Text style={[styles.reportMeta, { color: colors.mutedForeground }]}>{report.location} · {new Date(report.submittedAt).toLocaleDateString()}</Text></View><View style={[styles.statusPill, { backgroundColor: colors.accent }]}><Text style={[styles.statusText, { color: statusColor }]}>{report.status}</Text></View></Pressable>;
}

function ReportMapPage({ role, teamName, data, loading, error, onRetry }: {
  role: string; teamName: string | null; data?: { markers: ReportMapMarker[]; publicHeat: { latitude: number; longitude: number; intensity: number }[] }; loading: boolean; error: string; onRetry: () => void;
}) {
  const colors = useColors();
  const isWorker = role === 'worker';
  const markers = data?.markers.filter((marker) => !isWorker || marker.assignedTeam === teamName) ?? [];
  const heat = data?.publicHeat ?? [];
  const bounds = useMemo(() => {
    const pts = [...markers.map((m) => ({ lat: m.latitude, lng: m.longitude })), ...heat.map((m) => ({ lat: m.latitude, lng: m.longitude }))];
    if (!pts.length) return { minLat: 37.25, maxLat: 37.45, minLng: -122.03, maxLng: -121.75 };
    return {
      minLat: Math.min(...pts.map((p) => p.lat)) - 0.015,
      maxLat: Math.max(...pts.map((p) => p.lat)) + 0.015,
      minLng: Math.min(...pts.map((p) => p.lng)) - 0.015,
      maxLng: Math.max(...pts.map((p) => p.lng)) + 0.015,
    };
  }, [markers, heat]);
  const project = (lat: number, lng: number) => ({
    left: `${12 + ((lng - bounds.minLng) / Math.max(0.0001, bounds.maxLng - bounds.minLng)) * 76}%` as `${number}%`,
    top: `${13 + (1 - (lat - bounds.minLat) / Math.max(0.0001, bounds.maxLat - bounds.minLat)) * 72}%` as `${number}%`,
  });
  return (
    <>
      <ScreenHeader eyebrow={isWorker ? 'TEAM ROUTE' : 'AUTHORIZED REPORT MAP'} title={isWorker ? 'Your case locations.' : 'A clearer picture of the area.'} subtitle={isWorker ? `Locations assigned to ${teamName ?? 'your team'} only.` : 'Pins are limited to cases this account is authorized to view. Public density is aggregated.'} />
      {loading ? <SkeletonCard /> : error ? <EmptyState icon="wifi-off" title="Map data is unavailable" detail={error} action="Try again" onAction={onRetry} /> : (
        <>
          <View style={[styles.mapCanvas, { backgroundColor: colors.brandSurface, borderColor: colors.border }]}>
            <View style={[styles.mapLine, styles.mapRoadA, { backgroundColor: colors.card }]} />
            <View style={[styles.mapLine, styles.mapRoadB, { backgroundColor: colors.card }]} />
            <View style={[styles.mapLine, styles.mapRoadC, { backgroundColor: colors.card }]} />
            <Text style={[styles.mapLabel, styles.mapLabelNorth, { color: colors.secondaryForeground }]}>SANTA CLARA COUNTY</Text>
            <Text style={[styles.mapLabel, styles.mapLabelSouth, { color: colors.secondaryForeground }]}>SAN JOSE</Text>
            {!isWorker ? heat.map((cell, index) => {
              const position = project(cell.latitude, cell.longitude);
              const size = 18 + Math.round(cell.intensity * 35);
              return <View key={`heat-${index}`} pointerEvents="none" style={[styles.heatDot, { ...position, width: size, height: size, borderRadius: size / 2, backgroundColor: `rgba(184,106,32,${0.12 + cell.intensity * 0.23})` }]} />;
            }) : null}
            {markers.map((marker) => {
              const position = project(marker.latitude, marker.longitude);
              return <View key={marker.id} style={[styles.markerDot, { ...position, backgroundColor: marker.status === 'Resolved' ? colors.success : marker.status === 'Assigned' ? colors.warning : colors.primary, borderColor: colors.card }]}><Feather name="map-pin" size={12} color={colors.primaryForeground} /></View>;
            })}
          </View>
          <View style={[styles.mapLegend, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <LegendDot color={colors.primary} label={`${markers.length} authorized case${markers.length === 1 ? '' : 's'}`} />
            {!isWorker ? <LegendDot color={colors.warning} label="Anonymous area density" /> : null}
          </View>
          <Card tone="soft"><View style={styles.privacyStripInline}><Feather name="lock" size={15} color={colors.primary} /><Text style={[styles.bodyText, { color: colors.accentForeground }]}>{isWorker ? 'No cases outside your assigned team are displayed.' : 'Map data is delivered for this signed-in account. Pending family members cannot access markers.'}</Text></View></Card>
          {markers.length === 0 && heat.length === 0 ? <EmptyState icon="map" title="No authorized locations" detail="There are no report locations available for this view yet." /> : null}
        </>
      )}
    </>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendCircle, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

function FamilyPage({ family, loading, error, onRetry, onApprove, onReject, onBack }: {
  family?: { state: string; familyName: string | null; invitationCode: string | null; approvalDeadline: string | null; members: { membershipId: number; displayName: string; role: string; status: string; requestedAt: string }[]; pendingRequests: { membershipId: number; displayName: string; requestedAt: string }[] };
  loading: boolean; error: string; onRetry: () => void; onApprove: (id: number) => void; onReject: (id: number) => void; onBack: () => void;
}) {
  const colors = useColors();
  return (
    <>
      <BackLink label="Back to Home" onPress={onBack} />
      <ScreenHeader eyebrow="FAMILY ACCOUNT" title="Your family circle." subtitle="Only this family’s approved members are listed here." />
      {loading ? <SkeletonCard /> : error ? <EmptyState icon="wifi-off" title="Family details are unavailable" detail={error} action="Try again" onAction={onRetry} /> : family ? (
        <>
          <Card tone="navy" style={styles.familyHero}><Text style={[styles.heroEyebrow, { color: colors.accent }]}>FAMILY</Text><Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{family.familyName ?? 'Family account'}</Text><Text style={[styles.heroText, { color: colors.primaryForeground }]}>Invitation code</Text><Text selectable style={[styles.invitationCode, { color: colors.primaryForeground }]}>{family.invitationCode ?? 'Not available'}</Text><Text style={[styles.bodyText, { color: colors.primaryForeground }]}>Share this code privately with a child joining your family.</Text></Card>
          {family.pendingRequests.length ? (
            <>
              <SectionTitle title="Requests to join" />
              {family.pendingRequests.map((request) => (
                <Card key={request.membershipId} style={styles.requestCard}>
                  <View style={styles.requestIdentity}><View style={[styles.avatarInitial, { backgroundColor: colors.secondary }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{request.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.grow}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{request.displayName}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Child · requested {new Date(request.requestedAt).toLocaleDateString()}</Text></View></View>
                  <View style={styles.requestActions}><Button label="Approve" icon="check" onPress={() => onApprove(request.membershipId)} /><Button label="Decline" icon="x" variant="secondary" onPress={() => Alert.alert('Decline request?', `${request.displayName} will not be added to your family.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Decline', style: 'destructive', onPress: () => onReject(request.membershipId) }])} /></View>
                </Card>
              ))}
            </>
          ) : <EmptyState icon="user-check" title="No requests waiting" detail="New requests from children who enter your invitation code will be shown here." />}
          <SectionTitle title="Family members" />
          {family.members.map((member) => <Card key={member.membershipId} style={styles.memberRow}><View style={[styles.avatarInitial, { backgroundColor: colors.secondary }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{member.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.grow}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{member.displayName}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{member.role === 'parent' ? 'Parent or guardian' : 'Child'}</Text></View><View style={[styles.memberStatus, { backgroundColor: member.status === 'approved' ? colors.accent : colors.muted }]}><Text style={[styles.memberStatusText, { color: member.status === 'approved' ? colors.success : colors.mutedForeground }]}>{member.status}</Text></View></Card>)}
        </>
      ) : <EmptyState icon="users" title="Family information is private" detail="No family details have been returned for this account." />}
    </>
  );
}

function ChildFamilyPage({ family, loading, error, onRetry }: { family?: { familyName: string | null; members: { membershipId: number; displayName: string; role: string; status: string }[] }; loading: boolean; error: string; onRetry: () => void }) {
  const colors = useColors();
  return <><ScreenHeader eyebrow="APPROVED FAMILY" title={family?.familyName ?? 'Your family'} subtitle="Only approved family members and family-scoped reports are available." />{loading ? <SkeletonCard /> : error ? <EmptyState icon="wifi-off" title="Family details unavailable" detail={error} action="Try again" onAction={onRetry} /> : family?.members.map((member) => <Card key={member.membershipId} style={styles.memberRow}><View style={[styles.avatarInitial, { backgroundColor: colors.secondary }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{member.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.grow}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{member.displayName}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{member.role === 'parent' ? 'Parent or guardian' : 'Child'}</Text></View><Feather name="check-circle" size={18} color={colors.success} /></Card>)}</>;
}

function NotificationsPage({ data, loading, error, onRetry, onRead, onBack }: { data: { id: number; title: string; body: string; type: string; createdAt: string; readAt: string | null }[]; loading: boolean; error: string; onRetry: () => void; onRead: (id: number) => void; onBack: () => void }) {
  const colors = useColors();
  return <><BackLink label="Back" onPress={onBack} /><ScreenHeader eyebrow="ACCOUNT UPDATES" title="Notifications." subtitle="Messages from your approved account and family workflow." />{loading ? <SkeletonCard /> : error ? <EmptyState icon="wifi-off" title="Notifications unavailable" detail={error} action="Try again" onAction={onRetry} /> : data.map((notice) => <Pressable key={notice.id} accessibilityRole="button" accessibilityState={{ selected: !!notice.readAt }} onPress={() => { if (!notice.readAt) onRead(notice.id); }} style={({ pressed }) => [styles.noticeRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}><View style={[styles.noticeIcon, { backgroundColor: notice.readAt ? colors.muted : colors.accent }]}><Feather name={notice.type === 'child_join_request' ? 'user-plus' : notice.type === 'child_rejected' ? 'user-x' : 'bell'} size={18} color={notice.readAt ? colors.mutedForeground : colors.primary} /></View><View style={styles.grow}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{notice.title}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{notice.body}</Text><Text style={[styles.reportMeta, { color: colors.mutedForeground }]}>{new Date(notice.createdAt).toLocaleString()}</Text></View>{!notice.readAt ? <View style={[styles.unreadSmall, { backgroundColor: colors.primary }]} /> : null}</Pressable>)}{!loading && !error && data.length === 0 ? <EmptyState icon="bell" title="All quiet here" detail="Account notifications will appear here." /> : null}</>;
}

function AccountPage({ account, onSignOut, onInvite }: { account: { displayName: string; status: string; familyName: string | null; teamName: string | null }; onSignOut: () => Promise<void>; onInvite: () => void }) {
  const colors = useColors();
  return <><ScreenHeader eyebrow="ACCOUNT" title="Account & access." subtitle="This workspace follows the role and scope returned for your signed-in account." /><Card style={styles.accountCard}><View style={[styles.avatarInitial, { width: 48, height: 48, backgroundColor: colors.secondary }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{account.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.grow}><Text style={[styles.cardTitle, { color: colors.foreground }]}>{account.displayName}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{account.status === 'parent' || account.status === 'child_approved' ? account.familyName ?? 'Approved family member' : account.teamName ?? 'City staff'}</Text></View><Feather name="shield" size={18} color={colors.primary} /></Card><Card tone="soft" style={styles.accessNote}><Feather name="lock" size={16} color={colors.primary} /><Text style={[styles.bodyText, { color: colors.accentForeground }]}>Reports, family membership, and map data are provided by PathPal’s access-controlled API. Changing roles in the app is not possible.</Text></Card>{account.status === 'manager' ? <><SectionTitle title="Staff" /><Button label="Invite manager or worker" icon="user-plus" onPress={onInvite} /></> : null}<View style={{ height: 20 }} /><Button label="Sign out" icon="log-out" variant="ghost" onPress={onSignOut} testID="secure-sign-out" /></>;
}

function InviteStaff({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<'manager' | 'worker'>('worker');
  const [teamName, setTeamName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [error, setError] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const create = useCreateStaffInvitation({
    mutation: { onSuccess: (invitation) => {
      setInvitationCode(invitation.invitationCode);
      setExpiresAt(invitation.expiresAt);
      void queryClient.invalidateQueries({ queryKey: getGetAccountStatusQueryKey() });
    }, onError: (caught) => setError(errorMessage(caught)) },
  });
  return <KeyboardShell onClose={onClose} eyebrow="CITY STAFF" title={invitationCode ? 'Invitation created.' : 'Invite a teammate.'}>
    {invitationCode ? <Card tone="soft" style={styles.inviteResult}><Text style={[styles.bodyText, { color: colors.accentForeground }]}>Share this one-time invitation privately.</Text><Text selectable style={[styles.inviteCode, { color: colors.foreground }]}>{invitationCode}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Expires {new Date(expiresAt).toLocaleString()}</Text><Button label="Done" icon="check" onPress={onSaved} /></Card> : <Card style={styles.formCard}>
      <Text style={[styles.label, { color: colors.foreground }]}>Role</Text>
      <View style={styles.switchRow}>{(['worker', 'manager'] as const).map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: role === item }} onPress={() => setRole(item)} style={[styles.roleChip, { backgroundColor: role === item ? colors.primary : colors.muted }]}><Text style={[styles.roleChipText, { color: role === item ? colors.primaryForeground : colors.mutedForeground }]}>{item === 'worker' ? 'City worker' : 'City manager'}</Text></Pressable>)}</View>
      {role === 'worker' ? <Field label="Team name" value={teamName} onChangeText={setTeamName} placeholder="Assigned team" /> : null}
      {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
      <Button label="Create invitation code" icon="key" loading={create.isPending} disabled={create.isPending || (role === 'worker' && !teamName.trim())} onPress={() => { setError(''); create.mutate({ data: { role, teamName: role === 'worker' ? teamName.trim() : null } }); }} />
    </Card>}
  </KeyboardShell>;
}

function ReportComposer({ role, onClose, onSaved }: { role: string; onClose: () => void; onSaved: () => void }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CommunityReportCategory | null>(null);
  const [location, setLocation] = useState<ReportNeighborhood>(neighborhoods[0]);
  const [photoBase64, setPhotoBase64] = useState('');
  const [photoUri, setPhotoUri] = useState('');
  const [error, setError] = useState('');
  const create = useCreateReport({ mutation: { onSuccess: async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetReportMapDataQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetMyFamilyQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    ]);
    onSaved();
  }, onError: (caught) => setError(errorMessage(caught)) } });
  const choosePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Allow photo library access to attach an image. You can still submit without a photo.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.72, base64: true, allowsEditing: true, aspect: [4, 3] });
    if (!result.canceled && result.assets[0]) {
      setPhotoBase64(result.assets[0].base64 ?? '');
      setPhotoUri(result.assets[0].uri);
      setError('');
    }
  };
  return <KeyboardShell onClose={onClose} eyebrow={role === 'manager' ? 'CASE INTAKE' : 'NEIGHBORHOOD REPORT'} title="Tell us what needs attention.">
    <Text style={[styles.bodyText, { color: colors.mutedForeground, marginBottom: 15 }]}>Please do not include a child’s full name or private family details.</Text>
    <Card style={styles.formCard}>
      <Text style={[styles.label, { color: colors.foreground }]}>Issue category</Text>
      <View style={styles.chipWrap}>{reportCategories.map((item) => <ChoiceChip key={item} active={category === item} label={item} onPress={() => setCategory(item)} />)}</View>
      <Text style={[styles.label, { color: colors.foreground }]}>Approximate location</Text>
      <View style={styles.chipWrap}>{neighborhoods.map((item) => <ChoiceChip key={item.name} active={location.name === item.name} label={item.name} onPress={() => setLocation(item)} />)}</View>
      <Field label="What did you notice?" value={description} onChangeText={setDescription} multiline placeholder="Describe the issue and how it affects people nearby." />
      {photoUri ? <View style={styles.photoPreview}><Image source={{ uri: photoUri }} contentFit="cover" style={styles.photoImage} /><Pressable accessibilityRole="button" accessibilityLabel="Remove attached photo" onPress={() => { setPhotoUri(''); setPhotoBase64(''); }} style={[styles.photoRemove, { backgroundColor: colors.card }]}><Feather name="x" size={16} color={colors.foreground} /></Pressable></View> : <Pressable accessibilityRole="button" onPress={() => { void choosePhoto(); }} style={[styles.addPhoto, { borderColor: colors.border, backgroundColor: colors.muted }]}><Feather name="camera" size={17} color={colors.primary} /><Text style={[styles.bodyText, { color: colors.foreground }]}>Add a photo (optional)</Text></Pressable>}
      {error ? <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
      <Button label="Submit report" icon="arrow-up-right" loading={create.isPending} disabled={description.trim().length < 12 || create.isPending} onPress={() => {
        const data = {
          description: description.trim(),
          location: location.name,
          category,
          latitude: location.latitude,
          longitude: location.longitude,
          ...(photoBase64 ? { photoBase64, contentType: 'image/jpeg' as const } : {}),
        };
        create.mutate({ data });
      }} />
      <Text style={[styles.reportFootnote, { color: colors.mutedForeground }]}>Your report is shared only with your approved family (when applicable) and authorized city staff.</Text>
    </Card>
  </KeyboardShell>;
}

function ChoiceChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.choiceChip, { backgroundColor: active ? colors.primary : colors.muted, borderColor: active ? colors.primary : colors.border }]}><Text style={[styles.choiceText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{label}</Text></Pressable>;
}

function ReportDetail({ report, role, teamName, onClose, onSaved }: { report: CommunityReport; role: string; teamName: string | null; onClose: () => void; onSaved: () => void }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [photoData, setPhotoData] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [notes, setNotes] = useState(report.managerNotes ?? '');
  const [team, setTeam] = useState(report.assignedTeam ?? '');
  const [error, setError] = useState('');
  const manager = role === 'manager';
  const worker = role === 'worker' && !!teamName && report.assignedTeam === teamName;
  const update = useUpdateReport({ mutation: { onSuccess: async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetReportMapDataQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    ]);
    onSaved();
  }, onError: (caught) => setError(errorMessage(caught)) } });
  useEffect(() => {
    let active = true;
    if (!report.photoUri) return;
    loadReportPhotoDataUri(report.id).then((uri) => { if (active) setPhotoData(uri); }).catch((caught) => { if (active) setPhotoError(errorMessage(caught)); });
    return () => { active = false; };
  }, [report.id, report.photoUri]);
  const canUpdateStatus = manager || worker;
  return <KeyboardShell onClose={onClose} eyebrow="REPORT DETAIL" title={report.category}>
    <View style={[styles.statusPill, { backgroundColor: colors.accent, alignSelf: 'flex-start', marginBottom: 14 }]}><Text style={[styles.statusText, { color: colors.primary }]}>{report.status}</Text></View>
    <Card style={styles.detailCard}>
      <Text style={[styles.detailSummary, { color: colors.foreground }]}>{report.summary}</Text>
      <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{report.description}</Text>
      <DetailFact icon="map-pin" label="Approximate location" value={report.location} />
      <DetailFact icon="calendar" label="Submitted" value={new Date(report.submittedAt).toLocaleString()} />
      <DetailFact icon="alert-circle" label="Priority" value={`${report.priority} · severity ${report.severity}/10`} />
      <DetailFact icon="briefcase" label="Assigned team" value={report.assignedTeam ?? 'Not assigned'} />
      {report.managerNotes ? <DetailFact icon="message-square" label="Manager notes" value={report.managerNotes} /> : null}
    </Card>
    {report.photoUri ? photoData ? <Image source={{ uri: photoData }} contentFit="cover" style={styles.reportPhoto} accessibilityLabel="Attached report photograph" /> : <Card tone="soft"><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{photoError || 'Loading authorized report photo…'}</Text></Card> : null}
    {(manager || worker) ? (
      <>
        <SectionTitle title={manager ? 'Case coordination' : 'Update case status'} />
        <Card style={styles.formCard}>
          {manager ? <>
            <Field label="Assign team" value={team} onChangeText={setTeam} placeholder="Team name" />
            <Field label="Manager notes" value={notes} onChangeText={setNotes} multiline placeholder="Internal coordination note" />
          </> : <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>Worker access is limited to status changes for assigned cases.</Text>}
          <Text style={[styles.label, { color: colors.foreground }]}>{manager ? 'Set case status' : 'Update status'}</Text>
          <View style={styles.chipWrap}>{(manager ? statusOrder : statusOrder.filter((status) => status !== 'Submitted')).map((status) => <ChoiceChip key={status} label={status} active={status === report.status} onPress={() => update.mutate({ id: report.id, data: manager ? { status, assignedTeam: team.trim() || null, managerNotes: notes.trim() || null } : { status } })} />)}</View>
          {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
          {manager ? <Button label="Save case details" icon="save" loading={update.isPending} onPress={() => update.mutate({ id: report.id, data: { assignedTeam: team.trim() || null, managerNotes: notes.trim() || null } })} /> : null}
        </Card>
      </>
    ) : null}
    <Button label="Close report" icon="x" variant="ghost" onPress={onClose} />
  </KeyboardShell>;
}

function DetailFact({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  const colors = useColors();
  return <View style={styles.factRow}><Feather name={icon} size={15} color={colors.primary} /><Text style={[styles.factLabel, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.factValue, { color: colors.foreground }]}>{value}</Text></View>;
}

function TravelPage() {
  const colors = useColors();
  return <><ScreenHeader eyebrow="FAMILY TRAVEL" title="Plan the trip." subtitle="Use PathPal’s existing route search and family check-in tools." /><View style={[styles.travelContainer, { backgroundColor: colors.card, borderColor: colors.border }]}><JourneyScreen /></View></>;
}

function KeyboardShell({ children, onClose, eyebrow, title }: { children: React.ReactNode; onClose: () => void; eyebrow: string; title: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return <ScrollView style={[styles.sheet, { backgroundColor: colors.background }]} contentContainerStyle={[styles.sheetContent, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 12), paddingBottom: insets.bottom + 26 }]} keyboardShouldPersistTaps="handled"><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.sheetClose}><Feather name="x" size={21} color={colors.foreground} /></Pressable><ScreenHeader eyebrow={eyebrow} title={title} />{children}</ScrollView>;
}

function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.backLink}><Feather name="arrow-left" size={16} color={colors.primary} /><Text style={[styles.signOutText, { color: colors.primary }]}>{label}</Text></Pressable>;
}

function EmptyState({ icon, title, detail, action, onAction }: { icon: keyof typeof Feather.glyphMap; title: string; detail: string; action?: string; onAction?: () => void }) {
  const colors = useColors();
  return <Card tone="soft" style={styles.emptyState}><View style={[styles.emptyIcon, { backgroundColor: colors.card }]}><Feather name={icon} size={19} color={colors.primary} /></View><Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{detail}</Text>{action && onAction ? <Button label={action} icon="refresh-cw" variant="secondary" onPress={onAction} /> : null}</Card>;
}

function SkeletonCard() {
  const colors = useColors();
  return <View style={[styles.skeleton, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: '42%' }]} /><View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: '84%' }]} /><View style={[styles.skeletonLine, { backgroundColor: colors.muted, width: '64%' }]} /></View>;
}

function InlineNotice({ message, error }: { message: string; error?: boolean }) {
  const colors = useColors();
  return <View style={[styles.inlineNotice, { backgroundColor: error ? colors.destructive : colors.accent }]}><Feather name={error ? 'alert-circle' : 'info'} size={16} color={error ? colors.destructiveForeground : colors.accentForeground} /><Text style={[styles.bodyText, { color: error ? colors.destructiveForeground : colors.accentForeground }]}>{message}</Text></View>;
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  topBar: { minHeight: 67, paddingHorizontal: 18, paddingBottom: 11, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.4 },
  brandSub: { fontFamily: 'Inter_500Medium', fontSize: 10, marginTop: 2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  unreadDot: { position: 'absolute', right: 8, top: 8, width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1 },
  pageContent: { paddingHorizontal: 18, paddingTop: 20, gap: 13 },
  tabbar: { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 64, paddingHorizontal: 8, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-around' },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabIcon: { width: 42, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  centerScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 25 },
  statusPage: { flex: 1, justifyContent: 'center', gap: 18, paddingHorizontal: 24 },
  statusGlyph: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  setupScreen: { flex: 1 },
  setupContent: { paddingHorizontal: 21, paddingTop: 24, paddingBottom: 30, gap: 14 },
  setupTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  signOutText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.5 },
  setupTitle: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  bodyText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  setupOptions: { gap: 10, marginTop: 8 },
  setupOption: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, borderRadius: 17, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10 },
  setupOptionIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 4 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, lineHeight: 19 },
  maintainerCard: { marginTop: 6, gap: 12 },
  setupForm: { marginTop: 8, gap: 15 },
  errorText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 17 },
  privacyNote: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 12, paddingHorizontal: 5 },
  childState: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 17 },
  stateShield: { width: 60, height: 60, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  childTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 34, letterSpacing: -0.7 },
  deadline: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  privacyCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  familyHero: { gap: 8, padding: 20 },
  heroFamilyMark: { width: 38, height: 38, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  heroEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.4 },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 25, lineHeight: 31, letterSpacing: -0.6 },
  heroText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  approvalBanner: { borderRadius: 15, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  quickActions: { flexDirection: 'row', gap: 10 },
  actionTile: { flex: 1, minHeight: 125, borderWidth: 1, borderRadius: 17, padding: 13, gap: 7 },
  iconTile: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  metricsRow: { flexDirection: 'row', gap: 10 },
  metricCard: { flex: 1, minHeight: 114, borderRadius: 17, borderWidth: 1, padding: 14, gap: 5 },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.4 },
  metricLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  managerCard: { gap: 14 },
  managerCardHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  teamHero: { gap: 8, padding: 20 },
  teamBadge: { width: 39, height: 39, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  privacyStrip: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 13, alignItems: 'flex-start' },
  reportRow: { minHeight: 92, borderWidth: 1, borderRadius: 17, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  reportIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  reportMeta: { fontFamily: 'Inter_500Medium', fontSize: 10, marginTop: 4 },
  statusPill: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 9, textTransform: 'capitalize' },
  roundAction: { width: 42, height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'flex-start', gap: 10, padding: 17 },
  emptyIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  skeleton: { padding: 15, borderWidth: 1, borderRadius: 17, gap: 11 },
  skeletonLine: { height: 11, borderRadius: 7, opacity: 0.7 },
  mapCanvas: { height: 315, borderWidth: 1, borderRadius: 22, overflow: 'hidden', position: 'relative' },
  mapLine: { position: 'absolute', borderRadius: 20, opacity: 0.9 },
  mapRoadA: { width: '150%', height: 12, left: '-22%', top: '44%', transform: [{ rotate: '-28deg' }] },
  mapRoadB: { width: '130%', height: 8, left: '-10%', top: '69%', transform: [{ rotate: '20deg' }] },
  mapRoadC: { width: '115%', height: 8, left: '8%', top: '26%', transform: [{ rotate: '64deg' }] },
  mapLabel: { position: 'absolute', fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.3 },
  mapLabelNorth: { top: 17, left: 17 },
  mapLabelSouth: { bottom: 15, right: 18 },
  heatDot: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  markerDot: { position: 'absolute', width: 27, height: 27, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginLeft: -13, marginTop: -13, zIndex: 2 },
  mapLegend: { borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendCircle: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontFamily: 'Inter_500Medium', fontSize: 11, color: '#536970' },
  privacyStripInline: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  requestCard: { gap: 13 },
  requestIdentity: { flexDirection: 'row', gap: 11, alignItems: 'center' },
  avatarInitial: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  requestActions: { flexDirection: 'row', gap: 9 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  memberStatus: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10 },
  memberStatusText: { fontFamily: 'Inter_700Bold', fontSize: 10, textTransform: 'capitalize' },
  invitationCode: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: 2 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 4 },
  noticeRow: { borderWidth: 1, borderRadius: 17, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  noticeIcon: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  unreadSmall: { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accessNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  formCard: { gap: 14 },
  switchRow: { flexDirection: 'row', gap: 8 },
  roleChip: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingHorizontal: 8 },
  roleChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  inviteResult: { gap: 12 },
  inviteCode: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: 2 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choiceChip: { borderRadius: 12, borderWidth: 1, minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7 },
  choiceText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  addPhoto: { minHeight: 48, borderWidth: 1, borderStyle: 'dashed', borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  photoPreview: { height: 160, borderRadius: 15, overflow: 'hidden', position: 'relative' },
  photoImage: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', right: 8, top: 8, width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  reportFootnote: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15 },
  sheet: { flex: 1 },
  sheetContent: { paddingHorizontal: 20, gap: 13 },
  sheetClose: { alignSelf: 'flex-end', width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  detailCard: { gap: 13 },
  detailSummary: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 24 },
  factRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  factLabel: { width: 108, fontFamily: 'Inter_500Medium', fontSize: 11 },
  factValue: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 11, lineHeight: 16 },
  reportPhoto: { width: '100%', height: 215, borderRadius: 18 },
  travelContainer: { minHeight: 480, borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  inlineNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 13 },
});