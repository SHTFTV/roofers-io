import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or } from "drizzle-orm";
import { db, jobsTable } from "@workspace/db";
import {
  CreateJobBody,
  UpdateJobBody,
  GetJobParams,
  UpdateJobParams,
  DeleteJobParams,
  AddJobTimelineParams,
  AddJobTimelineBody,
  ListJobsQueryParams,
  ListJobsResponse,
  GetJobResponse,
  UpdateJobResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/jobs", async (req, res): Promise<void> => {
  const query = ListJobsQueryParams.safeParse(req.query);
  const search = query.success && query.data.search ? query.data.search.toLowerCase() : "";
  const sort = query.success && query.data.sort ? query.data.sort : "newest";

  let jobs = await db.select().from(jobsTable);

  if (search) {
    jobs = jobs.filter((j) =>
      (j.client + j.addr + j.type + j.notes).toLowerCase().includes(search)
    );
  }

  if (sort === "value") {
    jobs.sort((a, b) => b.value - a.value);
  } else if (sort === "alpha") {
    jobs.sort((a, b) => a.client.localeCompare(b.client));
  } else {
    jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  res.json(ListJobsResponse.parse(jobs));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [job] = await db
    .insert(jobsTable)
    .values({
      client: parsed.data.client,
      phone: parsed.data.phone ?? "",
      email: parsed.data.email ?? "",
      addr: parsed.data.addr ?? "",
      type: parsed.data.type ?? "Full Re-Roof — Architectural Shingles",
      value: parsed.data.value ?? 0,
      status: parsed.data.status ?? "lead",
      date: parsed.data.date ?? "",
      notes: parsed.data.notes ?? "",
      timeline: [],
    })
    .returning();

  res.status(201).json(GetJobResponse.parse(job));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, params.data.id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(GetJobResponse.parse(job));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const params = UpdateJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = UpdateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof jobsTable.$inferInsert> = {};
  if (parsed.data.client !== undefined) updateData.client = parsed.data.client;
  if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
  if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
  if (parsed.data.addr !== undefined) updateData.addr = parsed.data.addr;
  if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
  if (parsed.data.value !== undefined) updateData.value = parsed.data.value;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.date !== undefined) updateData.date = parsed.data.date;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [job] = await db
    .update(jobsTable)
    .set(updateData)
    .where(eq(jobsTable.id, params.data.id))
    .returning();

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(UpdateJobResponse.parse(job));
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const params = DeleteJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [job] = await db
    .delete(jobsTable)
    .where(eq(jobsTable.id, params.data.id))
    .returning();

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/jobs/:id/timeline", async (req, res): Promise<void> => {
  const params = AddJobTimelineParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = AddJobTimelineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const entry = {
    text: parsed.data.text,
    ts: Date.now(),
    oldStatus: parsed.data.oldStatus ?? null,
    newStatus: parsed.data.newStatus ?? null,
  };

  const updatedTimeline = [...(existing.timeline as typeof entry[]), entry];

  const [job] = await db
    .update(jobsTable)
    .set({ timeline: updatedTimeline })
    .where(eq(jobsTable.id, params.data.id))
    .returning();

  res.status(201).json(GetJobResponse.parse(job));
});

export default router;
