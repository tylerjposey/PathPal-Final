import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

type ColorScheme = 'light' | 'dark';

interface ThemePreferenceContextValue {
  colorScheme: ColorScheme;
  isDarkMode: boolean;
  setDarkModeEnabled: (enabled: boolean) => Promise<void>;
}

const STORAGE_KEY = 'pathpal-mobile-theme-preference-v1';
const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [override, setOverride] = useState<ColorScheme | null>(null);
  const preferenceChanged = useRef(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((savedScheme) => {
        if (!mounted || preferenceChanged.current) return;
        if (savedScheme === 'light' || savedScheme === 'dark') {
          setOverride(savedScheme);
        }
      })
      .catch((error) => {
        console.warn('Could not restore the saved appearance preference.', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const colorScheme: ColorScheme =
    override ?? (systemColorScheme === 'dark' ? 'dark' : 'light');

  const setDarkModeEnabled = useCallback(async (enabled: boolean) => {
    const nextScheme: ColorScheme = enabled ? 'dark' : 'light';
    preferenceChanged.current = true;
    setOverride(nextScheme);
    await AsyncStorage.setItem(STORAGE_KEY, nextScheme);
  }, []);

  const value = useMemo(
    () => ({
      colorScheme,
      isDarkMode: colorScheme === 'dark',
      setDarkModeEnabled,
    }),
    [colorScheme, setDarkModeEnabled],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error('useThemePreference must be used within ThemeProvider.');
  }
  return context;
}