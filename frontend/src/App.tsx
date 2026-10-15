import { BrowserRouter } from 'react-router-dom';
import { DemoProvider } from './context/DemoProvider';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastProvider';
import AppRoutes from './AppRoutes';

export default function App() {
  return (
    <AuthProvider>
      <DemoProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </DemoProvider>
    </AuthProvider>
  );
}
