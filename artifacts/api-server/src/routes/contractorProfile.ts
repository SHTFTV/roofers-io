import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contractorsTable, snapPostsTable, cityPagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/contractor/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid contractor ID" });
      return;
    }

    const [contractor] = await db
      .select()
      .from(contractorsTable)
      .where(eq(contractorsTable.id, id))
      .limit(1);

    if (!contractor) {
      res.status(404).json({ error: "Contractor not found" });
      return;
    }

    const allPosts = await db
      .select()
      .from(snapPostsTable)
      .where(eq(snapPostsTable.contractorId, id))
      .orderBy(desc(snapPostsTable.createdAt));

    const citySet = new Set(allPosts.map(p => p.citySlug).filter(Boolean));

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentPosts = allPosts.filter(p => new Date(p.createdAt!) >= thirtyDaysAgo);
    const publishedPosts = allPosts.filter(p => p.status === "published");

    const dailyPosts: Record<string, number> = {};
    for (const p of allPosts) {
      const day = new Date(p.createdAt!).toISOString().split("T")[0];
      dailyPosts[day] = (dailyPosts[day] || 0) + 1;
    }
    const last30Days: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split("T")[0];
      last30Days.push({ date: key, count: dailyPosts[key] || 0 });
    }

    const cityBreakdown: Record<string, number> = {};
    for (const p of allPosts) {
      const city = p.city || "Unknown";
      cityBreakdown[city] = (cityBreakdown[city] || 0) + 1;
    }

    const posts = allPosts.slice(0, 20);

    res.json({
      contractor: {
        id: contractor.id,
        name: contractor.name,
        trade: contractor.trade,
        city: contractor.city,
        province: contractor.province,
        country: contractor.country,
        verified: contractor.verified,
        welcomeSent: contractor.welcomeSent,
        totalPosts: contractor.totalPosts,
        joinedAt: contractor.createdAt,
      },
      stats: {
        totalPosts: allPosts.length,
        publishedPosts: publishedPosts.length,
        recentPosts: recentPosts.length,
        citiesCovered: citySet.size,
        publishRate: allPosts.length > 0 ? Math.round((publishedPosts.length / allPosts.length) * 100) : 0,
      },
      activity: last30Days,
      cityBreakdown: Object.entries(cityBreakdown)
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count),
      posts: posts.slice(0, 20).map(p => ({
        id: p.id,
        title: p.aiTitle,
        content: p.aiContent,
        metaDescription: p.aiMetaDescription,
        caption: p.caption,
        photoUrl: p.photoUrl,
        city: p.city,
        province: p.province,
        status: p.status,
        createdAt: p.createdAt,
        publishedAt: p.publishedAt,
      })),
    });
  } catch (err) {
    console.error("Contractor profile error:", err);
    res.status(500).json({ error: "Failed to load contractor profile" });
  }
});

export default router;
