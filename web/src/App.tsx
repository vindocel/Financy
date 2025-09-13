import React from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import Login from './routes/Login';
import Signup from './routes/Signup';
import Forgot from './routes/Forgot';
import Reset from './routes/Reset';
import FamilyChoose from './routes/FamilyChoose';
import Panel from './routes/Panel';
import { AuthProvider, useAuth } from './lib/auth';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/family/choose" element={<RequireAuth><FamilyChoose /></RequireAuth>} />
        <Route path="/app" element={<RequireAuth><Panel /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </AuthProvider>
  );
}

