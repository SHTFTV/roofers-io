import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { snapPostsTable, insertSnapPostSchema, cityPagesTable, contractorsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

const router = Router();

router.get("/snap-posts/stats/summary", async (_req: Request, res: Response) => {
  try {
    const allPosts = await db.select().from(snapPostsTable);
    const published = allPosts.filter(p => p.status === "published");
    const pending = allPosts.filter(p => p.status === "pending");
    const trades = [...new Set(allPosts.map(p => p.trade))];
    const cities = [...new Set(allPosts.map(p => p.city))];

    res.json({
      totalPosts: allPosts.length,
      publishedPosts: published.length,
      pendingPosts: pending.length,
      totalTrades: trades.length,
      totalCities: cities.length,
      trades,
      cities,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/snap-posts", async (req: Request, res: Response) => {
  try {
    const { trade, city, status } = req.query;
    const posts = await db.select().from(snapPostsTable).orderBy(desc(snapPostsTable.createdAt));
    let filtered = posts;
    if (trade) filtered = filtered.filter(p => p.trade === trade);
    if (city) filtered = filtered.filter(p => p.city === city);
    if (status) filtered = filtered.filter(p => p.status === status);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

router.get("/snap-posts/:id", async (req: Request, res: Response) => {
  try {
    const post = await db.select().from(snapPostsTable).where(eq(snapPostsTable.id, Number(req.params.id)));
    if (!post.length) return res.status(404).json({ error: "Post not found" });
    res.json(post[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

router.post("/snap-posts", async (req: Request, res: Response) => {
  try {
    const parsed = insertSnapPostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });

    const result = await db.transaction(async (tx) => {
      const [created] = await tx.insert(snapPostsTable).values(parsed.data).returning();

      if (created.citySlug && created.trade) {
        const existing = await tx.select().from(cityPagesTable)
          .where(and(eq(cityPagesTable.citySlug, created.citySlug), eq(cityPagesTable.trade, created.trade)));

        if (existing.length) {
          await tx.update(cityPagesTable)
            .set({ postCount: existing[0].postCount + 1, lastPostAt: new Date() })
            .where(eq(cityPagesTable.id, existing[0].id));
        } else {
          await tx.insert(cityPagesTable).values({
            trade: created.trade,
            citySlug: created.citySlug,
            cityName: created.city,
            province: created.province,
            country: created.country,
            postCount: 1,
            lastPostAt: new Date(),
          });
        }
      }

      if (created.contractorId) {
        await tx.update(contractorsTable)
          .set({ totalPosts: sql`${contractorsTable.totalPosts} + 1` })
          .where(eq(contractorsTable.id, created.contractorId));
      }

      return created;
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to create post" });
  }
});

const ALLOWED_PATCH_FIELDS = ["status", "aiContent", "aiTitle", "aiMetaDescription", "seoKeywords"] as const;

router.patch("/snap-posts/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    for (const field of ALLOWED_PATCH_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });

    const [updated] = await db.update(snapPostsTable).set(updates).where(eq(snapPostsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Post not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update post" });
  }
});

router.delete("/snap-posts/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [deleted] = await db.delete(snapPostsTable).where(eq(snapPostsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Post not found" });
    res.json(deleted);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete post" });
  }
});

export default router;
