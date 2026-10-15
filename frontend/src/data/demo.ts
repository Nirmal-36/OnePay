import type { DemoNotification, DemoRecipient, DemoTransaction } from '../types';

export const initialBalancePaise = 2_458_000;

export const demoProfile = {
  name: 'Ananya Sharma',
  email: 'ananya.demo@example.com',
  upiId: 'ananya@onepay',
};

export const demoRecipients: DemoRecipient[] = [
  { id: 'rec-1', name: 'Rohan Mehta', upiId: 'rohan@okaxis', initials: 'RM', color: 'lavender' },
  { id: 'rec-2', name: 'Kavya Iyer', upiId: 'kavya@okhdfcbank', initials: 'KI', color: 'peach' },
  { id: 'rec-3', name: 'Arjun Rao', upiId: 'arjun@okicici', initials: 'AR', color: 'mint' },
  { id: 'rec-4', name: 'Meera Nair', upiId: 'meera@oksbi', initials: 'MN', color: 'blue' },
  { id: 'rec-5', name: 'Dev Patel', upiId: 'dev@okaxis', initials: 'DP', color: 'rose' },
];

const demoDate = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();

export const initialTransactions: DemoTransaction[] = [
  {
    id: 'demo-tx-01', reference: 'ONEPAY-DEMO-10482', title: 'Rohan Mehta', subtitle: 'Lunch · rohan@okaxis',
    amountPaise: 1_240_00, direction: 'debit', category: 'transfer', status: 'complete', createdAt: demoDate(1),
  },
  {
    id: 'demo-tx-02', reference: 'ONEPAY-DEMO-10479', title: 'Demo Mobile', subtitle: 'Mobile recharge · ending 4821',
    amountPaise: 2_990_0, direction: 'debit', category: 'recharge', status: 'complete', createdAt: demoDate(5),
  },
  {
    id: 'demo-tx-03', reference: 'ONEPAY-DEMO-10463', title: 'Kavya Iyer', subtitle: 'Received · kavya@okhdfcbank',
    amountPaise: 5_000_00, direction: 'credit', category: 'transfer', status: 'complete', createdAt: demoDate(28),
  },
  {
    id: 'demo-tx-04', reference: 'ONEPAY-DEMO-10451', title: 'Demo Electricity', subtitle: 'Home electricity bill · Oct',
    amountPaise: 1_875_00, direction: 'debit', category: 'bill', status: 'pending', createdAt: demoDate(46),
  },
  {
    id: 'demo-tx-05', reference: 'ONEPAY-DEMO-10432', title: 'Demo Wallet', subtitle: 'Demo funds added',
    amountPaise: 10_000_00, direction: 'credit', category: 'topup', status: 'complete', createdAt: demoDate(72),
  },
];

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
