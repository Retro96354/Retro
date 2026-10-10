import { MD3LightTheme } from 'react-native-paper';

export const colors = {
  primary: '#1E293B',
  secondary: '#2563EB',
  accent: '#F59E0B',
  background: '#F1F5F9',
  surface: '#FFFFFF',
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  text: '#0F172A',
  textSecondary: '#64748B',
  textLight: '#94A3B8',
  textWhite: '#FFFFFF',
  border: '#E2E8F0',
  active: '#2563EB',
  delivered: '#10B981',
  pending: '#F59E0B',
  cancelled: '#EF4444',
  cod: '#1E293B',
  online: '#2563EB',
};

export const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    secondary: colors.secondary,
    surface: colors.surface,
    background: colors.background,
    error: colors.error,
    text: colors.text,
  },
  roundness: 8,
};

export const shadows = {
  small: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  medium: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  large: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 10,
  },
};
