import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, framingProjectsTable } from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
  AddEyespyrScanParams,
  AddEyespyrScanBody,
  RecordPaymentParams,
  RecordPaymentBody,
  GenerateTruthVaultParams,
  AddNanoRenderParams,
  AddNanoRenderBody,
  ListProjectsResponse,
  GetProjectResponse,
  UpdateProjectResponse,
  RecordPaymentResponse,
  GenerateTruthVaultResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function cleanProject(p: Record<string, unknown>) {
  return {
    ...p,
    estimateData: p.estimateData ?? {},
    eyespyrScans: p.eyespyrScans ?? [],
    nanoBananaRenders: p.nanoBananaRenders ?? [],
    paymentMilestones: p.paymentMilestones ?? [],
  };
}

const defaultMilestones = (total: number) => [
  { milestone: 1, label: "Deposit", percentage: 20, amount: total * 0.2, status: "pending", date: null },
  { milestone: 2, label: "On Frame-Up", percentage: 30, amount: total * 0.3, status: "pending", date: null },
  { milestone: 3, label: "On Roof", percentage: 30, amount: total * 0.3, status: "pending", date: null },
  { milestone: 4, label: "Final", percentage: 20, amount: total * 0.2, status: "pending", date: null },
];

router.get("/projects", async (_req, res): Promise<void> => {
  const projects = await db.select().from(framingProjectsTable);
  projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(ListProjectsResponse.parse(projects.map((p) => cleanProject(p as unknown as Record<string, unknown>))));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .insert(framingProjectsTable)
    .values({
      name: parsed.data.name,
      clientName: parsed.data.clientName ?? "",
      clientPhone: parsed.data.clientPhone ?? "",
      clientEmail: parsed.data.clientEmail ?? "",
      address: parsed.data.address ?? "",
      status: parsed.data.status ?? "draft",
      notes: parsed.data.notes ?? "",
      estimateData: {},
      paymentMilestones: defaultMilestones(0),
    })
    .returning();

  res.status(201).json(GetProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [project] = await db.select().from(framingProjectsTable).where(eq(framingProjectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(GetProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof framingProjectsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.clientName !== undefined) updateData.clientName = parsed.data.clientName;
  if (parsed.data.clientPhone !== undefined) updateData.clientPhone = parsed.data.clientPhone;
  if (parsed.data.clientEmail !== undefined) updateData.clientEmail = parsed.data.clientEmail;
  if (parsed.data.address !== undefined) updateData.address = parsed.data.address;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.totalValue !== undefined) {
    updateData.totalValue = parsed.data.totalValue;
    updateData.paymentMilestones = defaultMilestones(parsed.data.totalValue);
  }
  if (parsed.data.estimateData !== undefined) updateData.estimateData = parsed.data.estimateData as Record<string, unknown>;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [project] = await db
    .update(framingProjectsTable)
    .set(updateData)
    .where(eq(framingProjectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(UpdateProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [project] = await db.delete(framingProjectsTable).where(eq(framingProjectsTable.id, params.data.id)).returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/projects/:id/eyespyr", async (req, res): Promise<void> => {
  const params = AddEyespyrScanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = AddEyespyrScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(framingProjectsTable).where(eq(framingProjectsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const scan = {
    id: `SCAN-${Date.now()}`,
    type: parsed.data.type,
    notes: parsed.data.notes ?? "",
    verdict: parsed.data.verdict,
    confidence: parsed.data.confidence,
    timestamp: new Date().toISOString(),
  };

  const scans = [...(existing.eyespyrScans || []), scan];
  const hasPass = parsed.data.verdict === "PASS" || existing.eyespyrPass;

  const [project] = await db
    .update(framingProjectsTable)
    .set({ eyespyrScans: scans, eyespyrPass: hasPass })
    .where(eq(framingProjectsTable.id, params.data.id))
    .returning();

  res.status(201).json(GetProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.post("/projects/:id/payment", async (req, res): Promise<void> => {
  const params = RecordPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = RecordPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(framingProjectsTable).where(eq(framingProjectsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const milestones = [...(existing.paymentMilestones || [])];
  const idx = milestones.findIndex((m) => m.milestone === parsed.data.milestone);
  if (idx === -1) {
    res.status(400).json({ error: "Invalid milestone" });
    return;
  }

  if (parsed.data.milestone === 4 && !existing.eyespyrPass) {
    res.status(400).json({ error: "Final payment requires EyeSpyR PASS" });
    return;
  }

  milestones[idx] = { ...milestones[idx], status: "paid", amount: parsed.data.amount, date: new Date().toISOString() };

  const [project] = await db
    .update(framingProjectsTable)
    .set({ paymentMilestones: milestones })
    .where(eq(framingProjectsTable.id, params.data.id))
    .returning();

  res.json(RecordPaymentResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.post("/projects/:id/truthvault", async (req, res): Promise<void> => {
  const params = GenerateTruthVaultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [existing] = await db.select().from(framingProjectsTable).where(eq(framingProjectsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!existing.eyespyrPass) {
    res.status(400).json({ error: "EyeSpyR inspection must PASS before generating Truth-Vault" });
    return;
  }

  const allPaid = (existing.paymentMilestones || []).every((m) => m.status === "paid");
  if (!allPaid) {
    res.status(400).json({ error: "All payment milestones must be paid" });
    return;
  }

  if (existing.status !== "complete") {
    res.status(400).json({ error: "Project must be marked complete" });
    return;
  }

  const vault = {
    wowId: `WOW-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
    vaultId: `TV-${Date.now()}`,
    projectId: `FP-${existing.id}`,
    generatedAt: new Date().toISOString(),
  };

  const [project] = await db
    .update(framingProjectsTable)
    .set({ truthVault: vault })
    .where(eq(framingProjectsTable.id, params.data.id))
    .returning();

  res.json(GenerateTruthVaultResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.post("/projects/:id/render", async (req, res): Promise<void> => {
  const params = AddNanoRenderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = AddNanoRenderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(framingProjectsTable).where(eq(framingProjectsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const render = {
    id: `NB-${Date.now()}`,
    category: parsed.data.category,
    material: parsed.data.material,
    cost: parsed.data.cost ?? 2,
    timestamp: new Date().toISOString(),
  };

  const renders = [...(existing.nanoBananaRenders || []), render];

  const [project] = await db
    .update(framingProjectsTable)
    .set({ nanoBananaRenders: renders })
    .where(eq(framingProjectsTable.id, params.data.id))
    .returning();

  res.status(201).json(GetProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

export default router;
