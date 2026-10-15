# OnePay

OnePay is an original, responsive fintech interface built as a **front-end-only demo**. It uses simulated balances and transactions; it does not connect to a bank, UPI network, or payment provider, and it does not move real money. Never enter a real banking PIN, password, OTP, or card security code.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite development server listens on `0.0.0.0:5173`. The interface is built with React, TypeScript, React Router, Tailwind CSS, and Lucide icons.

## Checks

```bash
cd frontend
npm run typecheck
npm test
npm run build
```

All demo data lives in in-memory React state and resets when the page is reloaded. There is no backend or browser-storage persistence in Phase 1.
