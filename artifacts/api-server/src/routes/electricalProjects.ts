import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, electricalProjectsTable } from "@workspace/db";
import {
  CreateElectricalProjectBody,
  UpdateElectricalProjectBody,
  GetElectricalProjectParams,
  UpdateElectricalProjectParams,
  DeleteElectricalProjectParams,
  AddElectricalEyespyrScanParams,
  AddElectricalEyespyrScanBody,
  RecordElectricalPaymentParams,
  RecordElectricalPaymentBody,
  GenerateElectricalTruthVaultParams,
  ListElectricalProjectsResponse,
  GetElectricalProjectResponse,
  UpdateElectricalProjectResponse,
  RecordElectricalPaymentResponse,
  GenerateElectricalTruthVaultResponse,
} from "@workspace/api-zod";

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
  { milestone: 1, label: "Deposit", percentage: 20, amount: total * 0.2, status: "pending", date: null },
  { milestone: 2, label: "Rough-In", percentage: 30, amount: total * 0.3, status: "pending", date: null },
  { milestone: 3, label: "Trim-Out", percentage: 30, amount: total * 0.3, status: "pending", date: null },
  { milestone: 4, label: "Final", percentage: 20, amount: total * 0.2, status: "pending", date: null },
];

router.get("/electrical-projects", async (_req, res): Promise<void> => {
  const projects = await db.select().from(electricalProjectsTable);
  projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(ListElectricalProjectsResponse.parse(projects.map((p) => cleanProject(p as unknown as Record<string, unknown>))));
});

router.post("/electrical-projects", async (req, res): Promise<void> => {
  const parsed = CreateElectricalProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .insert(electricalProjectsTable)
    .values({
      name: parsed.data.name,
      clientName: parsed.data.clientName ?? "",
      clientPhone: parsed.data.clientPhone ?? "",
      clientEmail: parsed.data.clientEmail ?? "",
      address: parsed.data.address ?? "",
      status: parsed.data.status ?? "lead",
      serviceType: parsed.data.serviceType ?? "Residential Panel Upgrade",
      notes: parsed.data.notes ?? "",
      estimateData: {},
      paymentMilestones: defaultMilestones(0),
    })
    .returning();

  res.status(201).json(GetElectricalProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.get("/electrical-projects/:id", async (req, res): Promise<void> => {
  const params = GetElectricalProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [project] = await db.select().from(electricalProjectsTable).where(eq(electricalProjectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(GetElectricalProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.patch("/electrical-projects/:id", async (req, res): Promise<void> => {
  const params = UpdateElectricalProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = UpdateElectricalProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof electricalProjectsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.clientName !== undefined) updateData.clientName = parsed.data.clientName;
  if (parsed.data.clientPhone !== undefined) updateData.clientPhone = parsed.data.clientPhone;
  if (parsed.data.clientEmail !== undefined) updateData.clientEmail = parsed.data.clientEmail;
  if (parsed.data.address !== undefined) updateData.address = parsed.data.address;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.serviceType !== undefined) updateData.serviceType = parsed.data.serviceType;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.totalValue !== undefined) {
    updateData.totalValue = parsed.data.totalValue;
    updateData.paymentMilestones = defaultMilestones(parsed.data.totalValue);
  }
  if (parsed.data.estimateData !== undefined) updateData.estimateData = parsed.data.estimateData as Record<string, unknown>;

  const [project] = await db
    .update(electricalProjectsTable)
    .set(updateData)
    .where(eq(electricalProjectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(UpdateElectricalProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.delete("/electrical-projects/:id", async (req, res): Promise<void> => {
  const params = DeleteElectricalProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [project] = await db.delete(electricalProjectsTable).where(eq(electricalProjectsTable.id, params.data.id)).returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/electrical-projects/:id/eyespyr", async (req, res): Promise<void> => {
  const params = AddElectricalEyespyrScanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = AddElectricalEyespyrScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(electricalProjectsTable).where(eq(electricalProjectsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const scan = {
    id: `ESCAN-${Date.now()}`,
    type: parsed.data.type,
    notes: parsed.data.notes ?? "",
    verdict: parsed.data.verdict,
    confidence: parsed.data.confidence,
    timestamp: new Date().toISOString(),
  };

  const scans = [...(existing.eyespyrScans || []), scan];
  const hasPass = parsed.data.verdict === "PASS" || existing.eyespyrPass;

  const [project] = await db
    .update(electricalProjectsTable)
    .set({ eyespyrScans: scans, eyespyrPass: hasPass })
    .where(eq(electricalProjectsTable.id, params.data.id))
    .returning();

  res.status(201).json(GetElectricalProjectResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.post("/electrical-projects/:id/payment", async (req, res): Promise<void> => {
  const params = RecordElectricalPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = RecordElectricalPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(electricalProjectsTable).where(eq(electricalProjectsTable.id, params.data.id));
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
    .update(electricalProjectsTable)
    .set({ paymentMilestones: milestones })
    .where(eq(electricalProjectsTable.id, params.data.id))
    .returning();

  res.json(RecordElectricalPaymentResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

router.post("/electrical-projects/:id/truthvault", async (req, res): Promise<void> => {
  const params = GenerateElectricalTruthVaultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [existing] = await db.select().from(electricalProjectsTable).where(eq(electricalProjectsTable.id, params.data.id));
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
    projectId: `EP-${existing.id}`,
    generatedAt: new Date().toISOString(),
  };

  const [project] = await db
    .update(electricalProjectsTable)
    .set({ truthVault: vault })
    .where(eq(electricalProjectsTable.id, params.data.id))
    .returning();

  res.json(GenerateElectricalTruthVaultResponse.parse(cleanProject(project as unknown as Record<string, unknown>)));
});

export default router;
