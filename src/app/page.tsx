import { MlbAnalystApp } from "@/components/mlb-analyst-app";
import { todayIsoDate } from "@/lib/utils";

export default function Page() {
  return <MlbAnalystApp defaultDate={todayIsoDate()} />;
}
