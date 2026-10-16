import type { DemoNotification } from '../types';

export const demoProfile = {
  name: 'Ananya Sharma',
  email: 'ananya.demo@example.com',
  upiId: 'ananya@onepay',
};

const demoDate = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();

export const initialNotifications: DemoNotification[] = [
  {
    id: 'note-1', title: 'Your demo payment is ready',
    body: 'Explore a safe, simulated payment flow. No real money moves in OnePay.',
    createdAt: demoDate(1), read: false, kind: 'payment', href: '/send',
  },
  {
    id: 'note-2', title: 'A little tip for you',
    body: 'You can review every simulated payment from Transaction history.',
    createdAt: demoDate(16), read: false, kind: 'tip', href: '/transactions',
  },
  {
    id: 'note-3', title: 'Keep your account details private',
    body: 'OnePay never asks for a banking PIN, password, OTP, or card security code.',
    createdAt: demoDate(30), read: true, kind: 'security', href: '/profile',
  },
];

export const billServices = [
  { id: 'mobile', label: 'Mobile', shortLabel: 'Mobile recharge', icon: 'mobile', detail: 'Prepaid & postpaid' },
  { id: 'dth', label: 'DTH', shortLabel: 'DTH recharge', icon: 'tv', detail: 'Television plans' },
  { id: 'electricity', label: 'Electricity', shortLabel: 'Electricity bill', icon: 'bolt', detail: 'Monthly utility bill' },
  { id: 'water', label: 'Water', shortLabel: 'Water bill', icon: 'water', detail: 'Water utility' },
  { id: 'gas', label: 'Gas', shortLabel: 'Gas bill', icon: 'flame', detail: 'Piped gas & LPG' },
  { id: 'broadband', label: 'Broadband', shortLabel: 'Broadband bill', icon: 'wifi', detail: 'Internet plans' },
] as const;

export type BillServiceId = (typeof billServices)[number]['id'];

export const billerOptions: Record<BillServiceId, string[]> = {
  mobile: ['Demo Mobile · Prepaid', 'Demo Mobile · Postpaid'],
  dth: ['Demo DTH provider'],
  electricity: ['Demo Grid Power'],
  water: ['Demo City Water'],
  gas: ['Demo Piped Gas'],
  broadband: ['Demo Broadband'],
};

export const savedBillers = [
  { label: 'Home electricity', service: 'electricity' as const, identifier: 'EB-483920', biller: 'Demo Grid Power' },
  { label: 'Family mobile', service: 'mobile' as const, identifier: '9876543210', biller: 'Demo Mobile · Prepaid' },
];
