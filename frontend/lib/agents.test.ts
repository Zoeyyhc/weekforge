import { describe, it, expect } from "vitest";
import { agentMeta } from "@/lib/agents";

describe("agentMeta", () => {
  it("returns distinct metadata for each debater", () => {
    const hawk = agentMeta("DeadlineHawk");
    const guardian = agentMeta("EnergyGuardian");
    expect(hawk.label).toBe("Deadline Hawk");
    expect(guardian.label).toBe("Energy Guardian");
    expect(hawk.color).not.toBe(guardian.color);
    expect(hawk.emoji).toBeTruthy();
  });

  it("has metadata for Arbiter, Human and System speakers", () => {
    expect(agentMeta("Arbiter").label).toBe("Arbiter");
    expect(agentMeta("Human").label).toBe("You");
    expect(agentMeta("System").label).toBe("System");
  });

  it("falls back to System metadata for an unknown speaker", () => {
    // @ts-expect-error deliberately passing an unknown speaker
    expect(agentMeta("Mystery").label).toBe("System");
  });
});
