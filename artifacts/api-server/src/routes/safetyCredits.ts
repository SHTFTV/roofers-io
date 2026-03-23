import { Router, type IRouter } from "express";
import { db, safetyProfilesTable, safetyCreditLedgerTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

const CREDIT_ACTIONS: Record<string, { credits: number; description: string }> = {
  "clean_pretip_scan": { credits: 10, description: "Clean Pre-Trip Scan" },
  "eyespyr_load_verified": { credits: 25, description: "EyeSpyR Load Verified" },
  "permit_upload": { credits: 50, description: "Permit/License Upload" },
  "on_time_delivery": { credits: 15, description: "On-Time Delivery" },
  "no_harsh_braking": { credits: 5, description: "No Harsh Braking" },
  "security_audit_pass": { credits: 10, description: "Security Audit Pass" },
  "eyespyr_scan_pass": { credits: 25, description: "EyeSpyR Scan Pass" },
};

const RANK_THRESHOLDS = [
  { min: 0, rank: "bronze", label: "Bronze" },
  { min: 250, rank: "silver", label: "Silver" },
  { min: 500, rank: "gold", label: "Gold" },
  { min: 1000, rank: "platinum", label: "Platinum" },
  { min: 2500, rank: "diamond", label: "Diamond" },
  { min: 5000, rank: "master_hauler", label: "Master Hauler" },
];

function calculateRank(credits: number): string {
  let rank = "bronze";
  for (const t of RANK_THRESHOLDS) {
    if (credits >= t.min) rank = t.rank;
  }
  return rank;
}

router.get("/profiles", async (_req, res) => {
  try {
    const profiles = await db
      .select()
      .from(safetyProfilesTable)
      .orderBy(desc(safetyProfilesTable.totalCredits))
      .limit(100);
    res.json(profiles);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/profiles/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid profile ID" });
    const [profile] = await db
      .select()
      .from(safetyProfilesTable)
      .where(eq(safetyProfilesTable.id, id));
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/profiles", async (req, res) => {
  try {
    const { entityType, entityId, displayName } = req.body;
    if (!entityType || !entityId || !displayName) {
      return res.status(400).json({ error: "entityType, entityId, displayName required" });
    }
    const [profile] = await db
      .insert(safetyProfilesTable)
      .values({ entityType, entityId, displayName })
      .returning();
    res.status(201).json(profile);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/profiles/:id/award", async (req, res) => {
  try {
    const profileId = Number(req.params.id);
    if (isNaN(profileId)) {
      return res.status(400).json({ error: "Invalid profile ID" });
    }

    const { action, source, sourceId, metadata } = req.body;

    const actionDef = CREDIT_ACTIONS[action];
    if (!actionDef) {
      return res.status(400).json({ error: `Unknown action: ${action}. Valid: ${Object.keys(CREDIT_ACTIONS).join(", ")}` });
    }

    const [existingProfile] = await db
      .select()
      .from(safetyProfilesTable)
      .where(eq(safetyProfilesTable.id, profileId));

    if (!existingProfile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const [ledgerEntry] = await db
      .insert(safetyCreditLedgerTable)
      .values({
        profileId,
        action,
        credits: actionDef.credits,
        source: source || "system",
        sourceId: sourceId || null,
        description: actionDef.description,
        metadata: metadata || null,
      })
      .returning();

    const newTotal = existingProfile.totalCredits + actionDef.credits;
    const newRank = calculateRank(newTotal);

    await db
      .update(safetyProfilesTable)
      .set({
        totalCredits: newTotal,
        rank: newRank,
        isTopTier: newTotal >= 1000,
        lastActivityDate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(safetyProfilesTable.id, profileId));

    res.json({
      success: true,
      credited: actionDef.credits,
      action: actionDef.description,
      newTotal,
      rank: newRank,
      ledgerEntry,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/profiles/:id/ledger", async (req, res) => {
  try {
    const profileId = Number(req.params.id);
    if (isNaN(profileId)) return res.status(400).json({ error: "Invalid profile ID" });
    const entries = await db
      .select()
      .from(safetyCreditLedgerTable)
      .where(eq(safetyCreditLedgerTable.profileId, profileId))
      .orderBy(desc(safetyCreditLedgerTable.createdAt))
      .limit(50);
    res.json(entries);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/leaderboard", async (_req, res) => {
  try {
    const profiles = await db
      .select()
      .from(safetyProfilesTable)
      .orderBy(desc(safetyProfilesTable.totalCredits))
      .limit(25);
    res.json({
      leaderboard: profiles.map((p, i) => ({
        position: i + 1,
        id: p.id,
        displayName: p.displayName,
        totalCredits: p.totalCredits,
        rank: p.rank,
        isTopTier: p.isTopTier,
        badges: p.badges,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/actions", async (_req, res) => {
  res.json({
    actions: Object.entries(CREDIT_ACTIONS).map(([key, val]) => ({
      action: key,
      credits: val.credits,
      description: val.description,
    })),
    ranks: RANK_THRESHOLDS,
  });
});

export default router;
