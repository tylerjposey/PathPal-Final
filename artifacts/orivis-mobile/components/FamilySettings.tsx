import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
import {
  DEFAULT_DEMO_JOURNEY,
  type ChildProfile,
  type NotificationPreferences,
  type ParentProfile,
  useDemo,
} from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';

type MoreSection = 'home' | 'hierarchy' | 'profiles' | 'family' | 'notifications' | 'delete';
type PreferenceKey = keyof NotificationPreferences;

const preferenceRows: { key: PreferenceKey; title: string; detail: string }[] = [
  { key: 'journeyUpdates', title: 'Journey updates', detail: 'Check-ins, route changes, and bus delays' },
  { key: 'safetyAlerts', title: 'Safety alerts', detail: 'Safety notices and simulated SOS activity' },
  { key: 'communityUpdates', title: 'Community reports', detail: 'Updates about family-submitted reports' },
  { key: 'rewardUpdates', title: 'Rewards', detail: 'Points and reward activity' },
];

export function FamilySettings() {
  const colors = useColors();
  const {
    state,
    signOut,
    simulateMissedCheckin,
    saveParentProfile,
    saveChildProfile,
    saveFamilySettings,
    saveNotificationPreferences,
  } = useDemo();
  const [section, setSection] = useState<MoreSection>('home');
  const [parentDraft, setParentDraft] = useState<ParentProfile>(() => ({ ...state.parentProfile }));
  const [childDrafts, setChildDrafts] = useState<Record<string, ChildProfile>>(() =>
    Object.fromEntries(state.familyChildren.map((child) => [
      child.id,
      { name: child.name, school: child.school },
    ])),
  );
  const [familyDraft, setFamilyDraft] = useState(() => ({
    familyName: state.familyName,
    invitationCode: state.invitationCode,
  }));
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

  const saveFamily = async () => {
    if (!familyDraft.familyName.trim() || !familyDraft.invitationCode.trim()) {
      setError('Enter a family name and invitation code before saving.');
      setFeedback('');
      return;
    }
    setSaving(true);
    clearFeedback();
    try {
      await saveFamilySettings(familyDraft);
      setFeedback('Family account settings saved on this device.');
    } catch {
      setError('Family account settings could not be saved. Please try again.');
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

  const backToMore = () => {
    setSection('home');
    clearFeedback();
  };

  const familyChildren = state.familyChildren.length
    ? state.familyChildren
    : [{ id: 'child-1', ...state.child }];
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
            subtitle={state.familyName}
            subtitleStyle={[
              styles.accountScreenSubtitle,
              { color: colors.familySubtitleForeground },
            ]}
          />
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
            title="Family Account Settings"
            detail="Family name and invitation code"
            icon="settings"
            onPress={() => { clearFeedback(); setSection('family'); }}
            testID="more-family-settings"
          />

          <SectionTitle title="Preferences" titleStyle={styles.familySectionTitle} />
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
                title="Family Account Settings"
                subtitle="Manage the family name and child invitation code."
              />
              <Card style={styles.formCard}>
                <Field
                  label="Family name"
                  value={familyDraft.familyName}
                  onChangeText={(familyName) => { setFamilyDraft((current) => ({ ...current, familyName })); clearFeedback(); }}
                  testID="family-account-name"
                />
                <Field
                  label="Child invitation code"
                  value={familyDraft.invitationCode}
                  onChangeText={(invitationCode) => { setFamilyDraft((current) => ({ ...current, invitationCode })); clearFeedback(); }}
                  autoCapitalize="none"
                  testID="family-invitation-code"
                />
                {(feedback || error) ? <Feedback message={feedback || error} isError={Boolean(error)} /> : null}
                <Button
                  label="Save family settings"
                  icon="check"
                  loading={saving}
                  onPress={() => { void saveFamily(); }}
                  testID="save-family-settings"
                />
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
  accountScreenSubtitle: { fontFamily: 'Inter_600SemiBold', fontSize: 19 },
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