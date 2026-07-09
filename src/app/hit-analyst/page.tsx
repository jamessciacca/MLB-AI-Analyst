import { MlbHitAnalystDashboard } from "@/components/mlb-hit-analyst-dashboard";
import { todayIsoDate } from "@/lib/utils";

export default function HitAnalystPage() {
  return <MlbHitAnalystDashboard defaultDate={todayIsoDate()} />;
}
