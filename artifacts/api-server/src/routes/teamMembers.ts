import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, teamMembersTable } from "@workspace/db";
import {
  CreateTeamMemberBody,
  DeleteTeamMemberParams,
  ListTeamMembersResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/team-members", async (_req, res): Promise<void> => {
  const members = await db.select().from(teamMembersTable);
  members.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(ListTeamMembersResponse.parse(members));
});

router.post("/team-members", async (req, res): Promise<void> => {
  const parsed = CreateTeamMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [member] = await db
    .insert(teamMembersTable)
    .values({
      name: parsed.data.name,
      role: parsed.data.role,
      email: parsed.data.email,
    })
    .returning();

  res.status(201).json(member);
});

router.delete("/team-members/:id", async (req, res): Promise<void> => {
  const params = DeleteTeamMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [member] = await db.delete(teamMembersTable).where(eq(teamMembersTable.id, params.data.id)).returning();
  if (!member) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
