import type { Metadata } from "next";

import { WinningSlipsPage } from "@/components/winning-slips-page";

export const metadata: Metadata = {
  title: "Winning Slip Keepsakes | MLB Analyst AI",
  description: "Upload and privately store winning slip images on this local app instance.",
};

export default function KeepsakesPage() {
  return <WinningSlipsPage />;
}
