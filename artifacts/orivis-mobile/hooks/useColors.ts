import colors from '@/constants/colors';
import { useThemePreference } from '@/context/ThemeContext';

/**
 * Returns the design tokens for the saved app appearance, falling back
 * to the device's appearance until the user chooses a theme.
 */
export function useColors() {
  const { colorScheme: scheme } = useThemePreference();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
