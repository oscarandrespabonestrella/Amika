"use client";

import { CoinFlip } from "../components/coin-flip";
import { CountdownTimer } from "../components/countdown-timer";
import { DiceRoller } from "../components/dice-roller";
import { FingerSelector } from "../components/finger-selector";
import { HiddenNumber } from "../components/hidden-number";
import { SpinWheel } from "../components/spin-wheel";
import { TeamGenerator } from "../components/team-generator";
import type { ToolId } from "../registry";
import type { ToolRoster } from "../types";

/** /tools/:tool: the screen of one tool (each one keeps its own settings on the device). */
export function ToolView({
  tool,
  roster,
}: {
  tool: ToolId;
  roster: ToolRoster;
}) {
  switch (tool) {
    case "dice":
      return <DiceRoller />;
    case "finger":
      return <FingerSelector />;
    case "wheel":
      return <SpinWheel roster={roster} />;
    case "countdown":
      return <CountdownTimer />;
    case "teams":
      return <TeamGenerator roster={roster} />;
    case "hidden":
      return <HiddenNumber roster={roster} />;
    case "coin":
      return <CoinFlip />;
  }
}
