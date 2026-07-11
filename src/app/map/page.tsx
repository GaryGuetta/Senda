"use client";
import dynamic from "next/dynamic";
import AuthGate from "@/components/AuthGate";

const TrailMap = dynamic(() => import("@/components/TrailMap"), { ssr: false });

export default function MapPage() {
  return (
    <AuthGate>
      <TrailMap />
    </AuthGate>
  );
}
