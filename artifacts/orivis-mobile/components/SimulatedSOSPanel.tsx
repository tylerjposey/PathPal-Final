import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Chip } from '@/components/OrivisUI';
import { useDemo } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';

const PRACTICE_SIGNALS = [
  'At a safe place',
  'With a trusted adult',
  'Need an adult',
  'Need help',
];

export function SimulatedSOSPanel() {
  const colors = useColors();
  const { state, activateSOS, setSOSSignal, sendSOSMessage, endSOS } = useDemo();
  const [draft, setDraft] = useState('');
  const canSend = draft.trim().length > 0 && state.sosActive;

  return (
    <View testID="simulated-sos-practice">
      <Card tone={state.sosActive ? 'danger' : 'soft'} style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.iconWrap, { backgroundColor: state.sosActive ? colors.destructive : colors.secondary }]}>
            <Feather name="shield" size={19} color={state.sosActive ? colors.destructiveForeground : colors.primary} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.foreground }]}>SOS practice</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Simulation only. No emergency services or contacts are called or messaged.
            </Text>
          </View>
        </View>

        {!state.sosActive ? (
          <Button
            label="Start SOS practice"
            icon="shield"
            variant="secondary"
            onPress={activateSOS}
            testID="start-simulated-sos"
          />
        ) : (
          <>
            <View style={styles.activeLabel}>
              <Feather name="radio" size={15} color={colors.destructive} />
              <Text style={[styles.bodyStrong, { color: colors.destructive }]}>Practice session active on this device</Text>
            </View>

            <View style={styles.signals}>
              {PRACTICE_SIGNALS.map((signal) => (
                <Chip
                  key={signal}
                  label={signal}
                  active={state.sosTriggers.includes(signal)}
                  onPress={() => setSOSSignal(signal)}
                />
              ))}
            </View>

            <View style={styles.messages} accessibilityLiveRegion="polite">
              {state.sosMessages.slice(-6).map((message) => (
                <View key={message.id} style={[styles.message, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.messageSender, { color: message.sender === 'child' ? colors.primary : colors.mutedForeground }]}>
                    {message.sender === 'child' ? 'Practice message' : 'Practice guide'}
                  </Text>
                  <Text style={[styles.body, { color: colors.foreground }]}>{message.text}</Text>
                </View>
              ))}
            </View>

            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Write a practice message"
                placeholderTextColor={colors.mutedForeground}
                maxLength={180}
                multiline
                accessibilityLabel="Practice SOS message"
                testID="simulated-sos-message"
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add practice message"
                accessibilityState={{ disabled: !canSend }}
                disabled={!canSend}
                testID="send-simulated-sos-message"
                onPress={() => {
                  const cleanDraft = draft.trim();
                  if (!cleanDraft) return;
                  sendSOSMessage(cleanDraft);
                  setDraft('');
                }}
                style={[styles.sendButton, { backgroundColor: canSend ? colors.primary : colors.muted }]}
              >
                <Feather name="send" size={17} color={canSend ? colors.primaryForeground : colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.caption, { color: colors.mutedForeground }]}>
              Practice messages and signals are stored only in this app's local demo state.
            </Text>
            <Button label="End practice" icon="x-circle" variant="secondary" onPress={endSOS} testID="end-simulated-sos" />
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 3 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 23 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  bodyStrong: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 18 },
  activeLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  signals: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  messages: { gap: 7 },
  message: { borderWidth: 1, borderRadius: 15, padding: 11, gap: 3 },
  messageSender: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 96, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 10, fontFamily: 'Inter_400Regular', fontSize: 13 },
  sendButton: { height: 44, width: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
});