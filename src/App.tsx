import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Nav from './components/Nav';
import Landing from './routes/Landing';
import Workspace from './routes/Workspace';
import Method from './routes/Method';
import Auth from './routes/Auth';
import { AuthProvider } from './auth/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="page">
          <Nav />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<Workspace />} />
            <Route path="/method" element={<Method />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="*" element={<Landing />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
