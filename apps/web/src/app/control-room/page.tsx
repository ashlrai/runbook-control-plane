import type { Metadata } from "next";
import { ControlRoom } from "@/components/control-room";

export const metadata: Metadata = {
  title: "Control Room · Runbook",
  description:
    "Local advisory preflight workbench using @runbook/engine. Equity-only charter, synthetic proposal form, policy check tickets. Caller-supplied state. Not a hard gate. No credentials.",
};

export default function ControlRoomPage() {
  return <ControlRoom />;
}
