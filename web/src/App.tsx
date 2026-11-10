import { AuthProvider } from "@/contexts/AuthContext";
import { isFirebaseConfigured, missingFirebaseConfig } from "@/firebase/config";
import { ConfigMissingPage } from "@/pages/ConfigMissingPage";
import { AppRouter } from "@/routes/AppRouter";

export function App() {
  if (!isFirebaseConfigured) return <ConfigMissingPage missing={missingFirebaseConfig} />;
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
