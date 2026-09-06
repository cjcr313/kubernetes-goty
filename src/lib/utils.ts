import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function fmtMs(ms: number): string {
  return `${ms.toFixed(2)}ms`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

export const POD_STATUS_COLORS: Record<string, string> = {
  Pending: '#eab308',
  ContainerCreating: '#38bdf8',
  Running: '#22c55e',
  CrashLoopBackOff: '#ef4444',
  Terminating: '#a78bfa',
};

export const OUTCOME_COLORS: Record<string, string> = {
  DELIVERED: '#22d3ee',
  'POLICY-DENIED': '#ef4444',
  'FAULT-500': '#f59e0b',
  'DNS-Failure': '#f472b6',
  'NO-ENDPOINTS': '#fb923c',
  'NO-ROUTE': '#94a3b8',
};
