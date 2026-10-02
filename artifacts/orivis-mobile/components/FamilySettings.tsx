import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  Button,
  Card,
  Field,
  ScreenHeader,
  SectionTitle,
} from '@/components/OrivisUI';
import { updateTrackingSettings, useGetTrackingProfile } from '@workspace/api-client-react';
import {
  DEFAULT_DEMO_JOURNEY,
  type ChildProfile,
  type NotificationPreferences,
  type ParentProfile,
  useDemo,
} from '@/context/DemoContext';
import { useThemePreference } from '@/context/ThemeContext';
import { useColors } from '@/hooks/useColors';
import { trackingProfileQueryKey } from '@/lib/reportApi';

type MoreSection = 'home' | 'hierarchy' | 'profiles' | 'family' | 'notifications' | 'delete';
type PreferenceKey = keyof NotificationPreferences;

const preferenceRows: { key: PreferenceKey; title: string; detail: string }[] = [
  { key: 'journeyUpdates', title: 'Journey updates', detail: 'Check-ins, route changes, and bus delays' },
  { key: 'safetyAlerts', title: 'Safety alerts', detail: 'Safety notices and simulated SOS activity' },
  { key: 'communityUpdates', title: 'Community reports', detail: 'Updates about family-submitted reports' },
  { key: 'rewardUpdates', title: 'Rewards', detail: 'Points and reward activity' },
];

function formatFamilyDisplayName(familyName: string) {
  const normalized = familyName.trim().replace(/^the\s+/i, '').replace(/\s+family$/i, '').trim();
  return normalized ? `${normalized} Family` : familyName;
}

function trackingErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return error instanceof Error ? error.message : 'Live tracking settings could not be saved.';
}

export function FamilySettings() {
  const colors = useColors();
  const { isDarkMode, setDarkModeEnabled } = useThemePreference();
  const {
    state,
    signOut,
    simulateMissedCheckin,
    saveParentProfile,
    saveChildProfile,
    saveNotificationPreferences,
  } = useDemo();
  const trackingProfile = useGetTrackingProfile({
    query: {
      queryKey: trackingProfileQueryKey(state.account),
      enabled: state.account?.role === 'parent',
      retry: false,
    },
  });
  const [section, setSection] = useState<MoreSection>('home');
  const [parentDraft, setParentDraft] = useState<ParentProfile>(() => ({ ...state.parentProfile }));
  const [childDrafts, setChildDrafts] = useState<Record<string, ChildProfile>>(() =>
    Object.fromEntries(state.familyChildren.map((child) => [
      child.id,
      { name: child.name, school: child.school },
    ])),
  );
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => ({
    ...state.notificationPreferences,
  }));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const clearFeedback = () => {
    setFeedback('');
    setError('');
  };

  const saveParent = async () => {
    if (!parentDraft.name.trim()) {
      setError('Enter the parent’s name before saving.');
      setFeedback('');
      return;
    }
    setSaving(true);
    clearFeedback();
    try {
      await saveParentProfile(parentDraft);
      setFeedback('Parent profile saved on this device.');
    } catch {
      setError('The parent profile could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveChild = async (id: string) => {
    const profile = childDrafts[id];
    if (!profile?.name.trim()) {
      setError('Enter the child’s name before saving.');
      setFeedback('');
      return;
    }
    setSaving(true);
    clearFeedback();
    try {
      await saveChildProfile(id, profile);
      setFeedback('Child profile saved on this device.');
    } catch {
      setError('The child profile could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const togglePreference = async (key: PreferenceKey) => {
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSaving(true);
    clearFeedback();
    try {
      await saveNotificationPreferences(next);
      setFeedback('Notification preferences saved on this device.');
    } catch {
      setPreferences(state.notificationPreferences);
      setError('Notification preferences could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleDarkMode = async (enabled: boolean) => {
    clearFeedback();
    setSaving(true);
    try {
      await setDarkModeEnabled(enabled);
    } catch {
      setFeedback('');
      setError('Appearance changed for this session but could not be saved. It may reset next time.');
    } finally {
      setSaving(false);
    }
  };

  const toggleLiveTracking = async (enabled: boolean) => {
    setSaving(true);
    clearFeedback();
    try {
      await updateTrackingSettings({ enabled });
      await trackingProfile.refetch();
      setFeedback(enabled
        ? 'Live tracking is enabled. Your child can opt in to a current trip from Home.'
        : 'Live tracking is off. Any active sharing has ended.');
    } catch (trackingError) {
      setError(trackingErrorMessage(trackingError));
    } finally {
      setSaving(false);
    }
  };

  const backToMore = () => {
    setSection('home');
    clearFeedback();
  };

  const familyChildren = state.familyChildren.length
    ? state.familyChildren
    : [{ id: 'child-1', ...state.child }];
  const parentCount = state.parentProfile ? 1 : 0;
  const assignedRoute = state.selectedJourney?.name ?? DEFAULT_DEMO_JOURNEY.name;

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Platform.OS === 'web' ? 34 : 24 },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {section === 'home' ? (
        <>
          <ScreenHeader
            eyebrow="Parent account"
            title="Elena"
            subtitle={formatFamilyDisplayName(state.familyName)}
            subtitleStyle={styles.accountScreenSubtitle}
            containerStyle={styles.moreScreenHeader}
          />
          <Text
            testID="family-member-count"
            style={[styles.familyMemberSummary, { color: colors.mutedForeground }]}
          >
            {parentCount} {parentCount === 1 ? 'Parent' : 'Parents'} and {familyChildren.length}{' '}
            {familyChildren.length === 1 ? 'Child' : 'Children'}
          </Text>
          <SectionTitle title="Family" titleStyle={styles.familySectionTitle} />
          <SettingsRow
            title="Family Hierarchy"
            detail="Members, relationships, status, and routes"
            icon="users"
            onPress={() => { clearFeedback(); setSection('hierarchy'); }}
            testID="more-family-hierarchy"
          />
          <SettingsRow
            title="Edit Profiles"
            detail="Update the parent and child profiles"
            icon="user"
            onPress={() => { clearFeedback(); setSection('profiles'); }}
            testID="more-edit-profiles"
          />
          <SettingsRow
            title="Family Invitation Code"
            detail="View invitation code to give to your child"
            icon="settings"
            onPress={() => { clearFeedback(); setSection('family'); }}
            testID="more-family-settings"
          />

          <SectionTitle title="Preferences" titleStyle={styles.familySectionTitle} />
          {state.account?.role === 'parent' ? (
            <View
              style={[
                styles.menuRow,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="navigation" size={18} color={colors.primary} />
              </View>
              <View style={styles.accountCopy}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Child live tracking</Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  Allow the child to opt in for a current trip. You see progress, not exact location.
                </Text>
                {trackingProfile.isLoading ? (
                  <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                    Loading family tracking settings…
                  </Text>
                ) : trackingProfile.isError ? (
                  <Pressable
                    accessibilityRole="button"
                    testID="retry-live-tracking-settings"
                    onPress={() => { void trackingProfile.refetch(); }}
                  >
                    <Text style={[styles.cardBody, { color: colors.warning }]}>
                      {trackingErrorMessage(trackingProfile.error)} Tap to retry.
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Switch
                testID="child-live-tracking-toggle"
                accessibilityLabel="Enable child live tracking"
                value={trackingProfile.data?.liveTrackingEnabled ?? false}
                disabled={
                  saving ||
                  trackingProfile.isLoading ||
                  trackingProfile.isError ||
                  !trackingProfile.data?.children.length
                }
                onValueChange={(enabled) => { void toggleLiveTracking(enabled); }}
                trackColor={{ false: colors.muted, true: colors.primary }}
                thumbColor={trackingProfile.data?.liveTrackingEnabled ? colors.primaryForeground : colors.card}
                ios_backgroundColor={colors.muted}
              />
            </View>
          ) : null}
          <View
            style={[
              styles.menuRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="moon" size={18} color={colors.primary} />
            </View>
            <View style={styles.accountCopy}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Dark mode</Text>
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                Use dark colors throughout PathPal
              </Text>
            </View>
            <Switch
              testID="dark-mode-toggle"
              accessibilityLabel="Dark mode"
              value={isDarkMode}
              disabled={saving}
              onValueChange={(enabled) => { void toggleDarkMode(enabled); }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={isDarkMode ? colors.primaryForeground : colors.card}
              ios_backgroundColor={colors.muted}
            />
          </View>
          <SettingsRow
            title="Notification Preferences"
            detail="Choose which in-app demo alerts appear"
            icon="bell"
            onPress={() => { clearFeedback(); setSection('notifications'); }}
            testID="more-notification-preferences"
          />
          <SettingsRow
            title="Delete Account"
            detail="Unavailable until real accounts are connected"
            icon="trash-2"
            destructive
            onPress={() => { clearFeedback(); setSection('delete'); }}
            testID="more-delete-account"
          />

          {(feedback || error) ? <Feedback message={feedback || error} isError={Boolean(error)} /> : null}

          <SectionTitle title="Journey demo tools" titleStyle={styles.familySectionTitle} />
          <Card style={styles.demoCard}>
            <View style={styles.row}>
              <View style={[styles.demoIcon, { backgroundColor: colors.secondary }]}>
                <Feather name="clock" size={18} color={colors.warning} />
              </View>
              <View style={styles.accountCopy}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Missed check-in demo</Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  Adds an in-app alert. No text message is sent.
                </Text>
              </View>
            </View>
            <Button
              label="Simulate missed check-in"
              variant="secondary"
              onPress={simulateMissedCheckin}
              testID="simulate-missed-checkin"
            />
          </Card>
          <Card tone="soft" style={styles.noteCard}>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
              Family profiles and preferences are stored on this device. Sign-in still uses shared prototype identities.
            </Text>
          </Card>
          <Button label="Sign out" icon="log-out" variant="ghost" onPress={signOut} testID="sign-out" />
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to More"
            testID="settings-back"
            onPress={backToMore}
            style={styles.backButton}
          >
            <Feather name="arrow-left" size={17} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Back to More</Text>
          </Pressable>

          {section === 'hierarchy' ? (
            <>
              <ScreenHeader
                eyebrow="Family account"
                title="Family Hierarchy"
                subtitle={state.familyName}
              />
              <SectionTitle title="Parent and children" />
              <MemberCard
                name={state.parentProfile.name}
                relationship="Parent / guardian"
                status="Active · demo"
                route="No route assigned"
                icon="user"
              />
              {familyChildren.map((child) => (
                <MemberCard
                  key={child.id}
                  name={child.name}
                  relationship="Child"
                  status="Active · demo"
                  route={assignedRoute}
                  icon="smile"
                />
              ))}
              <Card tone="soft" style={styles.noteCard}>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  “Active · demo” describes access in this prototype. It is not a real account verification or security status.
                </Text>
              </Card>
            </>
          ) : null}

          {section === 'profiles' ? (
            <>
              <ScreenHeader
                eyebrow="Family account"
                title="Edit Profiles"
                subtitle="Changes are saved to this device."
              />
              <SectionTitle title="Parent profile" />
              <Card style={styles.formCard}>
                <Field
                  label="Parent name"
                  value={parentDraft.name}
                  onChangeText={(name) => { setParentDraft((current) => ({ ...current, name })); clearFeedback(); }}
                  autoCapitalize="words"
                  testID="parent-profile-name"
                />
                <Field
                  label="Email"
                  value={parentDraft.email}
                  onChangeText={(email) => { setParentDraft((current) => ({ ...current, email })); clearFeedback(); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="parent-profile-email"
                />
                <Field
                  label="Phone"
                  value={parentDraft.phone}
                  onChangeText={(phone) => { setParentDraft((current) => ({ ...current, phone })); clearFeedback(); }}
                  keyboardType="phone-pad"
                  testID="parent-profile-phone"
                />
                <Button
                  label="Save parent profile"
                  icon="check"
                  loading={saving}
                  onPress={() => { void saveParent(); }}
                  testID="save-parent-profile"
                />
              </Card>
              {familyChildren.map((child, index) => {
                const draft = childDrafts[child.id] ?? { name: child.name, school: child.school };
                return (
                  <React.Fragment key={child.id}>
                    <SectionTitle title={`Child profile${familyChildren.length > 1 ? ` ${index + 1}` : ''}`} />
                    <Card style={styles.formCard}>
                      <Field
                        label="Child name"
                        value={draft.name}
                        onChangeText={(name) => {
                          setChildDrafts((current) => ({ ...current, [child.id]: { ...draft, name } }));
                          clearFeedback();
                        }}
                        autoCapitalize="words"
                        testID={`child-profile-name-${child.id}`}
                      />
                      <Field
                        label="School"
                        value={draft.school}
                        onChangeText={(school) => {
                          setChildDrafts((current) => ({ ...current, [child.id]: { ...draft, school } }));
                          clearFeedback();
                        }}
                        testID={`child-profile-school-${child.id}`}
                      />
                      <Button
                        label="Save child profile"
                        icon="check"
                        loading={saving}
                        onPress={() => { void saveChild(child.id); }}
                        testID={`save-child-profile-${child.id}`}
                      />
                    </Card>
                  </React.Fragment>
                );
              })}
              {(feedback || error) ? <Feedback message={feedback || error} isError={Boolean(error)} /> : null}
              <Card tone="soft" style={styles.noteCard}>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  Only family profiles can be edited here. City case managers and city workers are not part of this family account.
                </Text>
              </Card>
            </>
          ) : null}

          {section === 'family' ? (
            <>
              <ScreenHeader
                eyebrow="Family account"
                title="Family Invitation Code"
                subtitle="Share this secure family code with your child so they can join your family."
              />
              <Card style={styles.formCard}>
                <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>Child invitation code</Text>
                {state.invitationCode ? (
                  <Text
                    selectable
                    accessibilityLabel={`Family invitation code ${state.invitationCode}`}
                    style={[styles.codeValue, { color: colors.foreground }]}
                    testID="family-invitation-code"
                  >
                    {state.invitationCode}
                  </Text>
                ) : (
                  <Text style={[styles.codeHelp, { color: colors.destructive }]}>
                    {state.account?.familyServiceError ?? 'The family code is unavailable. Sign in again while connected to retrieve it.'}
                  </Text>
                )}
                {state.invitationCode ? (
                  <Text style={[styles.codeHelp, { color: colors.mutedForeground }]}>
                    Generated by PathPal and shared across devices. The demo sign-in is still shared.
                  </Text>
                ) : null}
              </Card>
            </>
          ) : null}

          {section === 'notifications' ? (
            <>
              <ScreenHeader
                eyebrow="Preferences"
                title="Notification Preferences"
                subtitle="Control which new in-app demo alerts are added."
              />
              <Card style={styles.preferenceCard}>
                {preferenceRows.map((row, index) => (
                  <React.Fragment key={row.key}>
                    {index > 0 ? <View style={[styles.separator, { backgroundColor: colors.border }]} /> : null}
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: preferences[row.key], disabled: saving }}
                      accessibilityLabel={row.title}
                      testID={`preference-${row.key}`}
                      disabled={saving}
                      onPress={() => { void togglePreference(row.key); }}
                      style={styles.preferenceRow}
                    >
                      <View style={styles.preferenceCopy}>
                        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{row.title}</Text>
                        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{row.detail}</Text>
                      </View>
                      <View
                        style={[
                          styles.switchTrack,
                          { backgroundColor: preferences[row.key] ? colors.primary : colors.muted },
                        ]}
                      >
                        <View
                          style={[
                            styles.switchThumb,
                            {
                              backgroundColor: colors.card,
                              alignSelf: preferences[row.key] ? 'flex-end' : 'flex-start',
                            },
                          ]}
                        />
                      </View>
                    </Pressable>
                  </React.Fragment>
                ))}
              </Card>
              {(feedback || error) ? <Feedback message={feedback || error} isError={Boolean(error)} /> : null}
              <Card tone="soft" style={styles.noteCard}>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  These preferences control in-app prototype alerts only. Push notifications and text messages are not connected.
                </Text>
              </Card>
            </>
          ) : null}

          {section === 'delete' ? (
            <>
              <ScreenHeader
                eyebrow="Account"
                title="Delete Account"
                subtitle="Account deletion is not available in the demo."
              />
              <Card style={styles.deleteCard}>
                <View style={[styles.deleteIcon, { backgroundColor: colors.destructive }]}>
                  <Feather name="lock" size={24} color={colors.destructiveForeground} />
                </View>
                <Text style={[styles.deleteTitle, { color: colors.foreground }]}>Real accounts are not connected</Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  This prototype uses shared sample sign-in. It cannot delete a real parent account or reliably disable a child account across devices.
                </Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                  No account, profile, invitation code, or saved data will be changed from this screen.
                </Text>
                <Button
                  label="Account deletion unavailable"
                  icon="lock"
                  variant="danger"
                  disabled
                  onPress={() => undefined}
                  testID="delete-account-unavailable"
                />
              </Card>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function SettingsRow({
  title,
  detail,
  icon,
  destructive = false,
  onPress,
  testID,
}: {
  title: string;
  detail: string;
  icon: keyof typeof Feather.glyphMap;
  destructive?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View style={[styles.menuIcon, { backgroundColor: destructive ? colors.destructive : colors.secondary }]}>
        <Feather name={icon} size={18} color={destructive ? colors.destructiveForeground : colors.primary} />
      </View>
      <View style={styles.accountCopy}>
        <Text style={[styles.cardTitle, { color: destructive ? colors.destructive : colors.foreground }]}>{title}</Text>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{detail}</Text>
      </View>
      <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
    </Pressable>
  );
}

function MemberCard({
  name,
  relationship,
  status,
  route,
  icon,
}: {
  name: string;
  relationship: string;
  status: string;
  route: string;
  icon: keyof typeof Feather.glyphMap;
}) {
  const colors = useColors();
  return (
    <Card style={styles.memberCard}>
      <View style={styles.memberHeader}>
        <View style={[styles.memberIcon, { backgroundColor: colors.secondary }]}>
          <Feather name={icon} size={20} color={colors.primary} />
        </View>
        <View style={styles.accountCopy}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{name}</Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{relationship}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.statusText, { color: colors.accentForeground }]}>{status}</Text>
        </View>
      </View>
      <View style={[styles.separator, { backgroundColor: colors.border }]} />
      <DetailRow label="Assigned route" value={route} icon="navigation" />
      <DetailRow label="Relationship" value={relationship} icon="users" />
    </Card>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLabel}>
        <Feather name={icon} size={14} color={colors.mutedForeground} />
        <Text style={[styles.detailText, { color: colors.mutedForeground }]}>{label}</Text>
      </View>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function Feedback({ message, isError }: { message: string; isError: boolean }) {
  const colors = useColors();
  return (
    <View
      accessibilityRole={isError ? 'alert' : 'text'}
      style={[
        styles.feedback,
        {
          backgroundColor: isError ? colors.destructive : colors.accent,
          borderColor: isError ? colors.destructive : colors.border,
        },
      ]}
    >
      <Feather
        name={isError ? 'alert-circle' : 'check-circle'}
        size={16}
        color={isError ? colors.destructiveForeground : colors.accentForeground}
      />
      <Text style={[styles.feedbackText, { color: isError ? colors.destructiveForeground : colors.accentForeground }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 22, gap: 11 },
  accountCopy: { flex: 1, gap: 4 },
  moreScreenHeader: { marginBottom: 0 },
  accountScreenSubtitle: { fontFamily: 'Inter_600SemiBold', fontSize: 19 },
  familyMemberSummary: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20 },
  familySectionTitle: { fontSize: 24 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 20 },
  cardBody: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  menuRow: { minHeight: 75, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11 },
  menuIcon: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  demoCard: { gap: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  demoIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  noteCard: { padding: 14 },
  backButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 38, gap: 8, marginBottom: 4 },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  memberCard: { gap: 12 },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  memberIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12 },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  separator: { height: StyleSheet.hairlineWidth, width: '100%', marginVertical: 3 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  detailLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  detailText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  detailValue: { flex: 1, textAlign: 'right', fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 17 },
  formCard: { gap: 14 },
  codeLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  codeValue: { fontFamily: 'Inter_700Bold', fontSize: 32, letterSpacing: 4, lineHeight: 40 },
  codeHelp: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  feedback: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderWidth: 1, borderRadius: 14 },
  feedbackText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 17 },
  preferenceCard: { paddingVertical: 4, gap: 0 },
  preferenceRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 },
  preferenceCopy: { flex: 1, gap: 4 },
  switchTrack: { width: 47, height: 28, borderRadius: 16, justifyContent: 'center', paddingHorizontal: 3 },
  switchThumb: { width: 22, height: 22, borderRadius: 11 },
  deleteCard: { alignItems: 'flex-start', gap: 14 },
  deleteIcon: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  deleteTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 24 },
});