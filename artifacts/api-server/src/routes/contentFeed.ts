import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { snapPostsTable, contractorsTable } from "@workspace/db";
import { eq, desc, sql, ilike, and, lt } from "drizzle-orm";

const router = Router();

router.get("/content-feed", async (req: Request, res: Response) => {
  try {
    const trade = req.query.trade as string | undefined;
    const city = req.query.city as string | undefined;
    const status = req.query.status as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const conditions = [];
    if (trade && trade !== "All") {
      conditions.push(eq(snapPostsTable.trade, trade));
    }
    if (city) {
      conditions.push(ilike(snapPostsTable.city, `%${city}%`));
    }
    if (status && status !== "All") {
      conditions.push(eq(snapPostsTable.status, status));
    }
    if (cursor) {
      conditions.push(lt(snapPostsTable.id, parseInt(cursor)));
    }

    const posts = await db
      .select({
        id: snapPostsTable.id,
        contractorId: snapPostsTable.contractorId,
        trade: snapPostsTable.trade,
        city: snapPostsTable.city,
        province: snapPostsTable.province,
        country: snapPostsTable.country,
        citySlug: snapPostsTable.citySlug,
        photoUrl: snapPostsTable.photoUrl,
        caption: snapPostsTable.caption,
        aiTitle: snapPostsTable.aiTitle,
        aiContent: snapPostsTable.aiContent,
        aiMetaDescription: snapPostsTable.aiMetaDescription,
        seoKeywords: snapPostsTable.seoKeywords,
        status: snapPostsTable.status,
        createdAt: snapPostsTable.createdAt,
        publishedAt: snapPostsTable.publishedAt,
        contractorName: contractorsTable.name,
        contractorVerified: contractorsTable.verified,
      })
      .from(snapPostsTable)
      .leftJoin(contractorsTable, eq(snapPostsTable.contractorId, contractorsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(snapPostsTable.id))
      .limit(limit + 1);

    const hasMore = posts.length > limit;
    const results = posts.slice(0, limit);
    const nextCursor = hasMore && results.length > 0 ? results[results.length - 1].id : null;

    const [statsResult] = await db
      .select({
        total: sql<number>`count(*)::int`,
        published: sql<number>`count(*) filter (where ${snapPostsTable.status} = 'published')::int`,
        draft: sql<number>`count(*) filter (where ${snapPostsTable.status} = 'draft')::int`,
        trades: sql<number>`count(distinct ${snapPostsTable.trade})::int`,
        cities: sql<number>`count(distinct ${snapPostsTable.city})::int`,
      })
      .from(snapPostsTable);

    const trades = await db
      .selectDistinct({ trade: snapPostsTable.trade })
      .from(snapPostsTable)
      .orderBy(snapPostsTable.trade);

    res.json({
      posts: results,
      nextCursor,
      hasMore,
      stats: statsResult,
      filters: {
        trades: trades.map(t => t.trade).filter(Boolean),
      },
    });
  } catch (err) {
    console.error("Content feed error:", err);
    res.status(500).json({ error: "Failed to load content feed" });
  }
});

export default router;
