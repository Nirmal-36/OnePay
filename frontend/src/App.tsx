import { BrowserRouter } from 'react-router-dom';
import { DemoProvider } from './context/DemoProvider';
import { ToastProvider } from './context/ToastProvider';
import AppRoutes from './AppRoutes';

export default function App() {
  return (
    <DemoProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </DemoProvider>
  );
}
