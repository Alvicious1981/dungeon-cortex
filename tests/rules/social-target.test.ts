/**
 * tests/rules/social-target.test.ts
 *
 * Unit tests for pure candidate matching in lib/rules/social-target.ts.
 */

import { describe, it, expect } from "vitest";
import {
  resolveSocialTargetCandidate,
  normalizeTargetName,
  type SocialTargetCandidate,
} from "@/lib/rules/social-target";

describe("resolveSocialTargetCandidate", () => {
  const barnaby: SocialTargetCandidate = {
    id: "npc_1",
    campaignId: "camp_1",
    name: "Barnaby the Innkeeper",
    seed: "innkeeper_1",
  };

  const guardBob: SocialTargetCandidate = {
    id: "npc_2",
    campaignId: "camp_1",
    name: "Guard Bob",
    seed: "guard_bob",
  };

  const guardAlice: SocialTargetCandidate = {
    id: "npc_3",
    campaignId: "camp_1",
    name: "Guard Alice",
    seed: "guard_alice",
  };

  describe("Omitted target and pronouns/collectives", () => {
    it("returns NO_TARGET_AVAILABLE when scene has no candidates and no target is named", () => {
      const result = resolveSocialTargetCandidate([]);
      expect(result).toEqual({
        ok: false,
        error: "No target available in the current scene.",
        code: "NO_TARGET_AVAILABLE",
        status: 400,
      });
    });

    it("resolves unique candidate when target is omitted and exactly 1 candidate is present", () => {
      const result = resolveSocialTargetCandidate([barnaby]);
      expect(result).toEqual({
        ok: true,
        target: barnaby,
      });
    });

    it("refuses with MECHANICAL_CLARIFICATION_REQUIRED when target is omitted and 2+ candidates are present", () => {
      const result = resolveSocialTargetCandidate([guardBob, guardAlice]);
      expect(result).toEqual({
        ok: false,
        error: "Multiple characters are present. State who you are talking to.",
        code: "MECHANICAL_CLARIFICATION_REQUIRED",
        status: 400,
      });
    });

    it("resolves unique candidate for pronouns ('him', 'her', 'él', 'ella') when 1 candidate is present", () => {
      for (const pronoun of ["him", "her", "them", "él", "ella", "alguien"]) {
        const result = resolveSocialTargetCandidate([barnaby], pronoun);
        expect(result).toEqual({
          ok: true,
          target: barnaby,
        });
      }
    });

    it("refuses with MECHANICAL_CLARIFICATION_REQUIRED for pronouns/collectives when 2+ candidates are present", () => {
      for (const pronoun of ["them", "they", "everyone", "todos", "alguien"]) {
        const result = resolveSocialTargetCandidate([guardBob, guardAlice], pronoun);
        expect(result).toEqual({
          ok: false,
          error: "Multiple characters are present. State who you are talking to.",
          code: "MECHANICAL_CLARIFICATION_REQUIRED",
          status: 400,
        });
      }
    });
  });

  describe("Explicit target matching", () => {
    it("returns NPC_NOT_PRESENT when explicit target does not match any candidate", () => {
      const result = resolveSocialTargetCandidate([barnaby], "wizard");
      expect(result).toEqual({
        ok: false,
        error: "NPC is not present in the current scene.",
        code: "NPC_NOT_PRESENT",
        status: 400,
      });
    });

    it("resolves exact match on name", () => {
      const result = resolveSocialTargetCandidate([barnaby], "Barnaby the Innkeeper");
      expect(result).toEqual({
        ok: true,
        target: barnaby,
      });
    });

    it("resolves exact match on seed", () => {
      const result = resolveSocialTargetCandidate([barnaby], "innkeeper_1");
      expect(result).toEqual({
        ok: true,
        target: barnaby,
      });
    });

    it("resolves unique unambiguous partial match", () => {
      const result = resolveSocialTargetCandidate([barnaby], "innkeeper");
      expect(result).toEqual({
        ok: true,
        target: barnaby,
      });
    });

    it("fails with MECHANICAL_CLARIFICATION_REQUIRED when partial match matches multiple candidates", () => {
      const result = resolveSocialTargetCandidate([guardBob, guardAlice], "guard");
      expect(result).toEqual({
        ok: false,
        error: "Multiple matching targets found. Specify which one.",
        code: "MECHANICAL_CLARIFICATION_REQUIRED",
        status: 400,
      });
    });

    it("normalizes terminal punctuation (. ! ?) without altering matching", () => {
      expect(resolveSocialTargetCandidate([barnaby], "innkeeper.")).toEqual({
        ok: true,
        target: barnaby,
      });
      expect(resolveSocialTargetCandidate([barnaby], "Barnaby!")).toEqual({
        ok: true,
        target: barnaby,
      });
      expect(resolveSocialTargetCandidate([barnaby], "innkeeper?")).toEqual({
        ok: true,
        target: barnaby,
      });
    });
  });

  describe("normalizeTargetName", () => {
    it("strips terminal punctuation (. ! ?) and leading Spanish punctuation (¿ ¡)", () => {
      expect(normalizeTargetName("innkeeper.")).toBe("innkeeper");
      expect(normalizeTargetName("guard!")).toBe("guard");
      expect(normalizeTargetName("merchant?")).toBe("merchant");
      expect(normalizeTargetName("¿posadero?")).toBe("posadero");
      expect(normalizeTargetName("¡guardia!")).toBe("guardia");
    });

    it("preserves internal hyphens and apostrophes", () => {
      expect(normalizeTargetName("half-orc")).toBe("half-orc");
      expect(normalizeTargetName("O'Brien")).toBe("o'brien");
    });
  });
});
