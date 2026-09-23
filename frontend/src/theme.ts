import { createTheme, type MantineColorsTuple } from '@mantine/core';

const petrol: MantineColorsTuple = [
  '#eef7f5',
  '#dceeea',
  '#bbdbd5',
  '#91c6bd',
  '#63aa9f',
  '#388d84',
  '#176a67',
  '#145b59',
  '#104b49',
  '#0c3837',
];

export const theme = createTheme({
  primaryColor: 'petrol',
  primaryShade: 6,
  colors: { petrol },
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: '650',
  },
  defaultRadius: 'sm',
  radius: {
    xs: '3px',
    sm: '6px',
    md: '8px',
    lg: '10px',
    xl: '12px',
  },
  cursorType: 'pointer',
  focusRing: 'auto',
  other: {
    canvas: '#F4F2ED',
    paper: '#FCFBF8',
    ink: '#1D292C',
    muted: '#596668',
    line: '#D8DCD7',
    clay: '#A85D43',
  },
});
