import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import ResetPassword from "./pages/ResetPassword";
import AdminDashboard from "./pages/AdminDashboard";
import ChatLayout from "./components/chat/ChatLayout";
import { setPasswordRecoveryFlag } from "@/lib/passwordRecoveryFlag";

const queryClient = new QueryClient();

const isPasswordRecoveryUrl = () => {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);
  if (hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery") return true;
  // PKCE recovery links arrive as ?code=...
  if (searchParams.get("code") && window.location.pathname === "/reset-password") return true;
  return false;
};

function PasswordRecoveryRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const routeToResetPassword = () => {
      setPasswordRecoveryFlag();

      if (location.pathname !== "/reset-password") {
        navigate(`/reset-password${window.location.search}${window.location.hash}`, { replace: true });
      }
    };

    if (isPasswordRecoveryUrl()) {
      routeToResetPassword();
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        routeToResetPassword();
      }
    });

    return () => subscription.unsubscribe();
  }, [location.pathname, navigate]);

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="dark">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <PasswordRecoveryRedirect />
        <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/chat" element={<ChatLayout />} />
            <Route path="/global-chat" element={<ChatLayout />} />
            <Route path="/announcements" element={<ChatLayout />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
