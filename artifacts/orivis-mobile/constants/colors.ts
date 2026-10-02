/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#142C3B',
    tint: '#087F83',
    background: '#F5F8F7',
    foreground: '#142C3B',
    card: '#FFFFFF',
    cardForeground: '#142C3B',
    primary: '#087F83',
    primaryForeground: '#FFFFFF',
    brandSurface: '#EAF7FB',
    secondary: '#E8F2F1',
    secondaryForeground: '#14545A',
    muted: '#EEF3F2',
    mutedForeground: '#71838D',
    accent: '#D9F0ED',
    accentForeground: '#126B6F',
    destructive: '#D94F53',
    destructiveForeground: '#FFFFFF',
    border: '#E0E9E7',
    input: '#D8E3E1',
    success: '#30846B',
    warning: '#B86A20',
    navy: '#15374A',
  },
  dark: {
    text: '#E8F2F0',
    tint: '#60C7BF',
    background: '#0D1D26',
    foreground: '#E8F2F0',
    card: '#162D36',
    cardForeground: '#E8F2F0',
    primary: '#60C7BF',
    primaryForeground: '#0E2B34',
    brandSurface: '#EAF7FB',
    secondary: '#203F46',
    secondaryForeground: '#E8F2F0',
    muted: '#1D353E',
    mutedForeground: '#A1B4BA',
    accent: '#20474B',
    accentForeground: '#ACE2DD',
    destructive: '#EB6B6F',
    destructiveForeground: '#2D1015',
    border: '#2A434C',
    input: '#364F59',
    success: '#7BC5A6',
    warning: '#E9A45C',
    navy: '#D8EBEF',
  },
  radius: 20,
};

export default colors;
