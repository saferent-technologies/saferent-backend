import { useNavigate } from "react-router";
import { Button } from "@/components/ui/Button";
import { AuthCard, AuthLayout } from "@/layouts/AuthLayout";
import { PATHS } from "@/utils/constants";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <AuthCard title="Page not found" subtitle="The page you're looking for doesn't exist or has moved.">
        <Button fullWidth size="lg" onClick={() => navigate(PATHS.dashboard)}>
          Go to dashboard
        </Button>
      </AuthCard>
    </AuthLayout>
  );
}
