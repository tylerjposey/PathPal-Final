import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, Card, ScreenHeader } from '@/components/OrivisUI';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

type AuthMode = 'sign-in' | 'sign-up' | 'sign-in-code' | 'sign-up-code';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'That request could not be completed. Check your details and try again.';
}

export function TrackingAuthPanel() {
  const colors = useColors();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const finishSignIn = async () => {
    await signIn.finalize({ navigate: async () => undefined });
  };

  const finishSignUp = async () => {
    await signUp.finalize({ navigate: async () => undefined });
  };

  const submitEmailPassword = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'sign-up') {
        const { error } = await signUp.password({
          emailAddress: email.trim(),
          password,
        });
        if (error) {
          setMessage(errorMessage(error));
          return;
        }
        const { error: codeError } = await signUp.verifications.sendEmailCode();
        if (codeError) {
          setMessage(errorMessage(codeError));
          return;
        }
        setMode('sign-up-code');
        return;
      }

      const { error } = await signIn.password({
        emailAddress: email.trim(),
        password,
      });
      if (error) {
        setMessage(errorMessage(error));
        return;
      }
      if (signIn.status === 'complete') {
        await finishSignIn();
      } else if (
        signIn.status === 'needs_client_trust' ||
        signIn.status === 'needs_second_factor'
      ) {
        const emailFactor = signIn.supportedSecondFactors.find(
          (factor) => factor.strategy === 'email_code',
        );
        if (!emailFactor) {
          setMessage('This account needs another verification method. Try Google sign-in or contact your family administrator.');
          return;
        }
        const { error: codeError } = await signIn.mfa.sendEmailCode();
        if (codeError) {
          setMessage(errorMessage(codeError));
          return;
        }
        setMode('sign-in-code');
      } else {
        setMessage('More account details are needed to finish sign-in.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'sign-up-code') {
        const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (error) {
          setMessage(errorMessage(error));
          return;
        }
        if (signUp.status === 'complete') await finishSignUp();
        else setMessage('Email verified, but the account still needs additional details.');
      } else {
        const { error } = await signIn.mfa.verifyEmailCode({ code: code.trim() });
        if (error) {
          setMessage(errorMessage(error));
          return;
        }
        if (signIn.status === 'complete') await finishSignIn();
        else setMessage('The verification code was accepted, but sign-in needs another step.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'orivis' }),
      });
      if (result.createdSessionId) {
        await result.setActive?.({
          session: result.createdSessionId,
          navigate: async () => undefined,
        });
      } else {
        setMessage('Google sign-in needs an additional verification step. Use email and password to continue.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const isVerification = mode === 'sign-in-code' || mode === 'sign-up-code';
  const label = mode.startsWith('sign-up') ? 'Create a tracking account' : 'Sign in to tracking';

  return (
    <Card>
      <ScreenHeader
        eyebrow="Private journey sharing"
        title={label}
        subtitle="This is separate from the shared demo sign-in. Each parent and child needs their own account."
      />
      <View style={styles.content}>
        {isVerification ? (
          <>
            <Text style={[styles.label, { color: colors.foreground }]}>Email verification code</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder="Enter the code sent to your email"
              placeholderTextColor={colors.mutedForeground}
            />
            <Button label="Verify email" icon="check" onPress={() => { void verifyCode(); }} loading={busy} disabled={!code.trim()} />
            <Button
              label="Send a new code"
              variant="secondary"
              onPress={() => {
                void (mode === 'sign-up-code'
                  ? signUp.verifications.sendEmailCode()
                  : signIn.mfa.sendEmailCode()).then(({ error }) => {
                  setMessage(error ? errorMessage(error) : 'A new code was sent.');
                }).catch((error) => setMessage(errorMessage(error)));
              }}
              disabled={busy}
            />
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
            />
            <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              secureTextEntry
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder="Password"
              placeholderTextColor={colors.mutedForeground}
            />
            <Button
              label={mode === 'sign-up' ? 'Create account' : 'Sign in'}
              icon={mode === 'sign-up' ? 'user-plus' : 'log-in'}
              onPress={() => { void submitEmailPassword(); }}
              loading={busy}
              disabled={!email.trim() || !password}
            />
            <Button
              label="Continue with Google"
              icon="globe"
              variant="secondary"
              onPress={() => { void signInWithGoogle(); }}
              disabled={busy}
            />
            <Button
              label={mode === 'sign-up' ? 'I already have an account' : 'Create a new account'}
              variant="ghost"
              onPress={() => {
                setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
                setMessage('');
              }}
              disabled={busy}
            />
            <View nativeID="clerk-captcha" />
          </>
        )}
        {message ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.warning }]}>{message}</Text> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  message: { fontSize: 13, lineHeight: 18 },
});