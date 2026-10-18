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
  { id: 'mobile', label: 'Mobile', shortLabel: 'Mobile recharge', icon: 'mobile', detail: 'Mock mobile operators' },
  { id: 'dth', label: 'DTH', shortLabel: 'DTH recharge', icon: 'tv', detail: 'Mock DTH provider' },
  { id: 'electricity', label: 'Electricity', shortLabel: 'Electricity bill', icon: 'bolt', detail: 'Mock utility bill' },
  { id: 'water', label: 'Water', shortLabel: 'Water bill', icon: 'water', detail: 'Mock utility bill' },
  { id: 'gas', label: 'Gas', shortLabel: 'Gas bill', icon: 'flame', detail: 'Mock utility bill' },
  { id: 'broadband', label: 'Broadband', shortLabel: 'Broadband bill', icon: 'wifi', detail: 'Mock internet bill' },
  { id: 'other', label: 'Other', shortLabel: 'Other bill', icon: 'other', detail: 'Other mock bill type' },
] as const;

export type BillServiceId = (typeof billServices)[number]['id'];

export const billerOptions: Record<BillServiceId, string[]> = {
  mobile: ['OnePay Mock Mobile Alpha', 'OnePay Mock Mobile Beta'],
  dth: ['OnePay Mock DTH'],
  electricity: ['OnePay Mock Electricity'],
  water: ['OnePay Mock Water'],
  gas: ['OnePay Mock Gas'],
  broadband: ['OnePay Mock Broadband'],
  other: ['OnePay Mock Utility'],
};

export interface DemoRechargePlan {
  code: string;
  service: 'mobile' | 'dth';
  provider: string;
  label: string;
  amountPaise: number;
  description: string;
}

// Illustration-only entries. They do not represent a carrier's current plans or benefits.
export const demoRechargePlans: DemoRechargePlan[] = [
  { code: 'mobile-alpha-example-a', service: 'mobile', provider: 'OnePay Mock Mobile Alpha', label: 'Mock plan A', amountPaise: 19_900, description: 'Fictional amount · no service benefit' },
  { code: 'mobile-alpha-example-b', service: 'mobile', provider: 'OnePay Mock Mobile Alpha', label: 'Mock plan B', amountPaise: 29_900, description: 'Fictional amount · no service benefit' },
  { code: 'mobile-beta-example-a', service: 'mobile', provider: 'OnePay Mock Mobile Beta', label: 'Mock plan A', amountPaise: 19_900, description: 'Fictional amount · no service benefit' },
  { code: 'mobile-beta-example-b', service: 'mobile', provider: 'OnePay Mock Mobile Beta', label: 'Mock plan B', amountPaise: 49_900, description: 'Fictional amount · no service benefit' },
  { code: 'dth-example-a', service: 'dth', provider: 'OnePay Mock DTH', label: 'Mock plan A', amountPaise: 19_900, description: 'Fictional amount · no service benefit' },
  { code: 'dth-example-b', service: 'dth', provider: 'OnePay Mock DTH', label: 'Mock plan B', amountPaise: 29_900, description: 'Fictional amount · no service benefit' },
  { code: 'dth-example-c', service: 'dth', provider: 'OnePay Mock DTH', label: 'Mock plan C', amountPaise: 49_900, description: 'Fictional amount · no service benefit' },
];

export const savedBillers = [
  { label: 'Home electricity', service: 'electricity' as const, identifier: 'EB-483920', biller: 'OnePay Mock Electricity' },
  { label: 'Family mobile', service: 'mobile' as const, identifier: '9876543210', biller: 'OnePay Mock Mobile Alpha' },
];
