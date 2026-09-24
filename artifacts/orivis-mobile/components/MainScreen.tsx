import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteMap } from '@/components/RouteMap';
import { JourneyScreen } from '@/components/JourneyScreen';
import {
  BrandMark,
  Button,
  Card,
  Chip,
  Divider,
  Field,
  IconButton,
  Metric,
  ScreenHeader,
  SectionTitle,
} from '@/components/OrivisUI';
import {
  REPORT_CATEGORIES,
  ROLE_LABELS,
  heatColor,
  heatScore,
  type CaseStatus,
  type ReportCategory,
  type Role,
  type SafetyReport,
  type TripStep,
  useDemo,
} from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';
import { reportError } from '@/lib/reportApi';

type TabKey = 'home' | 'map' | 'reports' | 'alerts' | 'rewards' | 'tasks' | 'profile';
type ModalName = 'report' | 'sos' | 'case' | 'verify' | null;

const tripSteps: { value: TripStep; title: string; subtitle: string; icon: keyof typeof Feather.glyphMap }[] = [
  { value: 'waiting', title: 'Ready at stop', subtitle: 'Willow St & Bird Ave', icon: 'map-pin' },
  { value: 'boarded', title: 'Boarded bus', subtitle: 'VTA Route 22', icon: 'navigation' },
  { value: 'off', title: 'Got off bus', subtitle: 'Bird Ave & Minnesota', icon: 'log-out' },
  { value: 'arrived', title: 'Reached destination', subtitle: 'River Glen Elementary', icon: 'check-circle' },
];

function tabsForRole(role: Role): { key: TabKey; label: string; icon: keyof typeof Feather.glyphMap }[] {
  if (role === 'manager') {
    return [
      { key: 'home', label: 'Overview', icon: 'grid' },
      { key: 'map', label: 'Map', icon: 'map' },
      { key: 'reports', label: 'Cases', icon: 'inbox' },
      { key: 'profile', label: 'More', icon: 'menu' },
    ];
  }
  if (role === 'worker') {
    return [
      { key: 'home', label: 'Today', icon: 'home' },
      { key: 'map', label: 'Route', icon: 'map' },
      { key: 'tasks', label: 'Tasks', icon: 'check-square' },
      { key: 'profile', label: 'More', icon: 'menu' },
    ];
  }
  return [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'map', label: 'Journey', icon: 'map' },
    { key: 'reports', label: 'Report', icon: 'camera' },
    { key: 'rewards', label: 'Rewards', icon: 'award' },
    { key: 'profile', label: 'More', icon: 'menu' },
  ];
}

export function MainScreen({
  verificationAccount,
  onVerified,
}: {
  verificationAccount: { name: string; username: string; role: Role } | null;
  onVerified: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state } = useDemo();
  const role = state.account?.role ?? verificationAccount?.role ?? 'parent';
  const tabs = tabsForRole(role);
  const [tab, setTab] = useState<TabKey>('home');
  const [modal, setModal] = useState<ModalName>(verificationAccount && !state.account ? 'verify' : null);
  const [selectedReport, setSelectedReport] = useState<SafetyReport | null>(null);

  useEffect(() => {
    if (verificationAccount && !state.account) setModal('verify');
  }, [verificationAccount, state.account]);

  const openCase = (report: SafetyReport) => {
    setSelectedReport(report);
    setModal('case');
  };

  return (
    <View style={[styles.app, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topbar,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 8),
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.brand}>
          <BrandMark size={36} />
          <Text style={[styles.brandText, { color: colors.foreground }]}>Orivis</Text>
        </View>
        <View style={styles.topActions}>
          {role === 'child' ? (
            <Pressable
              testID="sos-top"
              onPress={() => setModal('sos')}
              style={({ pressed }) => [styles.sosPill, { backgroundColor: colors.destructive, opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="alert-triangle" size={14} color={colors.destructiveForeground} />
              <Text style={[styles.sosPillText, { color: colors.destructiveForeground }]}>SOS</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setTab('alerts')}
            style={({ pressed }) => [styles.bell, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="bell" size={21} color={colors.foreground} />
            {state.notifications.some((notice) => notice.unread) ? <View style={[styles.unread, { backgroundColor: colors.destructive }]} /> : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        {tab === 'home' ? <Home role={role} onNavigate={setTab} onReport={() => setModal('report')} onSOS={() => setModal('sos')} onCase={openCase} /> : null}
        {tab === 'map' ? role === 'parent' || role === 'child' ? <JourneyScreen /> : <MapScreen role={role} onCase={openCase} /> : null}
        {tab === 'reports' ? <ReportsScreen role={role} onCreate={() => setModal('report')} onCase={openCase} /> : null}
        {tab === 'tasks' ? <WorkerTasks onCase={openCase} /> : null}
        {tab === 'rewards' ? <RewardsScreen /> : null}
        {tab === 'alerts' ? <AlertsScreen /> : null}
        {tab === 'profile' ? <ProfileScreen /> : null}
      </View>

      {tab !== 'alerts' ? (
        <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: colors.card, borderTopColor: colors.border }]}>
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                testID={`tab-${item.key}`}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setTab(item.key);
                }}
                style={styles.tab}
              >
                <View style={[styles.tabIcon, { backgroundColor: active ? colors.secondary : 'transparent' }]}>
                  <Feather name={item.icon} size={20} color={active ? colors.primary : colors.mutedForeground} />
                </View>
                <Text style={[styles.tabText, { color: active ? colors.primary : colors.mutedForeground }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Modal visible={modal === 'verify'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => undefined}>
        {verificationAccount ? <VerifyScreen account={verificationAccount} onDone={() => { onVerified(); setModal(null); }} /> : null}
      </Modal>
      <Modal visible={modal === 'report'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(null)}>
        <ReportComposer onClose={() => setModal(null)} />
      </Modal>
      <Modal visible={modal === 'sos'} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setModal(null)}>
        <SOSScreen onClose={() => setModal(null)} />
      </Modal>
      <Modal visible={modal === 'case'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModal(null)}>
        {selectedReport ? <CaseDetail report={selectedReport} role={role} onClose={() => setModal(null)} /> : null}
      </Modal>
    </View>
  );
}

function ScreenScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

function Home({
  role,
  onNavigate,
  onReport,
  onSOS,
  onCase,
}: {
  role: Role;
  onNavigate: (tab: TabKey) => void;
  onReport: () => void;
  onSOS: () => void;
  onCase: (report: SafetyReport) => void;
}) {
  const colors = useColors();
  const { state, updateTripStep, reportBusDelay } = useDemo();
  const nowGreeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  if (role === 'manager') return <ManagerHome onCase={onCase} />;
  if (role === 'worker') return <WorkerHome onCase={onCase} />;

  const currentIndex = tripSteps.findIndex((step) => step.value === state.tripStep);
  const nextStep = tripSteps[Math.min(currentIndex + 1, tripSteps.length - 1)];
  const journey = state.selectedJourney;
  const routeName = journey?.name ?? 'VTA Route 22';
  const startStop = journey?.startStop ?? 'Willow St & Bird Ave';
  const destinationStop = journey?.destinationStop ?? 'Bird Ave & Minnesota';
  const delay = Math.max(journey?.delayMinutes ?? 0, state.busDelayed ? 8 : 0);
  return (
    <ScreenScroll>
      <ScreenHeader
        eyebrow={ROLE_LABELS[role]}
        title={`${nowGreeting}, ${state.account?.name.split(' ')[0] ?? 'there'}.`}
        subtitle={role === 'parent' ? `${state.child.name}’s planned trip is ready.` : 'Your route is ready. Check in at each step.'}
      />

      <LinearGradient colors={[colors.navy, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.journeyHero}>
        <View style={styles.heroTop}>
          <View style={styles.routeBadge}>
            <Feather name="navigation" size={14} color={colors.primaryForeground} />
             <Text style={[styles.heroEyebrow, { color: colors.primaryForeground }]}>{routeName.toUpperCase()} · {journey?.source === 'live' ? 'LIVE ROUTE' : 'DEMO ROUTE'}</Text>
          </View>
           {delay > 0 ? (
            <View style={styles.delayBadge}>
               <Text style={[styles.delayText, { color: colors.destructiveForeground }]}>{delay} min delay</Text>
            </View>
          ) : null}
        </View>
         <Text style={[styles.heroTitle, { color: colors.primaryForeground }]} numberOfLines={2}>{startStop}</Text>
        <View style={styles.routeLine}>
          <View style={[styles.routePoint, { borderColor: colors.primaryForeground }]} />
          <View style={[styles.routeTrack, { backgroundColor: colors.primaryForeground }]} />
          <Feather name="flag" size={17} color={colors.primaryForeground} />
        </View>
         <Text style={[styles.heroDestination, { color: colors.primaryForeground }]}>{destinationStop}{journey ? ` · ${journey.durationMinutes} min` : ' · River Glen Elementary'}</Text>
        <View style={styles.heroFooter}>
          <View>
            <Text style={[styles.heroMeta, { color: colors.primaryForeground }]}>
              {state.tripStep === 'waiting' ? 'Awaiting first check-in' : `${tripSteps[currentIndex].title} confirmed`}
            </Text>
            <Text style={[styles.heroSub, { color: colors.primaryForeground }]}>Planned route only · no live tracking</Text>
             {state.tripUpdatedAt ? <Text style={[styles.heroSub, { color: colors.primaryForeground }]}>Updated {formatTime(state.tripUpdatedAt)}</Text> : null}
          </View>
          <Pressable onPress={() => onNavigate('map')} style={[styles.mapIcon, { backgroundColor: colors.primaryForeground }]}>
            <Feather name="map" size={18} color={colors.primary} />
          </Pressable>
        </View>
      </LinearGradient>

      {role === 'child' ? (
        <>
          <SectionTitle title="Your next check-in" />
          <Card>
            <View style={styles.nextStep}>
              <View style={[styles.bigStepIcon, { backgroundColor: colors.secondary }]}>
                <Feather name={nextStep.icon} size={25} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{nextStep.title}</Text>
                 <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{state.tripStep === 'boarded' ? destinationStop : state.tripStep === 'off' ? journey?.destination ?? state.child.school : startStop}</Text>
              </View>
            </View>
            <Button
               label={state.tripStep === 'arrived' ? 'Journey complete' : state.tripStep === 'waiting' ? 'I boarded the bus' : state.tripStep === 'boarded' ? 'I got off the bus' : 'I reached my destination'}
              icon="check"
              disabled={state.tripStep === 'arrived'}
               onPress={() => {
                 updateTripStep(nextStep.value);
                 Alert.alert('Check-in confirmed', `Your ${nextStep.title.toLowerCase()} update is on the parent dashboard. An in-app and simulated text alert were created.`);
               }}
            />
          </Card>
          <View style={styles.twoColumns}>
            <Pressable onPress={onReport} style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.quickIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="camera" size={22} color={colors.primary} />
              </View>
              <Text style={[styles.quickTitle, { color: colors.foreground }]}>Report an issue</Text>
              <Text style={[styles.quickSub, { color: colors.mutedForeground }]}>Photo, note & pin</Text>
            </Pressable>
             <Pressable onPress={() => { reportBusDelay(); Alert.alert('Delay reported', 'An in-app and simulated text notification were added for your family.'); }} style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.quickIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="clock" size={22} color={colors.warning} />
              </View>
               <Text style={[styles.quickTitle, { color: colors.foreground }]}>Report Bus Delay</Text>
              <Text style={[styles.quickSub, { color: colors.mutedForeground }]}>Notify your family</Text>
            </Pressable>
          </View>
          <Pressable onPress={onSOS} style={[styles.sosCard, { backgroundColor: colors.destructive }]}>
            <View style={styles.sosCopy}>
              <Text style={[styles.sosTitle, { color: colors.destructiveForeground }]}>Need help?</Text>
              <Text style={[styles.sosSub, { color: colors.destructiveForeground }]}>Start a simulated safety session</Text>
            </View>
            <View style={[styles.sosCircle, { backgroundColor: colors.destructiveForeground }]}>
              <Feather name="alert-triangle" size={24} color={colors.destructive} />
            </View>
          </Pressable>
        </>
      ) : (
        <>
          <SectionTitle title={`${state.child.name}’s progress`} />
          <Card>
            {tripSteps.map((step, index) => {
              const complete = index <= currentIndex && state.tripStep !== 'waiting';
              const current = index === currentIndex;
              return (
                <View key={step.value} style={styles.timelineRow}>
                  <View style={styles.timelineVisual}>
                    <View style={[styles.timelineDot, { backgroundColor: complete ? colors.success : current ? colors.primary : colors.muted, borderColor: current ? colors.primary : colors.border }]}>
                      {complete ? <Feather name="check" size={11} color={colors.primaryForeground} /> : null}
                    </View>
                    {index < tripSteps.length - 1 ? <View style={[styles.timelineBar, { backgroundColor: complete ? colors.success : colors.border }]} /> : null}
                  </View>
                  <View style={[styles.timelineCopy, index < tripSteps.length - 1 ? { paddingBottom: 17 } : null]}>
                    <Text style={[styles.timelineTitle, { color: colors.foreground }]}>{step.title}</Text>
                     <Text style={[styles.timelineSub, { color: colors.mutedForeground }]}>{index === 0 || index === 1 ? startStop : index === 2 ? destinationStop : journey?.destination ?? state.child.school}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
           {state.tripUpdatedAt ? <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Latest child update: {formatTime(state.tripUpdatedAt)} · {tripSteps[currentIndex]?.title}</Text> : null}
          <SectionTitle title="Family snapshot" />
          <Card>
            <View style={styles.metrics}>
              <Metric value={`${state.rewardPoints}`} label="Reward points" icon="award" />
              <Metric value={`${state.reports.filter((r) => r.status === 'Resolved').length}`} label="Resolved reports" icon="check-circle" />
              <Metric value={`${state.notifications.filter((n) => n.unread).length}`} label="New alerts" icon="bell" />
            </View>
          </Card>
          <SectionTitle title="Community action" action="See reports" onAction={() => onNavigate('reports')} />
          <Card style={styles.communityCard} tone="soft">
            <View style={styles.communityText}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Make the neighborhood safer</Text>
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Submit a photo and note. Sample AI will organize the case for review.</Text>
            </View>
            <Button label="Report issue" icon="camera" onPress={onReport} />
          </Card>
        </>
      )}
    </ScreenScroll>
  );
}

function ManagerHome({ onCase }: { onCase: (report: SafetyReport) => void }) {
  const colors = useColors();
  const { state, assignReports } = useDemo();
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const active = state.reports.filter((report) => report.status !== 'Resolved');
  const high = active.filter((report) => report.severity >= 8);
  const unassigned = active.filter((report) => !report.assignedTeam);
  return (
    <ScreenScroll>
      <ScreenHeader eyebrow="City case manager" title="Community operations" subtitle="Santa Clara County · prototype data" />
      <Card>
        <View style={styles.metrics}>
          <Metric value={`${active.length}`} label="Open cases" icon="inbox" />
          <Metric value={`${high.length}`} label="High severity" icon="alert-circle" />
          <Metric value={`${unassigned.length}`} label="Unassigned" icon="users" />
        </View>
      </Card>
      <SectionTitle title="Safety concentration" />
      <RouteMap reports={state.reports} heat cityRoute height={280} />
      <SectionTitle title="Suggested cleanup route" />
      <Card>
        <View style={styles.routeSummary}>
          <View style={[styles.routeNumber, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.routeNumberText, { color: colors.primary }]}>A1</Text>
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>West corridor priority route</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>3 nearby reports · severity weighted · 6.4 mi</Text>
          </View>
        </View>
        <Button
          label="Delegate to West Clean Team"
          icon="send"
          onPress={() => {
            if (assigning) return;
            setAssigning(true);
            setAssignError('');
            void assignReports(unassigned.slice(0, 3).map((report) => report.id), 'San Jose – West Clean Team')
              .catch((error) => setAssignError(reportError(error)))
              .finally(() => setAssigning(false));
          }}
          loading={assigning}
        />
      </Card>
      {assignError ? <Text style={[styles.cardBody, { color: colors.destructive }]}>{assignError}</Text> : null}
      <SectionTitle title="Priority cases" />
      {active.slice(0, 3).map((report) => <CaseRow key={report.id} report={report} onPress={() => onCase(report)} />)}
    </ScreenScroll>
  );
}

function WorkerHome({ onCase }: { onCase: (report: SafetyReport) => void }) {
  const colors = useColors();
  const { state } = useDemo();
  const tasks = state.reports.filter((report) => report.assignedTeam === 'San Jose – West Clean Team' && report.status !== 'Resolved');
  return (
    <ScreenScroll>
      <ScreenHeader eyebrow="City worker" title="Your route today" subtitle="San Jose – West Clean Team" />
      <RouteMap reports={tasks} cityRoute height={280} />
      <SectionTitle title="Route summary" />
      <Card>
        <View style={styles.metrics}>
          <Metric value={`${tasks.length}`} label="Assigned stops" icon="map-pin" />
          <Metric value="6.4 mi" label="Planned route" icon="navigation" />
          <Metric value={`${Math.max(...tasks.map((task) => task.severity), 0)}/10`} label="Top severity" icon="alert-circle" />
        </View>
      </Card>
      <SectionTitle title="Next assignments" />
      {tasks.map((report) => <CaseRow key={report.id} report={report} onPress={() => onCase(report)} />)}
    </ScreenScroll>
  );
}

function MapScreen({ role, onCase }: { role: Role; onCase: (report: SafetyReport) => void }) {
  const colors = useColors();
  const { state } = useDemo();
  const [selected, setSelected] = useState<string | undefined>();
  const reports = role === 'worker' ? state.reports.filter((report) => report.assignedTeam === 'San Jose – West Clean Team') : state.reports;
  const selectedReport = reports.find((report) => report.id === selected);
  return (
    <ScreenScroll>
      <ScreenHeader
        eyebrow={role === 'manager' ? 'Heat map' : role === 'worker' ? 'Assigned route' : 'Planned journey'}
        title={role === 'manager' ? 'Where attention is needed' : role === 'worker' ? 'West team route' : 'Route 22 to River Glen'}
        subtitle={role === 'manager' ? 'Intensity combines report count, severity, type, and recency.' : 'This prototype shows planned routes and check-ins, not live child tracking.'}
      />
      <RouteMap
        reports={reports}
        heat={role === 'manager'}
        cityRoute={role === 'manager' || role === 'worker'}
        selectedId={selected}
        onSelect={setSelected}
        height={390}
      />
      {selectedReport ? (
        <Pressable onPress={() => onCase(selectedReport)} style={[styles.mapSelection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.severity, { backgroundColor: heatColor(heatScore(selectedReport, reports)) }]}>
            <Text style={styles.severityText}>{selectedReport.severity}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{selectedReport.category}</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]} numberOfLines={2}>{selectedReport.description}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
      <SectionTitle title="Map layers" />
      <View style={styles.wrap}>
        <Chip label="Bus stops" active />
        <Chip label="Route 22" active />
        {(role === 'manager' || role === 'worker') ? <Chip label="City routes" active tone="warning" /> : null}
        {role === 'manager' ? <Chip label="Safety heat" active tone="danger" /> : null}
        <Chip label="Issue reports" active />
      </View>
      {role !== 'manager' && role !== 'worker' ? (
        <Card tone="soft">
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Nearest stop</Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Willow St & Bird Ave · 0.2 mi away</Text>
          <Divider />
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Scheduled departure</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>7:42 AM</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Destination stop</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>Bird & Minnesota</Text>
          </View>
        </Card>
      ) : null}
    </ScreenScroll>
  );
}

function ReportsScreen({ role, onCreate, onCase }: { role: Role; onCreate: () => void; onCase: (report: SafetyReport) => void }) {
  const colors = useColors();
  const { state, reportsError, reportsLoading } = useDemo();
  const [filter, setFilter] = useState<'All' | CaseStatus>('All');
  const reports = filter === 'All' ? state.reports : state.reports.filter((report) => report.status === filter);
  return (
    <ScreenScroll>
      <ScreenHeader
        eyebrow={role === 'manager' ? 'Case queue' : 'Community safety'}
        title={role === 'manager' ? 'Review every report' : 'Improve your neighborhood'}
        subtitle={role === 'manager' ? 'Open a case to edit its analysis, severity, category, status, or assignment.' : 'Sample AI organizes reports before a city case manager reviews them.'}
        right={role !== 'manager' ? <IconButton icon="plus-circle" onPress={onCreate} color={colors.primary} /> : undefined}
      />
      {reportsError ? (
        <Card tone="danger">
          <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>
            Shared reports are unavailable. Showing reports saved on this device; new submissions and edits need the connection.
          </Text>
        </Card>
      ) : reportsLoading ? (
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Syncing shared cases…</Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {(['All', 'Submitted', 'Under Review', 'Assigned', 'Resolved'] as const).map((item) => (
          <Chip key={item} label={item} active={filter === item} onPress={() => setFilter(item)} />
        ))}
      </ScrollView>
      <View style={styles.reportList}>
        {reports.map((report) => <CaseRow key={report.id} report={report} onPress={() => onCase(report)} />)}
      </View>
      {role !== 'manager' ? <Button label="Create community report" icon="camera" onPress={onCreate} /> : null}
    </ScreenScroll>
  );
}

function WorkerTasks({ onCase }: { onCase: (report: SafetyReport) => void }) {
  const colors = useColors();
  const { state } = useDemo();
  const tasks = state.reports.filter((report) => report.assignedTeam === 'San Jose – West Clean Team');
  return (
    <ScreenScroll>
      <ScreenHeader eyebrow="Assigned work" title="Cleanup tasks" subtitle="You can analyze task details and update status only." />
      {tasks.length ? tasks.map((report) => <CaseRow key={report.id} report={report} onPress={() => onCase(report)} />) : (
        <Card>
          <Feather name="check-circle" size={28} color={colors.success} />
          <Text style={[styles.cardTitle, { color: colors.foreground, marginTop: 12 }]}>All caught up</Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>No assignments are waiting for this team.</Text>
        </Card>
      )}
    </ScreenScroll>
  );
}

function RewardsScreen() {
  const colors = useColors();
  const { state, redeemReward } = useDemo();
  const rewards = [
    { name: 'First Street Coffee · $3 off', cost: 200, icon: 'coffee' as const },
    { name: 'Cloud Boba · free topping', cost: 150, icon: 'droplet' as const },
    { name: 'Neighborhood Café · free drink', cost: 400, icon: 'gift' as const },
  ];
  return (
    <ScreenScroll>
      <ScreenHeader eyebrow="Family rewards" title={`${state.rewardPoints} points`} subtitle="Earned when a verified community report is resolved." />
      <LinearGradient colors={[colors.primary, colors.navy]} style={styles.rewardHero}>
        <Feather name="award" size={32} color={colors.primaryForeground} />
        <Text style={[styles.rewardHeroTitle, { color: colors.primaryForeground }]}>Good actions add up.</Text>
        <Text style={[styles.rewardHeroSub, { color: colors.primaryForeground }]}>Your family has helped resolve {state.reports.filter((r) => r.status === 'Resolved').length} neighborhood issue.</Text>
      </LinearGradient>
      <SectionTitle title="Partner rewards" />
      {rewards.map((reward) => (
        <Card key={reward.name} style={styles.rewardCard}>
          <View style={[styles.rewardIcon, { backgroundColor: colors.secondary }]}>
            <Feather name={reward.icon} size={22} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{reward.name}</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{reward.cost} points · simulated partner</Text>
          </View>
          <Pressable
            disabled={state.rewardPoints < reward.cost}
            onPress={() => {
              const okay = redeemReward(reward.name, reward.cost);
              if (okay) Alert.alert('Reward redeemed', 'This is a simulated redemption for the Orivis prototype.');
            }}
            style={({ pressed }) => [styles.redeem, { backgroundColor: colors.secondary, opacity: state.rewardPoints < reward.cost ? 0.35 : pressed ? 0.6 : 1 }]}
          >
            <Feather name="arrow-right" size={17} color={colors.primary} />
          </Pressable>
        </Card>
      ))}
      <SectionTitle title="Point history" />
      <Card>
        {state.rewardHistory.map((entry, index) => (
          <View key={`${entry}-${index}`}>
            <Text style={[styles.historyText, { color: colors.foreground }]}>{entry}</Text>
            {index < state.rewardHistory.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </Card>
    </ScreenScroll>
  );
}

function AlertsScreen() {
  const colors = useColors();
  const { state, markNotificationsRead } = useDemo();
  useEffect(() => {
    const id = setTimeout(markNotificationsRead, 600);
    return () => clearTimeout(id);
  }, [markNotificationsRead]);
  return (
    <ScreenScroll>
      <ScreenHeader eyebrow="Activity" title="Notifications" subtitle="Real push and text delivery are not connected in this prototype." />
      {state.notifications.map((notice) => (
        <Card key={notice.id} style={styles.notice}>
          <View style={[styles.noticeIcon, { backgroundColor: notice.kind === 'SOS' ? colors.destructive : colors.secondary }]}>
            <Feather
              name={notice.kind === 'SOS' ? 'alert-triangle' : notice.kind === 'Reward' ? 'award' : notice.kind === 'Case' ? 'clipboard' : 'bell'}
              size={18}
              color={notice.kind === 'SOS' ? colors.destructiveForeground : colors.primary}
            />
          </View>
          <View style={styles.flex}>
            <View style={styles.noticeTitleRow}>
              <Text style={[styles.cardTitle, { color: colors.foreground, flex: 1 }]}>{notice.title}</Text>
              {notice.unread ? <View style={[styles.noticeUnread, { backgroundColor: colors.primary }]} /> : null}
            </View>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{notice.body}</Text>
            <Text style={[styles.noticeMeta, { color: colors.mutedForeground }]}>{notice.channel ?? 'In-app'} · {formatTime(notice.createdAt)}</Text>
          </View>
        </Card>
      ))}
    </ScreenScroll>
  );
}

function ProfileScreen() {
  const colors = useColors();
  const { state, signOut, resetDemo, simulateMissedCheckin } = useDemo();
  return (
    <ScreenScroll>
      <ScreenHeader eyebrow={state.account ? ROLE_LABELS[state.account.role] : 'Account'} title={state.account?.name ?? 'Orivis demo'} subtitle={state.account?.username ?? 'Sample account'} />
      <Card>
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
            <Feather name="user" size={24} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{state.familyName}</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{state.child.name} · {state.child.school}</Text>
          </View>
        </View>
      </Card>
      <SectionTitle title="Prototype controls" />
      {(state.account?.role === 'parent' || state.account?.role === 'child') ? (
        <Card style={styles.controlCard}>
          <View style={styles.controlCopy}>
            <Feather name="clock" size={20} color={colors.warning} />
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Missed check-in demo</Text>
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Creates an in-app alert and simulated parent text.</Text>
            </View>
          </View>
          <Button label="Simulate missed check-in" variant="secondary" onPress={simulateMissedCheckin} />
        </Card>
      ) : null}
      <Card style={styles.controlCard}>
        <View style={styles.controlCopy}>
          <Feather name="refresh-cw" size={20} color={colors.primary} />
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Reset Demonstration Data</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Restores sample users, routes, reports, rewards, notifications, and SOS state.</Text>
          </View>
        </View>
        <Button
          label="Reset demo"
          variant="secondary"
          onPress={() => Alert.alert('Reset demonstration data?', 'This restores the original Orivis sample state.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset', style: 'destructive', onPress: resetDemo },
          ])}
        />
      </Card>
      <Card tone="soft">
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Prototype limitations</Text>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
          Authentication, AI analysis, notifications, partner rewards, police contact, and SOS behavior are simulated. Journey routes use Google Maps and 511 SF Bay when configured and available; otherwise the Journey page labels its demo fallback. City issue maps remain illustrative.
        </Text>
      </Card>
      <Button label="Sign out" icon="log-out" variant="ghost" onPress={signOut} />
    </ScreenScroll>
  );
}

function VerifyScreen({ account, onDone }: { account: { name: string; username: string; role: Role }; onDone: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { setAccount } = useDemo();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <View style={[styles.verify, { backgroundColor: colors.background, paddingTop: insets.top + 38, paddingBottom: insets.bottom + 24 }]}>
      <View style={[styles.verifyIcon, { backgroundColor: colors.secondary }]}>
        <Feather name="shield" size={34} color={colors.primary} />
      </View>
      <Text style={[styles.verifyTitle, { color: colors.foreground }]}>One more quick check.</Text>
      <Text style={[styles.verifySub, { color: colors.mutedForeground }]}>
        Enter the prototype verification code for {ROLE_LABELS[account.role].toLowerCase()} access.
      </Text>
      <Field label="Verification code" value={code} onChangeText={(value) => { setCode(value); setError(''); }} keyboardType="number-pad" maxLength={4} error={error} testID="verification-code" />
      <Button
        label="Verify and continue"
        icon="check"
        testID="verify"
        onPress={() => {
          if (code !== '1234') {
            setError('Use 1234 for this prototype.');
            return;
          }
          setAccount(account);
          onDone();
        }}
      />
      <Text style={[styles.demoCode, { color: colors.mutedForeground }]}>Demo code: 1234</Text>
    </View>
  );
}

function ReportComposer({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { createReport } = useDemo();
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('Downtown San Jose');
  const [category, setCategory] = useState<ReportCategory | undefined>();
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [photoBase64, setPhotoBase64] = useState<string | undefined>();
  const [contentType, setContentType] = useState<'image/jpeg' | 'image/png' | 'image/webp' | undefined>();
  const [error, setError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, base64: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) throw new Error('This photo could not be read. Please choose another image.');
      const mime = asset.mimeType || 'image/jpeg';
      if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
        throw new Error('Choose a JPEG, PNG, or WebP photo.');
      }
      if (asset.base64.length > 2_796_204) throw new Error('Choose a photo smaller than 2 MB.');
      setPhotoUri(asset.uri);
      setPhotoBase64(asset.base64);
      setContentType(mime);
      setSubmitError('');
    } catch (error) {
      setSubmitError(reportError(error));
    }
  };
  const submit = async () => {
    if (submitting) return;
    if (description.trim().length < 12) {
      setError('Add a short description with at least 12 characters.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await createReport({ description, location, category, photoBase64, contentType });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
      if (Platform.OS !== 'web') Alert.alert('Report submitted', 'Your report was saved for city review.');
    } catch (error) {
      setSubmitError(reportError(error));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <KeyboardAvoidingView style={[styles.modalPage, { backgroundColor: colors.background }]} behavior="padding">
      <View style={[styles.modalHeader, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
        <IconButton icon="x" onPress={onClose} />
        <Text style={[styles.modalTitle, { color: colors.foreground }]}>Community report</Text>
        <View style={{ width: 42 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.modalScroll, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
        <Card tone="soft">
          <View style={styles.aiIntro}>
            <Feather name="cpu" size={21} color={colors.primary} />
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Simulated AI review</Text>
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Orivis will create a sample category, severity score, department, and priority from your description. Your submitted report is saved to the shared case queue.</Text>
            </View>
          </View>
        </Card>
        <SectionTitle title="Photo" />
        <Pressable onPress={selectPhoto} style={[styles.photoPicker, { backgroundColor: colors.card, borderColor: colors.input }]}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <>
              <View style={[styles.photoIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="camera" size={26} color={colors.primary} />
              </View>
              <Text style={[styles.photoTitle, { color: colors.foreground }]}>Choose a photo</Text>
              <Text style={[styles.photoSub, { color: colors.mutedForeground }]}>Uses your device photo library</Text>
            </>
          )}
        </Pressable>
        <SectionTitle title="What did you notice?" />
        <Field label="Description" value={description} onChangeText={(value) => { setDescription(value); setError(''); }} multiline placeholder="Describe the issue and why it may affect the community…" error={error} />
        <SectionTitle title="Optional category" />
        <View style={styles.wrap}>
          {REPORT_CATEGORIES.map((item) => <Chip key={item} label={item} active={category === item} onPress={() => setCategory(category === item ? undefined : item)} />)}
        </View>
        <SectionTitle title="Drop a map pin" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {['Downtown San Jose', 'Japantown', 'Willow Glen', 'East San Jose', 'Alum Rock', 'Santa Clara'].map((item) => (
            <Chip key={item} label={item} active={location === item} onPress={() => setLocation(item)} />
          ))}
        </ScrollView>
        <RouteMap height={210} />
        {submitError ? <Text style={[styles.cardBody, { color: colors.destructive }]}>{submitError}</Text> : null}
        <Button label="Submit for review" icon="send" onPress={() => { void submit(); }} loading={submitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CaseDetail({ report, role, onClose }: { report: SafetyReport; role: Role; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, updateManagerReport, updateWorkerStatus, assignReports } = useDemo();
  const current = state.reports.find((item) => item.id === report.id) ?? report;
  const [severity, setSeverity] = useState(`${current.severity}`);
  const [description, setDescription] = useState(current.description);
  const [category, setCategory] = useState(current.category);
  const [location, setLocation] = useState(current.location);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const canEdit = role === 'manager';
  const statuses: CaseStatus[] = ['Submitted', 'Under Review', 'Assigned', 'Resolved'];
  const runUpdate = async (action: () => Promise<void>, message: string) => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    setSaveMessage('');
    try {
      await action();
      setSaveMessage(message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setSaveError(reportError(error));
    } finally {
      setSaving(false);
    }
  };
  const save = () => {
    const score = Number(severity);
    if (description.trim().length < 12 || description.trim().length > 4000 || !Number.isInteger(score) || score < 1 || score > 10) {
      setSaveError('Enter a description of 12–4000 characters and a whole-number severity from 1–10.');
      return;
    }
    void runUpdate(() => updateManagerReport(current.id, { description: description.trim(), category, location, severity: score }), 'Case edits saved to the shared queue.');
  };
  return (
    <View style={[styles.modalPage, { backgroundColor: colors.background }]}>
      <View style={[styles.modalHeader, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
        <IconButton icon="x" onPress={onClose} />
        <Text style={[styles.modalTitle, { color: colors.foreground }]}>{current.id}</Text>
        <View style={{ width: 42 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.modalScroll, { paddingBottom: insets.bottom + 30 }]}>
        {current.photoUri ? <Image source={{ uri: current.photoUri }} style={styles.casePhoto} contentFit="cover" /> : (
          <View style={[styles.casePlaceholder, { backgroundColor: colors.secondary }]}>
            <Feather name="image" size={30} color={colors.primary} />
            <Text style={[styles.photoSub, { color: colors.mutedForeground }]}>Sample report image unavailable</Text>
          </View>
        )}
        <View style={styles.caseHeadline}>
          <View style={[styles.severityLarge, { backgroundColor: heatColor(heatScore(current, state.reports)) }]}>
            <Text style={styles.severityLargeValue}>{current.severity}</Text>
            <Text style={styles.severityLargeLabel}>severity</Text>
          </View>
          <View style={styles.flex}>
            <Text style={[styles.verifyTitle, { color: colors.foreground, fontSize: 25 }]}>{current.category}</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{current.location} · {formatTime(current.submittedAt)}</Text>
          </View>
        </View>
        <View style={styles.wrap}>
          <Chip label={current.status} active />
          <Chip label={`${current.priority} priority`} active tone={current.priority === 'High' ? 'danger' : 'warning'} />
        </View>
        <SectionTitle title="Report details" />
        {canEdit ? (
          <>
            <Field label="Description" value={description} onChangeText={setDescription} multiline />
            <Field label="Severity score (1–10)" value={severity} onChangeText={setSeverity} keyboardType="number-pad" />
            <Text style={[styles.fieldCaption, { color: colors.foreground }]}>Category</Text>
            <View style={styles.wrap}>
              {REPORT_CATEGORIES.map((item) => <Chip key={item} label={item} active={category === item} onPress={() => setCategory(item)} />)}
            </View>
            <Text style={[styles.fieldCaption, { color: colors.foreground }]}>Location</Text>
            <View style={styles.wrap}>
              {['Downtown San Jose', 'Japantown', 'Willow Glen', 'East San Jose', 'Alum Rock', 'Santa Clara'].map((item) => (
                <Chip key={item} label={item} active={location === item} onPress={() => setLocation(item)} />
              ))}
            </View>
            <Button label="Save case edits" icon="save" onPress={save} loading={saving} />
          </>
        ) : (
          <Card>
            <Text style={[styles.cardBody, { color: colors.foreground }]}>{current.description}</Text>
          </Card>
        )}
        <Card tone="soft">
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Recommended department</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{current.recommendedDepartment}</Text>
          </View>
          <Divider />
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Assigned team</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{current.assignedTeam ?? 'Not assigned'}</Text>
          </View>
        </Card>
        {(role === 'manager' || role === 'worker') ? (
          <>
            <SectionTitle title="Case status" />
            <View style={styles.wrap}>
              {statuses.map((status) => (
                <Chip
                  key={status}
                  label={status}
                  active={current.status === status}
                   onPress={() => { void runUpdate(
                     () => role === 'manager' ? updateManagerReport(current.id, { status }) : updateWorkerStatus(current.id, status),
                     `Case status saved as ${status}.`,
                   ); }}
                  tone={status === 'Resolved' ? 'success' : undefined}
                />
              ))}
            </View>
          </>
        ) : null}
        {role === 'manager' && !current.assignedTeam ? (
          <Button label="Delegate to West Clean Team" icon="send" onPress={() => {
            void runUpdate(() => assignReports([current.id], 'San Jose – West Clean Team'), 'Case assigned to the West Clean Team.');
          }} loading={saving} />
        ) : null}
        {saveError ? <Text style={[styles.cardBody, { color: colors.destructive }]}>{saveError}</Text> : null}
        {saveMessage ? <Text style={[styles.cardBody, { color: colors.success }]}>{saveMessage}</Text> : null}
        {role === 'worker' ? (
          <Card tone="soft">
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Worker access is limited to status updates. Report details, severity, category, and routes are read-only.</Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SOSScreen({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, activateSOS, setSOSSignal, sendSOSMessage, endSOS } = useDemo();
  const [countdown, setCountdown] = useState(state.sosActive ? 0 : 5);
  const [cancelled, setCancelled] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (state.sosActive || cancelled || countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, cancelled, state.sosActive]);

  useEffect(() => {
    if (countdown === 0 && !cancelled && !state.sosActive) activateSOS();
  }, [countdown, cancelled, state.sosActive, activateSOS]);

  if (!state.sosActive) {
    return (
      <View style={[styles.countdownPage, { backgroundColor: colors.destructive, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 30 }]}>
        <Text style={[styles.prototypeLabel, { color: colors.destructiveForeground }]}>SIMULATED SOS · DEMO ONLY</Text>
        <View style={[styles.countdownRing, { borderColor: colors.destructiveForeground }]}>
          <Text style={[styles.countdown, { color: colors.destructiveForeground }]}>{cancelled ? '×' : countdown}</Text>
        </View>
        <Text style={[styles.countdownTitle, { color: colors.destructiveForeground }]}>{cancelled ? 'SOS cancelled' : 'Starting safety session'}</Text>
        <Text style={[styles.countdownSub, { color: colors.destructiveForeground }]}>
          {cancelled ? 'No simulated alerts were sent.' : 'A parent and police-contact dashboard will be notified in this prototype. No real service will be contacted.'}
        </Text>
        <View style={styles.countdownActions}>
          {!cancelled ? <Button label="Cancel SOS" icon="x" variant="secondary" onPress={() => setCancelled(true)} /> : null}
          <Button label={cancelled ? 'Close' : 'Activate now'} icon={cancelled ? 'arrow-left' : 'alert-triangle'} variant="ghost" onPress={() => {
            if (cancelled) onClose();
            else activateSOS();
          }} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.sosActive, { backgroundColor: colors.background }]} behavior="padding">
      <View style={[styles.sosActiveHeader, { paddingTop: insets.top + 10, backgroundColor: colors.destructive }]}>
        <View>
          <Text style={[styles.prototypeLabel, { color: colors.destructiveForeground }]}>SIMULATED SOS ACTIVE</Text>
          <Text style={[styles.sosActiveTitle, { color: colors.destructiveForeground }]}>Stay calm. You’re not alone.</Text>
        </View>
        <View style={[styles.liveDot, { backgroundColor: colors.destructiveForeground }]} />
      </View>
      <FlatList
        data={[...state.sosMessages].reverse()}
        inverted
        keyExtractor={(item) => item.id}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chatList}
        ListHeaderComponent={
          <View style={styles.sosControls}>
            <Card tone="soft">
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Civic Center, San Jose</Text>
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Simulated emergency location · parent and police-contact views notified</Text>
            </Card>
            <View style={styles.wrap}>
              {['Prolonged silence', 'Unusual movement'].map((signal) => (
                <Chip key={signal} label={`Simulate ${signal.toLowerCase()}`} active={state.sosTriggers.includes(signal)} onPress={() => setSOSSignal(signal)} tone="danger" />
              ))}
            </View>
            <Button label="Send information to police contact" icon="send" variant="secondary" onPress={() => Alert.alert('Information sent', 'Child-provided details were sent only to the simulated police-contact view.')} />
            <Button label="End simulated SOS" icon="x-circle" variant="danger" onPress={() => {
              endSOS();
              onClose();
            }} />
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.chatBubble, item.sender === 'child' ? styles.childBubble : styles.guideBubble, { backgroundColor: item.sender === 'child' ? colors.primary : colors.card, borderColor: colors.border }]}>
            {item.sender === 'guide' ? <Text style={[styles.whisperLabel, { color: colors.primary }]}>quiet guidance</Text> : null}
            <Text style={[styles.chatText, { color: item.sender === 'child' ? colors.primaryForeground : colors.foreground }]}>{item.text}</Text>
          </View>
        )}
      />
      <View style={[styles.chatInputRow, { paddingBottom: Math.max(insets.bottom, 12), borderTopColor: colors.border, backgroundColor: colors.card }]}>
        <TextInput
          ref={inputRef}
          value={message}
          onChangeText={setMessage}
          placeholder="Share what’s happening…"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.chatInput, { color: colors.foreground, backgroundColor: colors.muted }]}
        />
        <Pressable
          onPress={() => {
            const copy = message;
            setMessage('');
            sendSOSMessage(copy);
            inputRef.current?.focus();
          }}
          style={[styles.sendButton, { backgroundColor: colors.primary }]}
        >
          <Feather name="arrow-up" size={20} color={colors.primaryForeground} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function CaseRow({ report, onPress }: { report: SafetyReport; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.caseRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}>
      <View style={[styles.severity, { backgroundColor: heatColor(report.severity + 1) }]}>
        <Text style={styles.severityText}>{report.severity}</Text>
      </View>
      <View style={styles.flex}>
        <View style={styles.caseRowTop}>
          <Text style={[styles.caseId, { color: colors.primary }]}>{report.id}</Text>
          <Text style={[styles.caseStatus, { color: colors.mutedForeground }]}>{report.status}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{report.category}</Text>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]} numberOfLines={2}>{report.description}</Text>
        <Text style={[styles.noticeMeta, { color: colors.mutedForeground }]}>{report.location}{report.assignedTeam ? ` · ${report.assignedTeam}` : ''}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  const diff = Math.max(0, Date.now() - date.getTime());
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  topbar: { minHeight: 68, paddingHorizontal: 20, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandText: { fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: -0.5 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sosPill: { borderRadius: 16, paddingHorizontal: 12, height: 34, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sosPillText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  bell: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center' },
  unread: { position: 'absolute', width: 7, height: 7, borderRadius: 4, right: 8, top: 8 },
  body: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 116 },
  tabbar: { minHeight: 70, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', paddingTop: 7, paddingHorizontal: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabIcon: { width: 44, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontFamily: 'Inter_600SemiBold', fontSize: 9.5 },
  journeyHero: { borderRadius: 26, padding: 19, minHeight: 244 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.8 },
  delayBadge: { backgroundColor: '#D94F53', borderRadius: 11, paddingHorizontal: 9, paddingVertical: 5 },
  delayText: { fontFamily: 'Inter_700Bold', fontSize: 9 },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.5, marginTop: 25 },
  routeLine: { flexDirection: 'row', alignItems: 'center', marginVertical: 10 },
  routePoint: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  routeTrack: { flex: 1, height: 2, opacity: 0.65 },
  heroDestination: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  heroFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 25 },
  heroMeta: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  heroSub: { fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 3, opacity: 0.72 },
  mapIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  nextStep: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 16 },
  bigStepIcon: { width: 53, height: 53, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 20 },
  cardBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  twoColumns: { flexDirection: 'row', gap: 12, marginTop: 16 },
  quickCard: { flex: 1, borderWidth: 1, borderRadius: 21, padding: 15, minHeight: 145 },
  quickIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  quickTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  quickSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 },
  sosCard: { borderRadius: 23, padding: 18, marginTop: 16, flexDirection: 'row', alignItems: 'center' },
  sosCopy: { flex: 1 },
  sosTitle: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  sosSub: { fontFamily: 'Inter_400Regular', fontSize: 11.5, marginTop: 4 },
  sosCircle: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineVisual: { alignItems: 'center', width: 22 },
  timelineDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  timelineBar: { width: 2, flex: 1, minHeight: 31 },
  timelineCopy: { flex: 1, paddingTop: 1 },
  timelineTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  timelineSub: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  metrics: { flexDirection: 'row', gap: 14 },
  communityCard: { gap: 15 },
  communityText: { gap: 2 },
  routeSummary: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  routeNumber: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  routeNumberText: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  mapSelection: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: 19, marginTop: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  detailRow: { gap: 5 },
  detailLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  detailValue: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  filters: { gap: 8, paddingBottom: 15 },
  reportList: { gap: 10, marginBottom: 16 },
  caseRow: { borderWidth: 1, borderRadius: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  severity: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  severityText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  caseRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  caseId: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  caseStatus: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  rewardHero: { borderRadius: 26, padding: 22, gap: 8 },
  rewardHeroTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 8 },
  rewardHeroSub: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, opacity: 0.86 },
  rewardCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  rewardIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  redeem: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  historyText: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  noticeIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  noticeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeUnread: { width: 7, height: 7, borderRadius: 4 },
  noticeMeta: { fontFamily: 'Inter_500Medium', fontSize: 9.5, marginTop: 7 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatar: { width: 50, height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  controlCard: { gap: 15, marginBottom: 10 },
  controlCopy: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  verify: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 17 },
  verifyIcon: { width: 72, height: 72, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  verifyTitle: { fontFamily: 'Inter_700Bold', fontSize: 31, letterSpacing: -0.9 },
  verifySub: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 23, marginBottom: 10 },
  demoCode: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center' },
  modalPage: { flex: 1 },
  modalHeader: { minHeight: 68, paddingHorizontal: 12, paddingBottom: 9, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 10 },
  modalScroll: { padding: 20, gap: 16 },
  aiIntro: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  photoPicker: { height: 190, borderWidth: 1, borderStyle: 'dashed', borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 5 },
  photoIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  photoTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  photoSub: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  casePhoto: { width: '100%', height: 210, borderRadius: 23 },
  casePlaceholder: { width: '100%', height: 180, borderRadius: 23, alignItems: 'center', justifyContent: 'center', gap: 8 },
  caseHeadline: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  severityLarge: { width: 66, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  severityLargeValue: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 25 },
  severityLargeLabel: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 8 },
  fieldCaption: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  countdownPage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  prototypeLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.8, textAlign: 'center' },
  countdownRing: { width: 150, height: 150, borderRadius: 75, borderWidth: 4, alignItems: 'center', justifyContent: 'center', marginVertical: 40 },
  countdown: { fontFamily: 'Inter_700Bold', fontSize: 63 },
  countdownTitle: { fontFamily: 'Inter_700Bold', fontSize: 29, textAlign: 'center' },
  countdownSub: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 12, opacity: 0.85 },
  countdownActions: { alignSelf: 'stretch', gap: 10, marginTop: 30 },
  sosActive: { flex: 1 },
  sosActiveHeader: { paddingHorizontal: 20, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sosActiveTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, marginTop: 5 },
  liveDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 7 },
  chatList: { padding: 16, gap: 10 },
  sosControls: { gap: 12, marginBottom: 16 },
  chatBubble: { maxWidth: '86%', borderWidth: 1, borderRadius: 20, padding: 14, marginVertical: 5 },
  childBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  guideBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  whisperLabel: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 5 },
  chatText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  chatInputRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, paddingTop: 10, flexDirection: 'row', gap: 9 },
  chatInput: { flex: 1, minHeight: 46, borderRadius: 18, paddingHorizontal: 15, fontFamily: 'Inter_500Medium', fontSize: 14 },
  sendButton: { width: 46, height: 46, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});