import { ManagementDashboard } from "@/components/ManagementDashboard";
import { SeoDataManagement } from "@/components/SeoDataManagement";

export default function Page() {
  return process.env.NODE_ENV === "development" && process.env.SEO_PREVIEW_UPSTREAM_TOKEN
    ? <SeoDataManagement />
    : <ManagementDashboard />;
}
