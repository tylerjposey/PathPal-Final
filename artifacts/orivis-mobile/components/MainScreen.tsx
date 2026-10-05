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
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RouteMap } from '@/components/RouteMap';
import { JourneyScreen } from '@/components/JourneyScreen';
import { FamilySettings } from '@/components/FamilySettings';
import { LiveTrackingPanel } from '@/components/LiveTrackingPanel';
import {
  getGetReportQueryKey,
  useGetTrackingProfile,
  useGetReport,
  useListReports,
  type CommunityReport,
  type TrackingJourney,
} from '@workspace/api-client-react';
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
  DEFAULT_DEMO_JOURNEY,
  buildJourneyMilestones,
  heatColor,
  heatScore,
  journeyMilestoneActionLabel,
  type CaseStatus,
  type JourneyMilestone,
  type MilestoneKind,
  type ReportCategory,
  type Role,
  type SafetyReport,
  useDemo,
} from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';
import {
  loadReportPhotoDataUri,
  reportAccountScope,
  reportError,
  reportListQueryKey,
  trackingProfileQueryKey,
  toSafetyReport,
} from '@/lib/reportApi';

type TabKey = 'home' | 'map' | 'reports' | 'history' | 'alerts' | 'rewards' | 'tasks' | 'profile';
type ModalName = 'report' | 'sos' | 'case' | 'verify' | null;

function milestoneIcon(kind: MilestoneKind): keyof typeof Feather.glyphMap {
  switch (kind) {
    case 'walk-start':
      return 'map-pin';
    case 'board':
      return 'navigation';
    case 'alight':
      return 'log-out';
    case 'transfer-walk':
      return 'shuffle';
    case 'arrive':
      return 'check-circle';
  }
}

const journeyProgressInset = 14;
const journeyCheckpointSize = 18;
const journeyTravelerSize = 28;
const journeyFlagSize = 18;

function JourneyProgressTrack({
  milestones,
  currentIndex,
  travelerName,
}: {
  milestones: JourneyMilestone[];
  currentIndex: number;
  travelerName: string;
}) {
  const colors = useColors();
  const [trackWidth, setTrackWidth] = useState(0);
  const checkpointCount = milestones.length;
  const completedCount = Math.min(checkpointCount, Math.max(0, currentIndex + 1));
  const progress = checkpointCount ? completedCount / checkpointCount : 0;
  const trackSpan = Math.max(0, trackWidth - journeyProgressInset * 2);
  const traveledDistance = useSharedValue(0);

  useEffect(() => {
    traveledDistance.value = withTiming(trackSpan * progress, {
      duration: 480,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, trackSpan, traveledDistance]);

  const fillStyle = useAnimatedStyle(() => ({ width: traveledDistance.value }));
  const travelerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: traveledDistance.value }],
  }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${travelerName}’s journey progress`}
      accessibilityValue={{ min: 0, max: checkpointCount, now: completedCount }}
      testID="journey-progress-track"
      style={styles.journeyProgressTrack}
      onLayout={({ nativeEvent }) => setTrackWidth(nativeEvent.layout.width)}
    >
      <View
        style={[styles.journeyProgressBase, { backgroundColor: colors.primaryForeground }]}
      />
      <Animated.View
        style={[
          styles.journeyProgressFill,
          { backgroundColor: colors.success },
          fillStyle,
        ]}
      />
      {milestones.map((milestone, index) => {
        const checkpointCenter =
          journeyProgressInset + ((index + 1) / checkpointCount) * trackSpan;
        const complete = index < completedCount;
        const next = index === completedCount && completedCount < checkpointCount;
        const icon = complete
          ? 'check'
          : milestone.kind === 'arrive'
            ? 'flag'
            : milestoneIcon(milestone.kind);
        return (
          <View
            key={milestone.key}
            testID={`journey-checkpoint-${milestone.key}`}
            style={[
              styles.journeyCheckpoint,
              {
                left: checkpointCenter - journeyCheckpointSize / 2,
                backgroundColor: complete ? colors.success : next ? colors.primary : colors.navy,
                borderColor: complete ? colors.success : colors.primaryForeground,
              },
            ]}
          >
            <Feather name={icon} size={9} color={colors.primaryForeground} />
          </View>
        );
      })}
      <View
        pointerEvents="none"
        style={[
          styles.journeyDestinationFlag,
          {
            left: journeyProgressInset + trackSpan - journeyFlagSize / 2,
          },
        ]}
      >
        <Feather
          name="flag"
          size={15}
          color={completedCount === checkpointCount ? colors.success : colors.primaryForeground}
        />
      </View>
      <Animated.View
        style={[
          styles.journeyTraveler,
          { left: journeyProgressInset - journeyTravelerSize / 2, backgroundColor: colors.primaryForeground, borderColor: colors.primary },
          travelerStyle,
        ]}
      >
        <Feather name="user" size={12} color={colors.primary} />
      </Animated.View>
    </View>
  );
}

function LiveSharedJourneyCard({ journey }: { journey: TrackingJourney }) {
  const colors = useColors();
  const latestEvent = journey.events.at(-1);

  return (
    <>
      <SectionTitle title={`${journey.childName}’s live journey`} />
      <Card>
        <View style={styles.liveJourneyHeader}>
          <View style={[styles.liveJourneyIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="navigation" size={18} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{journey.route.name}</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
              {journey.route.startStop} to {journey.route.destinationStop}
            </Text>
          </View>
          <Text style={[styles.liveJourneyPercent, { color: colors.primary }]}>
            {journey.progressPercent}%
          </Text>
        </View>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${journey.childName}’s shared journey progress`}
          accessibilityValue={{ min: 0, max: 100, now: journey.progressPercent }}
          style={[styles.liveJourneyTrack, { backgroundColor: colors.secondary }]}
        >
          <View
            style={[
              styles.liveJourneyFill,
              { width: `${journey.progressPercent}%`, backgroundColor: colors.success },
            ]}
          />
        </View>
        {latestEvent ? (
          <View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{latestEvent.title}</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{latestEvent.subtitle}</Text>
          </View>
        ) : null}
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
          Parents see route progress and checkpoints, not the child’s exact location.
        </Text>
      </Card>
    </>
  );
}

function tabsForRole(role: Role): { key: TabKey; label: string; icon: keyof typeof Feather.glyphMap }[] {
  if (role === 'manager') {
    return [
      { key: 'home', label: 'Overview', icon: 'grid' },
      { key: 'map', label: 'Map', icon: 'map' },
      { key: 'reports', label: 'Cases', icon: 'inbox' },
      { key: 'history', label: 'History', icon: 'clock' },
      { key: 'profile', label: 'More', icon: 'menu' },
    ];
  }
  if (role === 'worker') {
    return [
      { key: 'home', label: 'Today', icon: 'home' },
      { key: 'map', label: 'Route', icon: 'map' },
      { key: 'tasks', label: 'Tasks', icon: 'check-square' },
      { key: 'history', label: 'History', icon: 'clock' },
      { key: 'profile', label: 'More', icon: 'menu' },
    ];
  }
  return [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'map', label: 'Journey', icon: 'map' },
    { key: 'reports', label: 'Report', icon: 'camera' },
    { key: 'history', label: 'History', icon: 'clock' },
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
  const [tabBeforeAlerts, setTabBeforeAlerts] = useState<TabKey>('home');
  const [mountedTabs, setMountedTabs] = useState<Set<TabKey>>(() => new Set(['home']));
  const [modal, setModal] = useState<ModalName>(verificationAccount && !state.account ? 'verify' : null);
  const [selectedReport, setSelectedReport] = useState<SafetyReport | null>(null);

  useEffect(() => {
    if (verificationAccount && !state.account) setModal('verify');
  }, [verificationAccount, state.account]);

  const openCase = (report: SafetyReport) => {
    setSelectedReport(report);
    setModal('case');
  };

  const navigateTo = (nextTab: TabKey) => {
    if (nextTab === 'alerts' && tab !== 'alerts') setTabBeforeAlerts(tab);
    setMountedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
    setTab(nextTab);
  };

  const returnFromAlerts = () => {
    const destinationTab = tabs.some((item) => item.key === tabBeforeAlerts)
      ? tabBeforeAlerts
      : 'home';
    setTab(destinationTab);
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
          <Text style={[styles.brandText, { color: colors.foreground }]}>PathPal</Text>
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
            onPress={() => navigateTo('alerts')}
            style={({ pressed }) => [styles.bell, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="bell" size={21} color={colors.foreground} />
            {state.notifications.some((notice) => notice.unread) ? <View style={[styles.unread, { backgroundColor: colors.destructive }]} /> : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        {(['home', 'map', 'reports', 'history', 'tasks', 'rewards', 'alerts', 'profile'] as TabKey[]).map((screenTab) => (
          <View
            key={screenTab}
            style={[styles.tabPanel, tab !== screenTab ? styles.hiddenTabPanel : null]}
          >
            {mountedTabs.has(screenTab) ? (
              screenTab === 'home'
                ? <Home role={role} onNavigate={navigateTo} onReport={() => setModal('report')} onSOS={() => setModal('sos')} onCase={openCase} />
                : screenTab === 'map'
                  ? role === 'parent' || role === 'child' ? <JourneyScreen /> : <MapScreen role={role} onCase={openCase} />
                  : screenTab === 'reports'
                    ? <ReportsScreen role={role} onCreate={() => setModal('report')} onCase={openCase} />
                    : screenTab === 'history'
                      ? <ReportHistoryScreen onCase={openCase} />
                      : screenTab === 'tasks'
                        ? <WorkerTasks onCase={openCase} />
                        : screenTab === 'rewards'
                          ? <RewardsScreen />
                          : screenTab === 'alerts'
                            ? <AlertsScreen onBack={returnFromAlerts} onHome={() => navigateTo('home')} isActive={tab === 'alerts'} />
                            : <ProfileScreen />
            ) : null}
          </View>
        ))}
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
                  navigateTo(item.key);
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
  const { state, confirmMilestone, reportBusDelay } = useDemo();
  const trackingProfile = useGetTrackingProfile({
    query: {
      queryKey: trackingProfileQueryKey(state.account),
      enabled: role === 'parent' || role === 'child',
      refetchInterval: 20_000,
      retry: false,
    },
  });
  const liveJourney = role === 'parent'
    ? [...(trackingProfile.data?.journeys ?? [])].reverse().find(
      (item) => item.status === 'active' || item.status === 'arrived',
    )
    : undefined;
  const nowGreeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  if (role === 'manager') return <ManagerHome onCase={onCase} />;
  if (role === 'worker') return <WorkerHome onCase={onCase} />;
  const journey = state.selectedJourney ?? DEFAULT_DEMO_JOURNEY;
  const milestones = useMemo(() => buildJourneyMilestones(journey), [journey]);
  const currentIndex = state.milestoneIndex;
  const isComplete = currentIndex >= milestones.length - 1;
  const nextMilestone = milestones[Math.min(currentIndex + 1, milestones.length - 1)];
  const homeSubtitle = liveJourney
    ? liveJourney.status === 'arrived'
      ? `${liveJourney.childName} reached the destination.`
      : `${liveJourney.childName} is sharing route progress.`
    : isComplete
    ? role === 'parent'
      ? `${state.child.name} reached the destination.`
      : 'You reached your destination.'
    : role === 'parent'
      ? `${state.child.name}’s planned trip is ready.`
      : 'Your route is ready. Check in at each step.';
  const routeName = liveJourney?.route.name ?? journey.name;
  const startStop = liveJourney?.route.startStop ?? journey.startStop;
  const destinationStop = liveJourney?.route.destinationStop ?? journey.destinationStop;
  const delay = liveJourney
    ? Math.max(0, ...liveJourney.route.legs.map((leg) => leg.delayMinutes ?? 0))
    : Math.max(journey.delayMinutes ?? 0, state.busDelayed ? 8 : 0);
  return (
    <ScreenScroll>
      <ScreenHeader
        eyebrow={ROLE_LABELS[role]}
        title={`${nowGreeting}, ${state.account?.name.split(' ')[0] ?? 'there'}.`}
        subtitle={homeSubtitle}
      />

      <LinearGradient colors={[colors.navy, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.journeyHero}>
        <View style={styles.heroTop}>
          <View style={styles.routeBadge}>
            <Feather name="navigation" size={14} color={colors.primaryForeground} />
             <Text style={[styles.heroEyebrow, { color: colors.primaryForeground }]}>{routeName.toUpperCase()} · {journey.source === 'live' ? 'LIVE ROUTE' : 'DEMO ROUTE'}</Text>
          </View>
           {delay > 0 ? (
            <View style={[styles.delayBadge, { backgroundColor: colors.destructive }]}>
               <Text style={[styles.delayText, { color: colors.destructiveForeground }]}>{delay} min delay</Text>
            </View>
          ) : null}
        </View>
         <Text style={[styles.heroTitle, { color: colors.primaryForeground }]} numberOfLines={2}>{startStop}</Text>
        {liveJourney ? (
          <View style={styles.heroLiveProgress}>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={`${liveJourney.childName}’s shared route progress`}
              accessibilityValue={{ min: 0, max: 100, now: liveJourney.progressPercent }}
              style={[styles.heroLiveProgressTrack, { backgroundColor: colors.secondary }]}
            >
              <View
                style={[
                  styles.heroLiveProgressFill,
                  { width: `${liveJourney.progressPercent}%`, backgroundColor: colors.success },
                ]}
              />
            </View>
            <Text style={[styles.heroSub, { color: colors.primaryForeground }]}>
              {liveJourney.progressPercent}% route progress · exact location stays private
            </Text>
          </View>
        ) : (
          <JourneyProgressTrack
            milestones={milestones}
            currentIndex={currentIndex}
            travelerName={state.child.name}
          />
        )}
        <Text style={[styles.heroDestination, { color: colors.primaryForeground }]}>
          {destinationStop} · {liveJourney?.route.durationMinutes ?? journey.durationMinutes} min
        </Text>
        <View style={styles.heroFooter}>
          <View>
            <Text style={[styles.heroMeta, { color: colors.primaryForeground }]}>
              {liveJourney
                ? liveJourney.status === 'arrived'
                  ? 'Destination confirmed'
                  : `${liveJourney.progressPercent}% of the route complete`
                : currentIndex < 0
                  ? 'Awaiting first check-in'
                  : `${milestones[currentIndex].title} confirmed`}
            </Text>
            <Text style={[styles.heroSub, { color: colors.primaryForeground }]}>
              {liveJourney ? 'Route progress and checkpoints only' : 'Planned route only · no live tracking'}
            </Text>
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
                <Feather name={milestoneIcon(nextMilestone.kind)} size={25} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{nextMilestone.title}</Text>
                 <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{nextMilestone.subtitle}</Text>
              </View>
            </View>
            <Button
               label={isComplete ? 'Journey complete' : journeyMilestoneActionLabel(nextMilestone)}
              icon="check"
              disabled={isComplete}
               onPress={() => {
                 confirmMilestone(currentIndex + 1);
                 Alert.alert('Check-in confirmed', `Your ${nextMilestone.title.toLowerCase()} update is on the parent dashboard. An in-app and simulated text alert were created.`);
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
          <LiveTrackingPanel journey={state.selectedJourney ?? null} />
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
          {liveJourney ? (
            <LiveSharedJourneyCard journey={liveJourney} />
          ) : (
            <>
              <SectionTitle title={`${state.child.name}’s progress`} />
              <Card>
                {milestones.map((milestone, index) => {
                  const complete = index <= currentIndex;
                  const current = index === currentIndex + 1 && !isComplete;
                  return (
                    <View key={milestone.key} style={styles.timelineRow}>
                      <View style={styles.timelineVisual}>
                        <View style={[styles.timelineDot, { backgroundColor: complete ? colors.success : current ? colors.primary : colors.muted, borderColor: current ? colors.primary : colors.border }]}>
                          {complete ? <Feather name="check" size={11} color={colors.primaryForeground} /> : null}
                        </View>
                        {index < milestones.length - 1 ? <View style={[styles.timelineBar, { backgroundColor: complete ? colors.success : colors.border }]} /> : null}
                      </View>
                      <View style={[styles.timelineCopy, index < milestones.length - 1 ? { paddingBottom: 17 } : null]}>
                        <Text style={[styles.timelineTitle, { color: colors.foreground }]}>{milestone.title}</Text>
                        <Text style={[styles.timelineSub, { color: colors.mutedForeground }]}>{milestone.subtitle}{milestone.delayMinutes ? ` · ${milestone.delayMinutes} min delay` : ''}</Text>
                      </View>
                    </View>
                  );
                })}
              </Card>
              {state.tripUpdatedAt && currentIndex >= 0 ? (
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  Latest child update: {formatTime(state.tripUpdatedAt)} · {milestones[currentIndex]?.title}
                </Text>
              ) : null}
            </>
          )}
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
      {state.account?.reportServiceUnavailable ? (
        <Card tone="danger">
          <Text style={[styles.cardTitle, { color: colors.destructiveForeground }]}>Report service unavailable</Text>
          <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>{state.account.reportServiceError ?? 'New submissions, shared case updates, and server history require a connection. Local family journey, check-ins, and simulated SOS remain available.'}</Text>
        </Card>
      ) : reportsError ? (
        <Card tone="danger">
          <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>
            The report service is unavailable. This page may include older device-only reports; they are not confirmation of a database save. New submissions and updates require a server connection.
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

function ReportHistoryScreen({ onCase }: { onCase: (report: SafetyReport) => void }) {
  const colors = useColors();
  const { state } = useDemo();
  const accountScope = state.account ? reportAccountScope(state.account) : 'anonymous';
  const historyQuery = useListReports({
    query: {
      enabled: Boolean(state.account) && !state.account?.reportServiceUnavailable,
      staleTime: 0,
      refetchOnMount: 'always',
      queryKey: reportListQueryKey(accountScope),
    },
  });
  const historyQueryMatchesScope = historyQuery.queryKey[1] === 'account' && historyQuery.queryKey[2] === accountScope;
  const reports = (historyQueryMatchesScope && historyQuery.isSuccess && !historyQuery.isError ? historyQuery.data ?? [] : [])
    .slice()
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  return (
    <ScreenScroll>
      <ScreenHeader
        eyebrow="Server history"
        title="Saved reports"
        subtitle="Your saved report history is fetched from the server each time this page opens. Device-only drafts are not shown."
        right={!state.account?.reportServiceUnavailable ? <IconButton icon="refresh-cw" onPress={() => { void historyQuery.refetch(); }} color={colors.primary} /> : undefined}
      />
      {state.account?.reportServiceUnavailable ? (
        <Card tone="danger">
          <Text style={[styles.cardTitle, { color: colors.destructiveForeground }]}>Report service unavailable</Text>
          <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>{state.account.reportServiceError ?? 'Server report history and new submissions require a connection. Your local family journey, check-ins, and simulated SOS remain available.'}</Text>
        </Card>
      ) : historyQuery.isFetching && !historyQuery.isPending ? (
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Refreshing saved reports from the server…</Text>
      ) : null}
      {historyQuery.isPending ? (
        <Card><Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Loading saved reports from the server…</Text></Card>
      ) : historyQuery.isError ? (
        <Card tone="danger">
          <Text style={[styles.cardTitle, { color: colors.destructiveForeground }]}>Saved reports could not be loaded</Text>
          <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>{reportError(historyQuery.error)}</Text>
          <Button label="Try again" icon="refresh-cw" variant="secondary" onPress={() => { void historyQuery.refetch(); }} />
        </Card>
      ) : reports.length === 0 ? (
        <Card tone="soft"><Text style={[styles.cardBody, { color: colors.mutedForeground }]}>No reports are currently available in the shared database.</Text></Card>
      ) : (
        <View style={styles.reportList}>
          {reports.map((item) => (
            <ReportHistoryRow
              key={item.id}
              report={item}
              onPress={() => onCase(toSafetyReport(item))}
            />
          ))}
        </View>
      )}
    </ScreenScroll>
  );
}

function ReportHistoryRow({ report, onPress }: { report: CommunityReport; onPress: () => void }) {
  const colors = useColors();
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!report.photoUri || !report.photoReference || report.photoReference === 'none') {
      setPhoto(null);
      return () => { active = false; };
    }
    void loadReportPhotoDataUri(report.id).then((uri) => {
      if (active) setPhoto(uri);
    }).catch(() => {
      if (active) setPhoto(null);
    });
    return () => { active = false; };
  }, [report.id, report.photoUri, report.photoReference]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.historyRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.historyPhoto} contentFit="cover" />
      ) : (
        <View style={[styles.historyPhoto, styles.historyPhotoPlaceholder, { backgroundColor: colors.secondary }]}>
          <Feather name="image" size={21} color={colors.primary} />
          <Text style={[styles.historyPhotoText, { color: colors.mutedForeground }]}>{report.photoReference && report.photoReference !== 'none' ? 'Photo' : 'No photo'}</Text>
        </View>
      )}
      <View style={styles.flex}>
        <View style={styles.caseRowTop}>
          <Text style={[styles.caseId, { color: colors.primary }]}>{report.id}</Text>
          <Text style={[styles.caseStatus, { color: colors.mutedForeground }]}>{report.status}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{report.description}</Text>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]} numberOfLines={2}>
          Selected: {report.selectedCategory ?? 'AI categorized'} · AI: {report.category}
        </Text>
        <Text style={[styles.noticeMeta, { color: colors.mutedForeground }]}>
          {report.location} · {report.latitude == null || report.longitude == null ? 'Pin unavailable' : `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`}
        </Text>
        <Text style={[styles.noticeMeta, { color: colors.mutedForeground }]}>
          Severity {report.severity}/10 · {report.assignedTeam ?? 'No team'} · {formatDateTime(report.submittedAt)}
        </Text>
      </View>
      <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
    </Pressable>
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
              if (okay) Alert.alert('Reward redeemed', 'This is a simulated redemption for the PathPal prototype.');
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

function AlertsScreen({ onBack, onHome, isActive }: { onBack: () => void; onHome: () => void; isActive: boolean }) {
  const colors = useColors();
  const { state, markNotificationsRead } = useDemo();
  useEffect(() => {
    if (!isActive) return;
    const id = setTimeout(markNotificationsRead, 600);
    return () => clearTimeout(id);
  }, [isActive, markNotificationsRead]);
  return (
    <ScreenScroll>
      <View style={styles.alertNavigation}>
        <Pressable
          testID="notifications-back"
          accessibilityRole="button"
          accessibilityLabel="Back to previous screen"
          onPress={onBack}
          style={[styles.alertAction, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="arrow-left" size={17} color={colors.primary} />
          <Text style={[styles.alertActionText, { color: colors.foreground }]}>Back</Text>
        </Pressable>
        <Pressable
          testID="notifications-home"
          accessibilityRole="button"
          accessibilityLabel="Go to home dashboard"
          onPress={onHome}
          style={[styles.alertAction, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="home" size={17} color={colors.primary} />
          <Text style={[styles.alertActionText, { color: colors.foreground }]}>Home</Text>
        </Pressable>
      </View>
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
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);
  const restoreDemo = async () => {
    if (resetting) return;
    setResetting(true);
    setResetError('');
    try {
      await resetDemo();
    } catch (error) {
      setResetError(reportError(error));
    } finally {
      setResetting(false);
    }
  };
  if (state.account?.role === 'parent') return <FamilySettings />;
  return (
    <ScreenScroll>
      <ScreenHeader eyebrow={state.account ? ROLE_LABELS[state.account.role] : 'Account'} title={state.account?.name ?? 'PathPal demo'} subtitle={state.account?.username ?? 'Sample account'} />
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
      {state.account?.role === 'child' ? (
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
      {state.account?.role === 'manager' ? (
        <Card style={styles.controlCard}>
          <View style={styles.controlCopy}>
            <Feather name="refresh-cw" size={20} color={colors.primary} />
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Reset Demonstration Data</Text>
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Restores local demo state and the six shared sample cases. Your submitted reports remain in the database. Shared sample cases may change for every demo user.</Text>
            </View>
          </View>
          {resetError ? <Text style={[styles.cardBody, { color: colors.destructive }]}>{resetError}</Text> : null}
          <Button
            label="Reset demo"
            variant="secondary"
            loading={resetting}
            onPress={() => Alert.alert('Reset demonstration data?', 'This restores the shared sample reports and resets this device. Shared sample cases may change for all demo users; user-submitted database reports are preserved.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: () => { void restoreDemo(); } },
            ])}
          />
        </Card>
      ) : null}
      <Card tone="soft">
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Prototype limitations</Text>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
          Authentication uses shared prototype demo identities, not secure personal-account isolation. AI analysis, notifications, partner rewards, police contact, and SOS behavior are simulated. Journey routes use Google Maps and 511 SF Bay when configured and available; otherwise the Journey page labels its demo fallback. City issue maps remain illustrative.
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
  const { state, createReport } = useDemo();
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('Downtown San Jose');
  const [pin, setPin] = useState<{ latitude: number; longitude: number; x: number; y: number } | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [category, setCategory] = useState<ReportCategory | undefined>();
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [photoBase64, setPhotoBase64] = useState<string | undefined>();
  const [contentType, setContentType] = useState<'image/jpeg' | 'image/png' | 'image/webp' | undefined>();
  const [error, setError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const neighborhoodCenters: Record<string, { latitude: number; longitude: number }> = {
    'Downtown San Jose': { latitude: 37.3382, longitude: -121.8863 },
    Japantown: { latitude: 37.3481, longitude: -121.8958 },
    'Willow Glen': { latitude: 37.3058, longitude: -121.9002 },
    'East San Jose': { latitude: 37.3514, longitude: -121.8277 },
    'Alum Rock': { latitude: 37.3666, longitude: -121.8272 },
    'Santa Clara': { latitude: 37.3541, longitude: -121.9552 },
  };

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
    if (!pin || !Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) {
      setError('Tap the illustrative map to place a report pin before submitting.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await createReport({ description: description.trim(), location, category, photoBase64, contentType, latitude: pin.latitude, longitude: pin.longitude });
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
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                PathPal will create a sample category, severity score, department, and priority from your description. {state.account?.reportServiceUnavailable ? 'Report service is unavailable; the report cannot be saved until a server connection is restored.' : 'A report is only confirmed after the server accepts it.'}
              </Text>
            </View>
          </View>
        </Card>
        {state.account?.reportServiceUnavailable ? (
          <Card tone="danger">
            <Text style={[styles.cardTitle, { color: colors.destructiveForeground }]}>Report service unavailable</Text>
            <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>{state.account.reportServiceError ?? 'Connect to the report server before submitting. This form will not save a device-only success.'}</Text>
          </Card>
        ) : null}
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
        <SectionTitle title="Selected category (optional)" />
        <View style={styles.wrap}>
          {REPORT_CATEGORIES.map((item) => <Chip key={item} label={item} active={category === item} onPress={() => setCategory(category === item ? undefined : item)} />)}
        </View>
        <SectionTitle title="Drop a map pin" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {['Downtown San Jose', 'Japantown', 'Willow Glen', 'East San Jose', 'Alum Rock', 'Santa Clara'].map((item) => (
            <Chip key={item} label={item} active={location === item} onPress={() => { setLocation(item); setPin(null); }} />
          ))}
        </ScrollView>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
          Choose a neighborhood to center this illustrative map, then tap to drop a pin. Coordinates are approximate, not surveyed.
        </Text>
        <View
          style={styles.coordinateMap}
          onLayout={(event) => setMapSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        >
          <RouteMap height={210} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Place report pin on illustrative map"
            onPress={(event) => {
              if (!mapSize.width || !mapSize.height) return;
              const pointer = event.nativeEvent as typeof event.nativeEvent & {
                clientX?: number; clientY?: number; offsetX?: number; offsetY?: number;
              };
              const bounds = (event.currentTarget as unknown as {
                getBoundingClientRect?: () => { left: number; top: number };
              }).getBoundingClientRect?.();
              // React Native Web press events do not consistently expose locationX/Y.
              const relativeX = Number.isFinite(pointer.locationX) ? pointer.locationX
                : bounds && Number.isFinite(pointer.clientX) ? pointer.clientX! - bounds.left
                : Number.isFinite(pointer.offsetX) ? pointer.offsetX!
                : mapSize.width / 2;
              const relativeY = Number.isFinite(pointer.locationY) ? pointer.locationY
                : bounds && Number.isFinite(pointer.clientY) ? pointer.clientY! - bounds.top
                : Number.isFinite(pointer.offsetY) ? pointer.offsetY!
                : mapSize.height / 2;
              const x = Math.max(0, Math.min(1, relativeX / mapSize.width));
              const y = Math.max(0, Math.min(1, relativeY / mapSize.height));
              const center = neighborhoodCenters[location];
              setPin({
                latitude: Number((center.latitude + (0.5 - y) * 0.08).toFixed(6)),
                longitude: Number((center.longitude + (x - 0.5) * 0.10).toFixed(6)),
                x,
                y,
              });
              setError('');
            }}
            style={StyleSheet.absoluteFill}
          >
            {pin ? (
              <View pointerEvents="none" style={[styles.pinMarker, { left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }]}>
                <Feather name="map-pin" size={25} color={colors.destructive} />
              </View>
            ) : (
              <View pointerEvents="none" style={[styles.tapMapHint, { backgroundColor: colors.card }]}>
                <Feather name="map-pin" size={15} color={colors.primary} />
                <Text style={[styles.photoSub, { color: colors.foreground }]}>Tap to drop pin</Text>
              </View>
            )}
          </Pressable>
        </View>
        {pin && Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude) ? (
          <Text style={[styles.cardBody, { color: colors.foreground }]}>
            Approximate pin · {pin.latitude.toFixed(6)}, {pin.longitude.toFixed(6)}
          </Text>
        ) : null}
        {error ? <Text style={[styles.cardBody, { color: colors.destructive }]}>{error}</Text> : null}
        {submitError ? <Text style={[styles.cardBody, { color: colors.destructive }]}>{submitError}</Text> : null}
        <Button
          label={state.account?.reportServiceUnavailable ? 'Submission unavailable' : 'Submit for review'}
          icon="send"
          onPress={() => { void submit(); }}
          loading={submitting}
          disabled={Boolean(state.account?.reportServiceUnavailable)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CaseDetail({ report, role, onClose }: { report: SafetyReport; role: Role; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, updateManagerReport, updateWorkerStatus, assignReports } = useDemo();
  const authorizedInList = state.reports.some((item) => item.id === report.id);
  const detailQuery = useGetReport(report.id, {
    query: {
      enabled: authorizedInList && !state.account?.reportServiceUnavailable,
      staleTime: 0,
      refetchOnMount: 'always',
      queryKey: getGetReportQueryKey(report.id),
    },
  });
  const reportServiceUnavailable = Boolean(state.account?.reportServiceUnavailable);
  const current = detailQuery.data
    ? toSafetyReport(detailQuery.data)
    : state.reports.find((item) => item.id === report.id) ?? report;
  const [severity, setSeverity] = useState(`${current.severity}`);
  const [description, setDescription] = useState(current.description);
  const [category, setCategory] = useState(current.category);
  const [location, setLocation] = useState(current.location);
  const [managerNotes, setManagerNotes] = useState(current.managerNotes ?? '');
  const [routeAssignment, setRouteAssignment] = useState(current.routeAssignment ?? '');
  const [photoDataUri, setPhotoDataUri] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const canEdit = role === 'manager';
  const statuses: CaseStatus[] = ['Submitted', 'Under Review', 'Assigned', 'Resolved'];
  useEffect(() => {
    if (!authorizedInList || !detailQuery.data) return;
    const detail = toSafetyReport(detailQuery.data);
    setSeverity(`${detail.severity}`);
    setDescription(detail.description);
    setCategory(detail.category);
    setLocation(detail.location);
    setManagerNotes(detail.managerNotes ?? '');
    setRouteAssignment(detail.routeAssignment ?? '');
  }, [detailQuery.data, authorizedInList]);
  useEffect(() => {
    let active = true;
    const detail = detailQuery.data;
    setPhotoDataUri(null);
    setPhotoError('');
    if (!authorizedInList || reportServiceUnavailable || !detail?.photoUri || !detail.photoReference || detail.photoReference === 'none') return () => { active = false; };
    void loadReportPhotoDataUri(report.id).then((uri) => {
      if (active) setPhotoDataUri(uri);
    }).catch((error) => {
      if (active) setPhotoError(reportError(error));
    });
    return () => { active = false; };
  }, [detailQuery.data, report.id, reportServiceUnavailable, authorizedInList]);
  const runUpdate = async (action: () => Promise<void>, message: string) => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    setSaveMessage('');
    try {
      await action();
      await detailQuery.refetch();
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
    void runUpdate(() => updateManagerReport(current.id, {
      description: description.trim(),
      category,
      ...(location !== current.location ? { location } : {}),
      severity: score,
      managerNotes: managerNotes.trim() || null,
      routeAssignment: routeAssignment.trim() || null,
    }), 'Case edits saved to the shared queue.');
  };
  if (!reportServiceUnavailable && !authorizedInList) {
    return (
      <View style={[styles.modalPage, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
          <IconButton icon="x" onPress={onClose} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Report unavailable</Text>
          <View style={{ width: 42 }} />
        </View>
        <View style={{ padding: 20 }}>
          <Card tone="danger">
            <Text style={[styles.cardTitle, { color: colors.destructiveForeground }]}>Not in your authorized report list</Text>
            <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>
              {detailQuery.isError ? reportError(detailQuery.error) : 'Report details are hidden until this account’s server-authorized report list includes them.'}
            </Text>
          </Card>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.modalPage, { backgroundColor: colors.background }]}>
      <View style={[styles.modalHeader, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
        <IconButton icon="x" onPress={onClose} />
        <Text style={[styles.modalTitle, { color: colors.foreground }]}>{current.id}</Text>
        <View style={{ width: 42 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.modalScroll, { paddingBottom: insets.bottom + 30 }]}>
        {reportServiceUnavailable ? (
          <Card tone="danger">
            <Text style={[styles.cardTitle, { color: colors.destructiveForeground }]}>Report service unavailable</Text>
            <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>{state.account?.reportServiceError ?? 'These are local demonstration details. Server history and report submissions require a connection.'}</Text>
          </Card>
        ) : detailQuery.isPending ? <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>Loading complete report details…</Text> : null}
        {!reportServiceUnavailable && detailQuery.isError ? (
          <Card tone="danger">
            <Text style={[styles.cardTitle, { color: colors.destructiveForeground }]}>Complete report details could not be loaded</Text>
            <Text style={[styles.cardBody, { color: colors.destructiveForeground }]}>{reportError(detailQuery.error)}</Text>
            <Button label="Try again" icon="refresh-cw" variant="secondary" onPress={() => { void detailQuery.refetch(); }} />
          </Card>
        ) : null}
        {photoDataUri ? <Image source={{ uri: photoDataUri }} style={styles.casePhoto} contentFit="cover" /> : (
          <View style={[styles.casePlaceholder, { backgroundColor: colors.secondary }]}>
            <Feather name="image" size={30} color={colors.primary} />
            <Text style={[styles.photoSub, { color: colors.mutedForeground }]}>{reportServiceUnavailable ? 'Photo unavailable while report service is offline' : current.photoUri ? 'Loading protected report photo…' : 'No photo was submitted'}</Text>
          </View>
        )}
        {photoError ? <Text style={[styles.cardBody, { color: colors.destructive }]}>{photoError}</Text> : null}
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
        <SectionTitle title="Original report input and AI output" />
        <Card>
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Original description</Text>
          <Text style={[styles.cardBody, { color: colors.foreground }]}>{detailQuery.data?.description ?? current.description}</Text>
          <Divider />
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Selected category</Text>
          <Text style={[styles.detailValue, { color: colors.foreground }]}>{detailQuery.data?.selectedCategory ?? current.selectedCategory ?? 'Not selected; AI generated category'}</Text>
          <Divider />
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>AI category and analysis</Text>
          <Text style={[styles.detailValue, { color: colors.foreground }]}>{current.category}</Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{current.summary}</Text>
          <Divider />
          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Approximate map pin coordinates</Text>
          <Text style={[styles.detailValue, { color: colors.foreground }]}>
            {current.latitude == null || current.longitude == null ? 'Coordinates unavailable' : `${current.latitude.toFixed(6)}, ${current.longitude.toFixed(6)}`}
          </Text>
        </Card>
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
            <Field label="Manager notes" value={managerNotes} onChangeText={setManagerNotes} multiline placeholder="Internal case notes" />
            <Field label="Route assignment" value={routeAssignment} onChangeText={setRouteAssignment} placeholder="Route or work order" />
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
          <Divider />
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Route assignment</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{current.routeAssignment ?? 'Not assigned'}</Text>
          </View>
          <Divider />
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Manager notes</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{current.managerNotes || 'None'}</Text>
          </View>
        </Card>
        <SectionTitle title="Report timestamps" />
        <Card>
          <Text style={[styles.cardBody, { color: colors.foreground }]}>Submitted · {formatDateTime(current.submittedAt)}</Text>
          <Text style={[styles.cardBody, { color: colors.foreground }]}>Last updated · {current.updatedAt ? formatDateTime(current.updatedAt) : 'Unavailable'}</Text>
          <Text style={[styles.cardBody, { color: colors.foreground }]}>Assigned · {current.assignedAt ? formatDateTime(current.assignedAt) : 'Not assigned'}</Text>
          <Text style={[styles.cardBody, { color: colors.foreground }]}>Resolved · {current.resolvedAt ? formatDateTime(current.resolvedAt) : 'Not resolved'}</Text>
        </Card>
        <SectionTitle title="Status history" />
        {detailQuery.data?.statusHistory?.length ? detailQuery.data.statusHistory.map((entry, index) => (
          <Card key={`${entry.changedAt}-${index}`}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{entry.fromStatus ? `${entry.fromStatus} → ` : ''}{entry.toStatus}</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{formatDateTime(entry.changedAt)} · {entry.changedBy}</Text>
          </Card>
        )) : <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>No status history available.</Text>}
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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return date.toLocaleString();
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
  tabPanel: { flex: 1 },
  hiddenTabPanel: { display: 'none' },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 116 },
  tabbar: { minHeight: 70, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', paddingTop: 7, paddingHorizontal: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabIcon: { width: 44, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontFamily: 'Inter_600SemiBold', fontSize: 9.5 },
  journeyHero: { borderRadius: 26, padding: 19, minHeight: 244 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.8 },
  delayBadge: { borderRadius: 11, paddingHorizontal: 9, paddingVertical: 5 },
  delayText: { fontFamily: 'Inter_700Bold', fontSize: 9 },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.5, marginTop: 25 },
  journeyProgressTrack: { height: 52, marginVertical: 10, position: 'relative', overflow: 'visible' },
  heroLiveProgress: { gap: 4, marginVertical: 14 },
  heroLiveProgressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  heroLiveProgressFill: { height: '100%', borderRadius: 4 },
  journeyProgressBase: { position: 'absolute', left: journeyProgressInset, right: journeyProgressInset, top: 33, height: 2, borderRadius: 1, opacity: 0.42 },
  journeyProgressFill: { position: 'absolute', left: journeyProgressInset, top: 33, height: 2, borderRadius: 1 },
  journeyCheckpoint: { position: 'absolute', top: 25, width: journeyCheckpointSize, height: journeyCheckpointSize, borderWidth: 1.5, borderRadius: journeyCheckpointSize / 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  journeyDestinationFlag: { position: 'absolute', top: 1, width: journeyFlagSize, height: journeyFlagSize, marginLeft: -journeyFlagSize / 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  journeyTraveler: { position: 'absolute', top: 20, width: journeyTravelerSize, height: journeyTravelerSize, borderWidth: 2, borderRadius: journeyTravelerSize / 2, alignItems: 'center', justifyContent: 'center', zIndex: 3, elevation: 2 },
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
  liveJourneyHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  liveJourneyIcon: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  liveJourneyPercent: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  liveJourneyTrack: { height: 8, borderRadius: 8, overflow: 'hidden', marginVertical: 6 },
  liveJourneyFill: { height: '100%', borderRadius: 8 },
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
  historyRow: { borderWidth: 1, borderRadius: 20, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  historyPhoto: { width: 72, height: 82, borderRadius: 14 },
  historyPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  historyPhotoText: { fontFamily: 'Inter_500Medium', fontSize: 8 },
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
  alertNavigation: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  alertAction: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  alertActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
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
  coordinateMap: { height: 210, borderRadius: 24, overflow: 'hidden', position: 'relative' },
  pinMarker: { position: 'absolute', marginLeft: -12, marginTop: -25, elevation: 4 },
  tapMapHint: { position: 'absolute', top: '42%', alignSelf: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
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