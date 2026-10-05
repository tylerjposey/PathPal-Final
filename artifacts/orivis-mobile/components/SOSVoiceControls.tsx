import { Feather } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  type AudioPlayer,
  type AudioRecorder,
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
  const [starting, setStarting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftSource, setDraftSource] = useState<SOSVoiceSource>('unknown');
  const [sharedSummary, setSharedSummary] = useState(false);

  const mountedRef = useRef(false);
  const sessionRef = useRef(false);
  const sessionGenerationRef = useRef(0);
  const startingRef = useRef(false);
  const recordingRef = useRef(false);
  const recorderPreparedRef = useRef(false);
  const recordingStartRef = useRef(false);
  const processingRef = useRef(false);
  const audioRecordingModeRef = useRef(false);
  const spokenRepliesRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordNextRef = useRef<(generation: number) => Promise<void>>(async () => undefined);
  const processChunkRef = useRef<(generation: number) => Promise<void>>(async () => undefined);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const preparePromiseRef = useRef<Promise<void> | null>(null);
  const recorderStopPromiseRef = useRef<Promise<void> | null>(null);
  const sessionStopPromiseRef = useRef<Promise<void> | null>(null);
  const recorderClipUriRef = useRef<string | null>(null);
  const processingClipUriRef = useRef<string | null>(null);
  const audioUriRef = useRef<string | null>(null);
  const playerPlayingRef = useRef(false);
  const summaryGenerationRef = useRef(0);
  const unmountAudioCleanupRef = useRef<() => void>(() => undefined);

  // Register teardown before the audio hooks register their own release effects.
  // The hooks own native-object release; this cleanup only stops active audio first.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current = false;
      startingRef.current = false;
      sessionGenerationRef.current += 1;
      summaryGenerationRef.current += 1;
      processingRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      unmountAudioCleanupRef.current();
    };
  }, []);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(null);
  const playbackStatus = useAudioPlayerStatus(player);
  recorderRef.current = recorder;
  playerRef.current = player;

  useEffect(() => {
    try {
      player.volume = volume;
    } catch {
      if (mountedRef.current) setNotice('Reply playback is unavailable. Text chat remains usable.');
    }
  }, [player, volume]);

  const clearReplyAudio = useCallback(async () => {
    const currentPlayer = playerRef.current;
    if (currentPlayer && playerPlayingRef.current && mountedRef.current) {
      try {
        currentPlayer.pause();
      } catch {
        // The hook releases the player after this component's teardown.
      }
    }
    playerPlayingRef.current = false;
    const oldUri = audioUriRef.current;
    audioUriRef.current = null;
    if (mountedRef.current) setAudioUri(null);
    if (oldUri) await deleteTemporaryAudio(oldUri);
  }, []);

  const playReply = useCallback(async (base64: string, generation: number) => {
    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) throw new Error('Temporary audio storage is unavailable.');
    await clearReplyAudio();
    if (!mountedRef.current || generation !== sessionGenerationRef.current || !sessionRef.current) return;
    const uri = `${cacheDirectory}sos-reply-${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
    if (!mountedRef.current || generation !== sessionGenerationRef.current || !sessionRef.current) {
      await deleteTemporaryAudio(uri);
      return;
    }
    audioUriRef.current = uri;
    setAudioUri(uri);
    const currentPlayer = playerRef.current;
    if (!currentPlayer) {
      audioUriRef.current = null;
      setAudioUri(null);
      await deleteTemporaryAudio(uri);
      throw new Error('Reply playback is unavailable.');
    }
    try {
      currentPlayer.replace({ uri });
      currentPlayer.volume = volume;
      currentPlayer.play();
      playerPlayingRef.current = true;
    } catch (error) {
      audioUriRef.current = null;
      setAudioUri(null);
      playerPlayingRef.current = false;
      await deleteTemporaryAudio(uri);
      throw error;
    }
  }, [clearReplyAudio, volume]);

  const stopRecorderOnce = useCallback((target: AudioRecorder): Promise<void> => {
    if (recorderStopPromiseRef.current) return recorderStopPromiseRef.current;
    const wasPrepared = recorderPreparedRef.current;
    const wasRecording = recordingRef.current;
    recorderPreparedRef.current = false;
    recordingRef.current = false;
    if (mountedRef.current) setRecording(false);

    let nativeStop: Promise<void>;
    try {
      // Invoke synchronously so teardown queues stop before the hook releases the shared object.
      // A prepared but not yet active web MediaRecorder cannot be stopped; briefly start it so
      // stop() emits its cleanup event and closes the getUserMedia tracks.
      if (Platform.OS === 'web' && wasPrepared && !wasRecording) target.record();
      nativeStop = target.stop();
    } catch (error) {
      nativeStop = Promise.reject(error);
    }
    let trackedStop: Promise<void>;
    trackedStop = Promise.resolve(nativeStop).finally(() => {
      if (recorderStopPromiseRef.current === trackedStop) {
        recorderStopPromiseRef.current = null;
      }
    });
    recorderStopPromiseRef.current = trackedStop;
    return trackedStop;
  }, []);

  const removeRecordedClip = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pendingPrepare = preparePromiseRef.current;
    if (pendingPrepare) {
      await pendingPrepare.catch(() => undefined);
    }
    if (!mountedRef.current) return;

    const currentRecorder = recorderRef.current;
    let uri = recorderClipUriRef.current;
    if (currentRecorder && (recorderPreparedRef.current || recordingRef.current)) {
      // Mobile recorders expose their destination after preparation. Read it before stop or
      // release, never from an unmount continuation.
      if (!uri) {
        try {
          uri = currentRecorder.uri;
        } catch {
          uri = null;
        }
      }
      try {
        await stopRecorderOnce(currentRecorder);
      } catch {
        if (mountedRef.current) {
          setNotice('The microphone did not stop cleanly. Text chat remains available.');
        }
      }
      if (!uri && Platform.OS === 'web' && mountedRef.current) {
        try {
          uri = currentRecorder.uri;
        } catch {
          uri = null;
        }
      }
    }
    const pendingStop = recorderStopPromiseRef.current;
    if (pendingStop) await pendingStop.catch(() => undefined);
    recorderClipUriRef.current = null;
    if (uri) await deleteTemporaryAudio(uri);

    const processingUri = processingClipUriRef.current;
    processingClipUriRef.current = null;
    if (processingUri && processingUri !== uri) await deleteTemporaryAudio(processingUri);
  }, [stopRecorderOnce]);

  const stopVoiceSession = useCallback(async (message?: string) => {
    sessionRef.current = false;
    sessionGenerationRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (mountedRef.current) {
      setSessionActive(false);
      if (message) setNotice(message);
    }
    if (sessionStopPromiseRef.current) return sessionStopPromiseRef.current;
    if (
      !recordingRef.current &&
      !recorderPreparedRef.current &&
      !processingRef.current &&
      !audioUriRef.current &&
      !playerPlayingRef.current &&
      !audioRecordingModeRef.current
    ) {
      return;
    }

    let shutdown: Promise<void>;
    shutdown = (async () => {
      try {
        await removeRecordedClip();
      } catch {
        if (mountedRef.current) setNotice('Voice cleanup was incomplete. Text chat remains available.');
      }
      try {
        await clearReplyAudio();
      } catch {
        if (mountedRef.current) setNotice('Reply audio cleanup was incomplete. Text chat remains available.');
      }
      if (audioRecordingModeRef.current) {
        audioRecordingModeRef.current = false;
        await setAudioModeAsync({
          allowsRecording: false,
          shouldPlayInBackground: false,
        }).catch(() => {
          if (mountedRef.current) setNotice('The microphone mode could not be reset. Text chat remains available.');
        });
      }
    })().finally(() => {
      if (sessionStopPromiseRef.current === shutdown) {
        sessionStopPromiseRef.current = null;
      }
    });
    sessionStopPromiseRef.current = shutdown;
    return shutdown;
  }, [clearReplyAudio, removeRecordedClip]);

  const isCurrentSession = useCallback((generation: number) =>
    mountedRef.current &&
    sessionRef.current &&
    generation === sessionGenerationRef.current, []);

  const recordNextChunk = useCallback(async (generation: number) => {
    if (
      !isCurrentSession(generation) ||
      !state.sosActive ||
      recordingRef.current ||
      recordingStartRef.current ||
      processingRef.current
    ) return;
    recordingStartRef.current = true;
    let prepare: Promise<void> | null = null;
    try {
      prepare = recorder.prepareToRecordAsync();
      preparePromiseRef.current = prepare;
      await prepare;
      if (!mountedRef.current) return;
      recorderPreparedRef.current = true;
      try {
        recorderClipUriRef.current = recorder.uri;
      } catch {
        recorderClipUriRef.current = null;
      }
      if (!isCurrentSession(generation) || !state.sosActive) return;
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
      setNotice('Listening for up to 4 seconds. The microphone indicator is on.');
      timerRef.current = setTimeout(() => {
        if (isCurrentSession(generation)) {
          void processChunkRef.current(generation).catch(() => undefined);
        }
      }, VOICE_CHUNK_MS);
    } catch {
      if (isCurrentSession(generation)) {
        void stopVoiceSession('Microphone could not start. Check permission or continue with text chat.');
      }
    } finally {
      if (preparePromiseRef.current === prepare) preparePromiseRef.current = null;
      recordingStartRef.current = false;
    }
  }, [isCurrentSession, recorder, state.sosActive, stopVoiceSession]);

  const processChunk = useCallback(async (generation: number) => {
    if (!isCurrentSession(generation) || !recordingRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    let uri: string | null = null;
    try {
      uri = recorderClipUriRef.current;
      if (!uri && Platform.OS === 'web') {
        try {
          uri = recorder.uri;
        } catch {
          uri = null;
        }
      }
      processingClipUriRef.current = uri;
      recorderClipUriRef.current = null;
      await stopRecorderOnce(recorder);
      if (!uri && Platform.OS === 'web' && mountedRef.current) {
        try {
          uri = recorder.uri;
          processingClipUriRef.current = uri;
        } catch {
          uri = null;
        }
      }
      if (!uri) throw new Error('The recording was empty.');
      if (!isCurrentSession(generation) || !state.sosActive) return;
      processingRef.current = true;
      setProcessing(true);
      setNotice('Processing this short clip. Its transcript is not final until the reply arrives.');
      const encoded = await readAudioAsBase64(uri);
      if (!isCurrentSession(generation)) return;
      const response = await sendSOSVoiceChunk(
        encoded,
        audioFormat(uri),
        spokenRepliesRef.current,
      );
      if (!isCurrentSession(generation) || !state.sosActive) return;
      setNotice(response.available
        ? 'Transcript ready. Review and correct it before creating or sharing a summary.'
        : 'AI voice guidance is unavailable. The prepared safety response is shown in the chat.');
      if (spokenRepliesRef.current && response.audioBase64) {
        await playReply(response.audioBase64, generation);
      }
    } catch {
      if (isCurrentSession(generation)) {
        setNotice('Voice processing failed. The temporary clip was deleted; use text chat or try another short clip.');
      }
    } finally {
      if (uri) {
        if (processingClipUriRef.current === uri) processingClipUriRef.current = null;
        await deleteTemporaryAudio(uri);
      }
      processingRef.current = false;
      if (mountedRef.current) setProcessing(false);
      if (isCurrentSession(generation) && state.sosActive) {
        timerRef.current = setTimeout(() => {
          if (isCurrentSession(generation)) {
            void recordNextRef.current(generation).catch(() => undefined);
          }
        }, 350);
      }
    }
  }, [isCurrentSession, playReply, recorder, sendSOSVoiceChunk, state.sosActive, stopRecorderOnce]);

  recordNextRef.current = recordNextChunk;
  processChunkRef.current = processChunk;

  const startVoiceSession = useCallback(async () => {
    if (state.account?.role !== 'child') {
      setNotice('Voice chat is available only to an approved child account.');
      return;
    }
    if (!state.sosActive || sessionRef.current || startingRef.current) return;
    const generation = ++sessionGenerationRef.current;
    startingRef.current = true;
    setStarting(true);
    setNotice('Requesting microphone permission…');
    try {
      const previousShutdown = sessionStopPromiseRef.current;
      if (previousShutdown) await previousShutdown;
      if (!mountedRef.current || generation !== sessionGenerationRef.current) return;
      const permission = await requestRecordingPermissionsAsync();
      if (!mountedRef.current || generation !== sessionGenerationRef.current) return;
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
      audioRecordingModeRef.current = true;
      if (!mountedRef.current || generation !== sessionGenerationRef.current) {
        audioRecordingModeRef.current = false;
        await setAudioModeAsync({
          allowsRecording: false,
          shouldPlayInBackground: false,
        }).catch(() => undefined);
        return;
      }
      sessionRef.current = true;
      setSessionActive(true);
      setStarting(false);
      setNotice('Voice chat is on. Clips are processed one at a time; replies may take a few seconds.');
      await recordNextRef.current(generation);
    } catch {
      if (mountedRef.current && generation === sessionGenerationRef.current) {
        audioRecordingModeRef.current = false;
        await setAudioModeAsync({
          allowsRecording: false,
          shouldPlayInBackground: false,
        }).catch(() => undefined);
        void stopVoiceSession('Voice chat could not start. Continue with text chat or try again.');
      }
    } finally {
      startingRef.current = false;
      if (mountedRef.current) setStarting(false);
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
      summaryGenerationRef.current += 1;
      void stopVoiceSession();
      setSummary(null);
      setSummarizing(false);
      setEditingId(null);
    }
  }, [state.sosActive, stopVoiceSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && (sessionRef.current || startingRef.current)) {
        void stopVoiceSession('Voice chat stopped because the app moved to the background.');
      }
    });
    return () => subscription.remove();
  }, [stopVoiceSession]);

  unmountAudioCleanupRef.current = () => {
    const currentRecorder = recorderRef.current;
    const currentPlayer = playerRef.current;
    const uri = recorderClipUriRef.current ?? processingClipUriRef.current;
    const hasRecorderWork = recorderPreparedRef.current || recordingRef.current;
    if (currentRecorder && hasRecorderWork) {
      recorderPreparedRef.current = false;
      const stop = stopRecorderOnce(currentRecorder);
      const cleanupClip = async () => {
        if (uri) await deleteTemporaryAudio(uri);
        if (!uri && Platform.OS === 'web') {
          try {
            const webUri = currentRecorder.uri;
            if (webUri) await deleteTemporaryAudio(webUri);
          } catch {
            // The web recorder can already have been released by the hook.
          }
        }
      };
      void stop.then(
        cleanupClip,
        (error) => {
          console.warn('Failed to stop the SOS recorder during teardown.', error);
          return cleanupClip();
        },
      ).catch(() => undefined);
    } else if (uri) {
      const pendingStop = recorderStopPromiseRef.current;
      if (pendingStop) {
        const cleanupClip = () => deleteTemporaryAudio(uri);
        void pendingStop.then(cleanupClip, cleanupClip).catch(() => undefined);
      } else {
        void deleteTemporaryAudio(uri);
      }
    }
    recorderClipUriRef.current = null;
    processingClipUriRef.current = null;
    if (currentPlayer && playerPlayingRef.current) {
      try {
        currentPlayer.pause();
      } catch {
        // The hook owns player release; teardown remains best effort.
      }
    }
    playerPlayingRef.current = false;
    const replyUri = audioUriRef.current;
    audioUriRef.current = null;
    if (replyUri) void deleteTemporaryAudio(replyUri);
    if (audioRecordingModeRef.current) {
      audioRecordingModeRef.current = false;
      void setAudioModeAsync({
        allowsRecording: false,
        shouldPlayInBackground: false,
      }).catch((error) => {
        console.warn('Failed to reset SOS audio mode during teardown.', error);
      });
    }
  };

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
    if (voiceMessages.length === 0 || !mountedRef.current) return;
    const generation = ++summaryGenerationRef.current;
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
      if (mountedRef.current && generation === summaryGenerationRef.current) setSummary(result);
    } catch {
      if (mountedRef.current && generation === summaryGenerationRef.current) {
        setSummaryError('The summary is unavailable. Your reviewed transcripts are still private in this active demo session.');
      }
    } finally {
      if (mountedRef.current && generation === summaryGenerationRef.current) setSummarizing(false);
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
                  label={starting ? 'Cancel voice start' : 'Start voice chat'}
                  icon="mic"
                  color={colors.destructive}
                  textColor={colors.destructiveForeground}
                  onPress={() => starting ? pauseVoiceSession() : void startVoiceSession()}
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
                    onPress={() => {
                      try {
                        if (playbackStatus.playing) {
                          player.pause();
                          playerPlayingRef.current = false;
                        } else {
                          player.play();
                          playerPlayingRef.current = true;
                        }
                      } catch {
                        playerPlayingRef.current = false;
                        setNotice('Reply playback is unavailable. Text chat remains usable.');
                      }
                    }}
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