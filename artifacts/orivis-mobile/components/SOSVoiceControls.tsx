import { Feather } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  summarizeSosVoice,
  type SOSVoiceChunkInputFormat,
  type SOSVoiceSource,
  type SOSVoiceSummaryResponse,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useDemo } from '@/context/DemoContext';

const VOICE_CHUNK_MS = 4_000;

function sourceLabel(source: SOSVoiceSource): string {
  if (source === 'child_confirmed') return "Child's words (confirmed)";
  if (source === 'unverified_audio_clue') return 'Unverified background clue';
  return 'Speaker unknown';
}

function sourceDescription(source: SOSVoiceSource): string {
  if (source === 'child_confirmed') return 'You marked this as your speech; the automatic transcript may still be wrong.';
  if (source === 'unverified_audio_clue') return 'Background speech or location clue is not independently verified.';
  return 'The speaker cannot be determined from the recording.';
}

function audioFormat(uri: string): SOSVoiceChunkInputFormat {
  const extension = uri.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase();
  if (extension === 'm4a' || extension === 'mp4' || extension === 'wav' ||
      extension === 'mp3' || extension === 'webm' || extension === '3gp') {
    return extension;
  }
  return Platform.OS === 'web' ? 'webm' : 'm4a';
}

async function readAudioAsBase64(uri: string): Promise<string> {
  if (Platform.OS !== 'web') {
    return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error('The short recording could not be read.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return btoa(binary);
}

async function deleteTemporaryAudio(uri: string): Promise<void> {
  if (Platform.OS === 'web' && uri.startsWith('blob:')) {
    URL.revokeObjectURL(uri);
    return;
  }
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

export function SOSVoiceControls() {
  const colors = useColors();
  const {
    state,
    sendSOSVoiceChunk,
    correctSOSVoiceTranscript,
    shareSOSVoiceSummary,
  } = useDemo();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(null);
  const playbackStatus = useAudioPlayerStatus(player);
  const voiceMessages = useMemo(
    () => state.sosMessages.filter((message) => message.sender === 'child' && message.source === 'voice'),
    [state.sosMessages],
  );
  const sharedSummaries = state.sosEvents[0]?.sharedMessages ?? [];

  const [sessionActive, setSessionActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [spokenReplies, setSpokenReplies] = useState(false);
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [summary, setSummary] = useState<SOSVoiceSummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftSource, setDraftSource] = useState<SOSVoiceSource>('unknown');
  const [sharedSummary, setSharedSummary] = useState(false);

  const sessionRef = useRef(false);
  const recordingRef = useRef(false);
  const processingRef = useRef(false);
  const spokenRepliesRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordNextRef = useRef<() => Promise<void>>(async () => undefined);
  const processChunkRef = useRef<() => Promise<void>>(async () => undefined);
  const audioUriRef = useRef<string | null>(null);

  useEffect(() => {
    player.volume = volume;
  }, [player, volume]);

  const clearReplyAudio = useCallback(async () => {
    player.pause();
    const oldUri = audioUriRef.current;
    audioUriRef.current = null;
    setAudioUri(null);
    if (oldUri) await deleteTemporaryAudio(oldUri);
  }, [player]);

  const playReply = useCallback(async (base64: string) => {
    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) throw new Error('Temporary audio storage is unavailable.');
    await clearReplyAudio();
    const uri = `${cacheDirectory}sos-reply-${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
    audioUriRef.current = uri;
    setAudioUri(uri);
    player.replace({ uri });
    player.volume = volume;
    player.play();
  }, [clearReplyAudio, player, volume]);

  const removeRecordedClip = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    recordingRef.current = false;
    setRecording(false);
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // The component may have been stopped while the recorder was preparing.
    }
    const uri = recorder.uri;
    if (uri) await deleteTemporaryAudio(uri);
  }, [recorder]);

  const stopVoiceSession = useCallback(async (message?: string) => {
    sessionRef.current = false;
    setSessionActive(false);
    await removeRecordedClip();
    await clearReplyAudio();
    await setAudioModeAsync({
      allowsRecording: false,
      shouldPlayInBackground: false,
    }).catch(() => undefined);
    if (message) setNotice(message);
  }, [clearReplyAudio, removeRecordedClip]);

  const recordNextChunk = useCallback(async () => {
    if (!sessionRef.current || !state.sosActive || recordingRef.current || processingRef.current) return;
    try {
      await recorder.prepareToRecordAsync();
      if (!sessionRef.current || !state.sosActive) return;
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
      setNotice('Listening for up to 4 seconds. The microphone indicator is on.');
      timerRef.current = setTimeout(() => {
        void processChunkRef.current();
      }, VOICE_CHUNK_MS);
    } catch {
      await stopVoiceSession('Microphone could not start. Check permission or continue with text chat.');
    }
  }, [recorder, state.sosActive, stopVoiceSession]);

  const processChunk = useCallback(async () => {
    if (!recordingRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    recordingRef.current = false;
    setRecording(false);
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      if (!uri) throw new Error('The recording was empty.');
      if (!sessionRef.current || !state.sosActive) return;
      processingRef.current = true;
      setProcessing(true);
      setNotice('Processing this short clip. Its transcript is not final until the reply arrives.');
      const encoded = await readAudioAsBase64(uri);
      const response = await sendSOSVoiceChunk(
        encoded,
        audioFormat(uri),
        spokenRepliesRef.current,
      );
      if (!sessionRef.current || !state.sosActive) return;
      setNotice(response.available
        ? 'Transcript ready. Review and correct it before creating or sharing a summary.'
        : 'AI voice guidance is unavailable. The prepared safety response is shown in the chat.');
      if (spokenRepliesRef.current && response.audioBase64) {
        await playReply(response.audioBase64);
      }
    } catch {
      if (sessionRef.current) {
        setNotice('Voice processing failed. The temporary clip was deleted; use text chat or try another short clip.');
      }
    } finally {
      if (uri) await deleteTemporaryAudio(uri);
      processingRef.current = false;
      setProcessing(false);
      if (sessionRef.current && state.sosActive) {
        timerRef.current = setTimeout(() => {
          void recordNextRef.current();
        }, 350);
      }
    }
  }, [playReply, recorder, sendSOSVoiceChunk, state.sosActive]);

  recordNextRef.current = recordNextChunk;
  processChunkRef.current = processChunk;

  const startVoiceSession = useCallback(async () => {
    if (state.account?.role !== 'child') {
      setNotice('Voice chat is available only to an approved child account.');
      return;
    }
    if (!state.sosActive || sessionRef.current) return;
    setNotice('Requesting microphone permission…');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setNotice('Microphone permission was not granted. You can continue with text chat.');
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'doNotMix',
      });
      sessionRef.current = true;
      setSessionActive(true);
      setNotice('Voice chat is on. Clips are processed one at a time; replies may take a few seconds.');
      await recordNextRef.current();
    } catch {
      await stopVoiceSession('Voice chat could not start. Continue with text chat or try again.');
    }
  }, [state.account?.role, state.sosActive, stopVoiceSession]);

  const pauseVoiceSession = useCallback(() => {
    void stopVoiceSession(processingRef.current
      ? 'Voice paused. The current clip is still processing; no new recording will start.'
      : 'Voice paused. The microphone is off.');
  }, [stopVoiceSession]);

  const stopVoiceSessionAndReset = useCallback(() => {
    void stopVoiceSession('Voice chat stopped. No new audio is being recorded.');
  }, [stopVoiceSession]);

  useEffect(() => {
    if (!state.sosActive) {
      void stopVoiceSession();
      setSummary(null);
      setEditingId(null);
    }
  }, [state.sosActive, stopVoiceSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && sessionRef.current) {
        void stopVoiceSession('Voice chat stopped because the app moved to the background.');
      }
    });
    return () => subscription.remove();
  }, [stopVoiceSession]);

  useEffect(() => () => {
    sessionRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (recorder.isRecording) void recorder.stop();
    player.pause();
    const oldUri = audioUriRef.current;
    if (oldUri) void deleteTemporaryAudio(oldUri);
  }, [player, recorder]);

  const beginEdit = useCallback((messageId: string, currentText: string, source: SOSVoiceSource) => {
    setEditingId(messageId);
    setDraftText(currentText);
    setDraftSource(source);
  }, []);

  const saveCorrection = useCallback(() => {
    if (!editingId || !draftText.trim()) return;
    correctSOSVoiceTranscript(editingId, draftText.trim(), draftSource);
    setEditingId(null);
    setSummary(null);
    setSharedSummary(false);
    setSummaryError('');
  }, [correctSOSVoiceTranscript, draftSource, draftText, editingId]);

  const createSummary = useCallback(async () => {
    if (voiceMessages.length === 0) return;
    setSummarizing(true);
    setSummaryError('');
    setSharedSummary(false);
    try {
      const result = await summarizeSosVoice({
        messages: voiceMessages.slice(-20).map((message) => ({
          text: message.text,
          createdAt: message.createdAt,
          source: message.transcriptSource ?? 'unknown',
        })),
      });
      setSummary(result);
    } catch {
      setSummaryError('The summary is unavailable. Your reviewed transcripts are still private in this active demo session.');
    } finally {
      setSummarizing(false);
    }
  }, [voiceMessages]);

  const shareSummary = useCallback(() => {
    if (!summary) return;
    const content = [
      'Reviewed SOS voice summary · simulation only',
      summary.summary,
      ...summary.highlights.map((highlight) =>
        `• ${highlight.detail} — ${sourceLabel(highlight.source)}. ${highlight.uncertainty}`),
      'No audio was shared. These notes are not an emergency dispatch.',
    ].join('\n');
    shareSOSVoiceSummary(content);
    setSharedSummary(true);
  }, [shareSOSVoiceSummary, summary]);

  const adjustVolume = useCallback((delta: number) => {
    setVolume((current) => Math.max(0, Math.min(1, Math.round((current + delta) * 10) / 10)));
  }, []);

  const roleAllowed = state.account?.role === 'child';
  const sourceOptions: Array<{ value: SOSVoiceSource; label: string }> = [
    { value: 'unknown', label: 'Unknown speaker' },
    { value: 'child_confirmed', label: 'My words' },
    { value: 'unverified_audio_clue', label: 'Background clue' },
  ];

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>Optional SOS voice chat</Text>
          <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
            Starts only when you allow it. PathPal records short clips, sends them to managed OpenAI for transcription and a reply, then deletes the app’s temporary clip. Transcripts stay in this active session and are never sent to notifications or police contacts. Only a reviewed summary can be shared with the simulated trusted contact.
          </Text>
          <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
            Voice works in short turns, not live streaming; replies may take a few seconds. Recording and playback stop when the app backgrounds or this SOS ends.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse voice chat controls' : 'Expand voice chat controls'}
          onPress={() => setExpanded((value) => !value)}
          style={[styles.smallIconButton, { backgroundColor: colors.muted }]}
        >
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {expanded ? (
        <ScrollView style={styles.expandedContent} keyboardShouldPersistTaps="handled">
          {!roleAllowed ? (
            <Text style={[styles.notice, { color: colors.mutedForeground }]}>
              Voice chat is available only to an approved child account.
            </Text>
          ) : (
            <View style={styles.controls}>
              {!sessionActive ? (
                <ActionButton
                  label="Start voice chat"
                  icon="mic"
                  color={colors.destructive}
                  textColor={colors.destructiveForeground}
                  onPress={() => void startVoiceSession()}
                  disabled={!state.sosActive || processing}
                />
              ) : (
                <>
                  <ActionButton
                    label="Pause"
                    icon="pause"
                    color={colors.muted}
                    textColor={colors.foreground}
                    onPress={pauseVoiceSession}
                    disabled={false}
                  />
                  <ActionButton
                    label="Stop"
                    icon="square"
                    color={colors.muted}
                    textColor={colors.foreground}
                    onPress={stopVoiceSessionAndReset}
                    disabled={false}
                  />
                </>
              )}
              <View style={styles.statusRow} accessibilityLiveRegion="polite">
                <View style={[styles.statusDot, { backgroundColor: recording ? colors.destructive : processing ? colors.primary : colors.mutedForeground }]} />
                <Text style={[styles.notice, { color: colors.mutedForeground }]}>
                  {recording ? 'Microphone on · recording a short clip' : processing ? 'Clip processing · transcript pending' : notice || 'Microphone off'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: spokenReplies }}
                onPress={() => {
                  const next = !spokenRepliesRef.current;
                  spokenRepliesRef.current = next;
                  setSpokenReplies(next);
                }}
                style={styles.optionRow}
              >
                <Feather name={spokenReplies ? 'check-square' : 'square'} size={18} color={colors.primary} />
                <Text style={[styles.optionLabel, { color: colors.foreground }]}>Speak AI replies aloud (off by default)</Text>
              </Pressable>
              {audioUri ? (
                <View style={styles.volumeRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={playbackStatus.playing ? 'Pause spoken reply' : 'Play spoken reply'}
                    onPress={() => playbackStatus.playing ? player.pause() : player.play()}
                    style={[styles.volumeButton, { backgroundColor: colors.muted }]}
                  >
                    <Feather name={playbackStatus.playing ? 'pause' : 'play'} size={16} color={colors.foreground} />
                  </Pressable>
                  <Text style={[styles.volumeLabel, { color: colors.mutedForeground }]}>Reply volume {Math.round(volume * 100)}%</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease reply volume"
                    onPress={() => adjustVolume(-0.1)}
                    style={[styles.volumeButton, { backgroundColor: colors.muted }]}
                  >
                    <Feather name="minus" size={16} color={colors.foreground} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase reply volume"
                    onPress={() => adjustVolume(0.1)}
                    style={[styles.volumeButton, { backgroundColor: colors.muted }]}
                  >
                    <Feather name="plus" size={16} color={colors.foreground} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}

          <View style={[styles.transcriptSection, { borderTopColor: colors.border }]}>
            <View style={styles.headingRow}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Voice transcripts · review before sharing</Text>
              <Text style={[styles.count, { color: colors.mutedForeground }]}>{voiceMessages.length}</Text>
            </View>
            {voiceMessages.length === 0 ? (
              <Text style={[styles.notice, { color: colors.mutedForeground }]}>No voice transcript yet. Text chat works without microphone access.</Text>
            ) : (
              <View style={styles.transcriptList}>
                {voiceMessages.slice(-5).map((message) => {
                  const source = message.transcriptSource ?? 'unknown';
                  const isEditing = editingId === message.id;
                  return (
                    <View key={message.id} style={[styles.transcriptItem, { backgroundColor: colors.muted }]}>
                      <View style={styles.transcriptHeader}>
                        <View style={styles.transcriptMeta}>
                          <Text style={[styles.sourceLabel, { color: colors.primary }]}>{sourceLabel(source)}</Text>
                          <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
                            {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </Text>
                        </View>
                        {!isEditing ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => beginEdit(message.id, message.text, source)}
                            style={styles.editButton}
                          >
                            <Feather name="edit-2" size={14} color={colors.primary} />
                            <Text style={[styles.editLabel, { color: colors.primary }]}>Correct</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {isEditing ? (
                        <>
                          <TextInput
                            value={draftText}
                            onChangeText={setDraftText}
                            multiline
                            maxLength={1200}
                            accessibilityLabel="Correct voice transcript"
                            placeholder="Correct the transcript"
                            placeholderTextColor={colors.mutedForeground}
                            style={[styles.transcriptInput, { color: colors.foreground, borderColor: colors.border }]}
                          />
                          <Text style={[styles.sourcePrompt, { color: colors.mutedForeground }]}>Choose a source label; PathPal will not guess who spoke.</Text>
                          <View style={styles.sourceOptions}>
                            {sourceOptions.map((option) => (
                              <Pressable
                                key={option.value}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: draftSource === option.value }}
                                onPress={() => setDraftSource(option.value)}
                                style={[
                                  styles.sourceChip,
                                  {
                                    backgroundColor: draftSource === option.value ? colors.primary : colors.card,
                                    borderColor: colors.border,
                                  },
                                ]}
                              >
                                <Text style={[styles.sourceChipText, { color: draftSource === option.value ? colors.primaryForeground : colors.foreground }]}>
                                  {option.label}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          <Text style={[styles.uncertainty, { color: colors.mutedForeground }]}>{sourceDescription(draftSource)}</Text>
                          <View style={styles.editActions}>
                            <ActionButton
                              label="Save correction"
                              icon="check"
                              color={colors.primary}
                              textColor={colors.primaryForeground}
                              onPress={saveCorrection}
                              disabled={!draftText.trim()}
                            />
                            <ActionButton
                              label="Cancel"
                              icon="x"
                              color={colors.muted}
                              textColor={colors.foreground}
                              onPress={() => setEditingId(null)}
                              disabled={false}
                            />
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={[styles.transcriptText, { color: colors.foreground }]}>{message.text}</Text>
                          <Text style={[styles.uncertainty, { color: colors.mutedForeground }]}>{sourceDescription(source)}</Text>
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
            <ActionButton
              label={summarizing ? 'Creating summary…' : 'Create summary for review'}
              icon="file-text"
              color={colors.primary}
              textColor={colors.primaryForeground}
              onPress={() => void createSummary()}
              disabled={voiceMessages.length === 0 || summarizing || Boolean(editingId)}
            />
            {summaryError ? <Text style={[styles.error, { color: colors.destructive }]}>{summaryError}</Text> : null}
            {summary ? (
              <View style={[styles.summaryCard, { backgroundColor: colors.muted }]}>
                <Text style={[styles.sourceLabel, { color: colors.primary }]}>AI summary · review before sharing</Text>
                <Text style={[styles.summaryText, { color: colors.foreground }]}>{summary.summary}</Text>
                {summary.highlights.map((highlight, index) => (
                  <View key={`${highlight.createdAt}-${index}`} style={styles.highlight}>
                    <Text style={[styles.transcriptText, { color: colors.foreground }]}>• {highlight.detail}</Text>
                    <Text style={[styles.uncertainty, { color: colors.mutedForeground }]}>
                      {sourceLabel(highlight.source)} · {highlight.uncertainty}
                    </Text>
                  </View>
                ))}
                <ActionButton
                  label={sharedSummary ? 'Summary shared with demo contact' : 'Share reviewed summary with simulated contact'}
                  icon={sharedSummary ? 'check' : 'send'}
                  color={sharedSummary ? colors.muted : colors.primary}
                  textColor={sharedSummary ? colors.foreground : colors.primaryForeground}
                  onPress={shareSummary}
                  disabled={sharedSummary}
                />
              </View>
            ) : null}
          </View>

          <View style={[styles.transcriptSection, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Simulated trusted-contact panel</Text>
            <Text style={[styles.notice, { color: colors.mutedForeground }]}>Only summaries you explicitly share appear here. Audio and full transcripts are never included.</Text>
            {sharedSummaries.length === 0 ? (
              <Text style={[styles.notice, { color: colors.mutedForeground }]}>Nothing has been shared.</Text>
            ) : sharedSummaries.slice(-3).map((item, index) => (
              <Text key={`${index}-${item.slice(0, 20)}`} style={[styles.sharedSummary, { color: colors.foreground, backgroundColor: colors.muted }]}>
                {item}
              </Text>
            ))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  icon,
  color,
  textColor,
  onPress,
  disabled,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  textColor: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, { backgroundColor: color, opacity: disabled ? 0.55 : 1 }]}
    >
      <Feather name={icon} size={16} color={textColor} />
      <Text style={[styles.actionLabel, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 14,
  },
  headingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  headingCopy: { flex: 1, gap: 5 },
  title: { fontSize: 16, fontWeight: '700' },
  disclosure: { fontSize: 12, lineHeight: 17 },
  expandedContent: { maxHeight: 340, marginTop: 2 },
  smallIconButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  controls: { gap: 10, marginTop: 12 },
  actionButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  actionLabel: { fontSize: 13, fontWeight: '700' },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  statusDot: { borderRadius: 5, height: 10, width: 10 },
  notice: { fontSize: 12, lineHeight: 17 },
  optionRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44 },
  optionLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  volumeRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  volumeButton: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  volumeLabel: { flex: 1, fontSize: 12 },
  transcriptSection: { borderTopWidth: StyleSheet.hairlineWidth, gap: 10, marginTop: 14, paddingTop: 14 },
  sectionTitle: { flex: 1, fontSize: 14, fontWeight: '700' },
  count: { fontSize: 12 },
  transcriptList: { gap: 0 },
  transcriptItem: { borderRadius: 10, gap: 7, marginBottom: 8, padding: 10 },
  transcriptHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  transcriptMeta: { flex: 1, gap: 2 },
  sourceLabel: { fontSize: 11, fontWeight: '700' },
  timestamp: { fontSize: 10 },
  editButton: { alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: 36, paddingHorizontal: 6 },
  editLabel: { fontSize: 12, fontWeight: '700' },
  transcriptText: { fontSize: 13, lineHeight: 18 },
  uncertainty: { fontSize: 11, lineHeight: 15 },
  transcriptInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
    lineHeight: 19,
    minHeight: 72,
    padding: 10,
    textAlignVertical: 'top',
  },
  sourcePrompt: { fontSize: 11, lineHeight: 15 },
  sourceOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sourceChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 },
  sourceChipText: { fontSize: 11, fontWeight: '600' },
  editActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryCard: { borderRadius: 10, gap: 8, padding: 10 },
  summaryText: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  highlight: { gap: 2, paddingVertical: 3 },
  error: { fontSize: 12, lineHeight: 17 },
  sharedSummary: { borderRadius: 8, fontSize: 12, lineHeight: 17, padding: 9 },
});