import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contractorsTable, insertContractorSchema } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/contractors", async (req: Request, res: Response) => {
  try {
    const { trade } = req.query;
    const contractors = await db.select().from(contractorsTable).orderBy(contractorsTable.createdAt);
    const filtered = trade ? contractors.filter(c => c.trade === trade) : contractors;
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch contractors" });
  }
});

router.get("/contractors/:id", async (req: Request, res: Response) => {
  try {
    const contractor = await db.select().from(contractorsTable).where(eq(contractorsTable.id, Number(req.params.id)));
    if (!contractor.length) return res.status(404).json({ error: "Contractor not found" });
    res.json(contractor[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch contractor" });
  }
});

router.post("/contractors", async (req: Request, res: Response) => {
  try {
    const parsed = insertContractorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
    const [created] = await db.insert(contractorsTable).values(parsed.data).returning();
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: "Failed to create contractor" });
  }
});

const ALLOWED_PATCH_FIELDS = ["name", "trade", "city", "province", "country", "verified", "whatsappOptIn"] as const;

router.patch("/contractors/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    for (const field of ALLOWED_PATCH_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });

    const [updated] = await db.update(contractorsTable).set(updates).where(eq(contractorsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Contractor not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update contractor" });
  }
});

router.delete("/contractors/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [deleted] = await db.delete(contractorsTable).where(eq(contractorsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Contractor not found" });
    res.json(deleted);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete contractor" });
  }
});

export default router;
