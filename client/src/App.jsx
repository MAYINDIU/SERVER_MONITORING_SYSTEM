import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { LiveProvider } from './context/LiveContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import Alerts from './pages/Alerts';
import Reports from './pages/Reports';
import Logins from './pages/Logins';
import Settings from './pages/Settings';
import Users from './pages/Users';

export default function App() {
  const { user, ready, can } = useAuth();

  if (!ready) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <LiveProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="servers" element={<Servers />} />
          <Route path="servers/:id" element={<ServerDetail />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="reports" element={<Reports />} />
          <Route path="logins" element={<Logins />} />
          {can('admin') && <Route path="settings" element={<Settings />} />}
          {can('admin') && <Route path="users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LiveProvider>
  );
}
