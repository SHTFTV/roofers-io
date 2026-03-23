import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contractorsTable, snapPostsTable } from "@workspace/db";
import { eq, desc, sql, ilike, and } from "drizzle-orm";

const router = Router();

router.get("/network-directory", async (req: Request, res: Response) => {
  try {
    const trade = req.query.trade as string | undefined;
    const city = req.query.city as string | undefined;
    const search = req.query.search as string | undefined;

    const conditions = [];
    if (trade && trade !== "All") {
      conditions.push(eq(contractorsTable.trade, trade));
    }
    if (city) {
      conditions.push(ilike(contractorsTable.city, `%${city}%`));
    }
    if (search) {
      conditions.push(ilike(contractorsTable.name, `%${search}%`));
    }

    const contractors = await db
      .select()
      .from(contractorsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(contractorsTable.totalPosts), desc(contractorsTable.createdAt));

    const postCounts = await db
      .select({
        contractorId: snapPostsTable.contractorId,
        count: sql<number>`count(*)::int`,
        published: sql<number>`count(*) filter (where ${snapPostsTable.status} = 'published')::int`,
      })
      .from(snapPostsTable)
      .groupBy(snapPostsTable.contractorId);

    const postMap = new Map(postCounts.map(p => [p.contractorId, p]));

    const trades = [...new Set(contractors.map(c => c.trade))].sort();
    const cities = [...new Set(contractors.map(c => c.city).filter(Boolean))].sort();

    res.json({
      contractors: contractors.map(c => {
        const posts = postMap.get(c.id);
        return {
          id: c.id,
          name: c.name,
          trade: c.trade,
          city: c.city,
          province: c.province,
          country: c.country,
          verified: c.verified,
          welcomeSent: c.welcomeSent,
          totalPosts: posts?.count || 0,
          publishedPosts: posts?.published || 0,
          joinedAt: c.createdAt,
        };
      }),
      filters: {
        trades,
        cities,
      },
      total: contractors.length,
    });
  } catch (err) {
    console.error("Network directory error:", err);
    res.status(500).json({ error: "Failed to load network directory" });
  }
});

export default router;
