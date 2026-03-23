import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, hvacProjectsTable } from "@workspace/db";

const router: IRouter = Router();

function cleanProject(p: Record<string, unknown>) {
  return {
    ...p,
    estimateData: p.estimateData ?? {},
    eyespyrScans: p.eyespyrScans ?? [],
    paymentMilestones: p.paymentMilestones ?? [],
  };
}

const defaultMilestones = (total: number) => [
  { milestone: 1, label: "Deposit", percentage: 20, amount: total * 0.20, status: "pending", date: null },
  { milestone: 2, label: "Equipment", percentage: 35, amount: total * 0.35, status: "pending", date: null },
  { milestone: 3, label: "Commissioning", percentage: 25, amount: total * 0.25, status: "pending", date: null },
  { milestone: 4, label: "Final", percentage: 20, amount: total * 0.20, status: "pending", date: null },
];

router.get("/hvac-projects", async (_req, res): Promise<void> => {
  const projects = await db.select().from(hvacProjectsTable);
  projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(projects.map((p) => cleanProject(p as unknown as Record<string, unknown>)));
});

router.post("/hvac-projects", async (req, res): Promise<void> => {
  const body = req.body;
  const [project] = await db
    .insert(hvacProjectsTable)
    .values({
      name: body.name,
      clientName: body.clientName ?? "",
      clientPhone: body.clientPhone ?? "",
      clientEmail: body.clientEmail ?? "",
      address: body.address ?? "",
      status: body.status ?? "lead",
      serviceType: body.serviceType ?? "AC Installation",
      notes: body.notes ?? "",
      estimateData: {},
      paymentMilestones: defaultMilestones(0),
    })
    .returning();
  res.status(201).json(cleanProject(project as unknown as Record<string, unknown>));
});

router.get("/hvac-projects/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [project] = await db.select().from(hvacProjectsTable).where(eq(hvacProjectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(cleanProject(project as unknown as Record<string, unknown>));
});

router.patch("/hvac-projects/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = req.body;
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.clientName !== undefined) updateData.clientName = body.clientName;
  if (body.clientPhone !== undefined) updateData.clientPhone = body.clientPhone;
  if (body.clientEmail !== undefined) updateData.clientEmail = body.clientEmail;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.serviceType !== undefined) updateData.serviceType = body.serviceType;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.totalValue !== undefined) {
    updateData.totalValue = body.totalValue;
    updateData.paymentMilestones = defaultMilestones(body.totalValue);
  }
  if (body.estimateData !== undefined) updateData.estimateData = body.estimateData;

  const [project] = await db
    .update(hvacProjectsTable)
    .set(updateData)
    .where(eq(hvacProjectsTable.id, id))
    .returning();
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(cleanProject(project as unknown as Record<string, unknown>));
});

router.delete("/hvac-projects/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [project] = await db.delete(hvacProjectsTable).where(eq(hvacProjectsTable.id, id)).returning();
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.sendStatus(204);
});

router.post("/hvac-projects/:id/eyespyr", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select().from(hvacProjectsTable).where(eq(hvacProjectsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Project not found" }); return; }
  const scan = {
    id: `HSCAN-${Date.now()}`,
    type: req.body.type,
    notes: req.body.notes ?? "",
    verdict: req.body.verdict,
    confidence: req.body.confidence,
    timestamp: new Date().toISOString(),
  };
  const scans = [...(existing.eyespyrScans || []), scan];
  const hasPass = req.body.verdict === "PASS" || existing.eyespyrPass;
  const [project] = await db
    .update(hvacProjectsTable)
    .set({ eyespyrScans: scans, eyespyrPass: hasPass })
    .where(eq(hvacProjectsTable.id, id))
    .returning();
  res.status(201).json(cleanProject(project as unknown as Record<string, unknown>));
});

router.post("/hvac-projects/:id/payment", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select().from(hvacProjectsTable).where(eq(hvacProjectsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Project not found" }); return; }
  const milestones = [...(existing.paymentMilestones || [])];
  const idx = milestones.findIndex((m) => m.milestone === req.body.milestone);
  if (idx === -1) { res.status(400).json({ error: "Invalid milestone" }); return; }
  if (req.body.milestone === 4 && !existing.eyespyrPass) {
    res.status(400).json({ error: "Final payment requires EyeSpyR PASS" }); return;
  }
  milestones[idx] = { ...milestones[idx], status: "paid", amount: req.body.amount, date: new Date().toISOString() };
  const [project] = await db
    .update(hvacProjectsTable)
    .set({ paymentMilestones: milestones })
    .where(eq(hvacProjectsTable.id, id))
    .returning();
  res.json(cleanProject(project as unknown as Record<string, unknown>));
});

router.post("/hvac-projects/:id/truthvault", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select().from(hvacProjectsTable).where(eq(hvacProjectsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Project not found" }); return; }
  if (!existing.eyespyrPass) { res.status(400).json({ error: "EyeSpyR inspection must PASS before generating Truth-Vault" }); return; }
  const allPaid = (existing.paymentMilestones || []).every((m) => m.status === "paid");
  if (!allPaid) { res.status(400).json({ error: "All payment milestones must be paid" }); return; }
  if (existing.status !== "complete") { res.status(400).json({ error: "Project must be marked complete" }); return; }
  const vault = {
    wowId: `WOW-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
    vaultId: `TV-${Date.now()}`,
    projectId: `HV-${existing.id}`,
    generatedAt: new Date().toISOString(),
  };
  const [project] = await db
    .update(hvacProjectsTable)
    .set({ truthVault: vault })
    .where(eq(hvacProjectsTable.id, id))
    .returning();
  res.json(cleanProject(project as unknown as Record<string, unknown>));
});

export default router;
