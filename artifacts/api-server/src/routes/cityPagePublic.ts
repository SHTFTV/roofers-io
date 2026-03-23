import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { cityPagesTable, snapPostsTable, contractorsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

router.get("/city/:trade/:slug", async (req: Request, res: Response) => {
  try {
    const { trade, slug } = req.params;

    const [cityPage] = await db
      .select()
      .from(cityPagesTable)
      .where(and(eq(cityPagesTable.trade, trade), eq(cityPagesTable.citySlug, slug)))
      .limit(1);

    if (!cityPage) {
      res.status(404).json({ error: "City page not found" });
      return;
    }

    const posts = await db
      .select()
      .from(snapPostsTable)
      .where(
        and(
          eq(snapPostsTable.trade, trade),
          eq(snapPostsTable.citySlug, slug),
          eq(snapPostsTable.status, "published")
        )
      )
      .orderBy(desc(snapPostsTable.createdAt))
      .limit(20);

    const contractors = await db
      .select({
        id: contractorsTable.id,
        name: contractorsTable.name,
        trade: contractorsTable.trade,
        city: contractorsTable.city,
        province: contractorsTable.province,
        verified: contractorsTable.verified,
        totalPosts: contractorsTable.totalPosts,
      })
      .from(contractorsTable)
      .where(
        and(
          eq(contractorsTable.trade, trade),
          eq(contractorsTable.city, cityPage.cityName)
        )
      )
      .orderBy(desc(contractorsTable.totalPosts));

    res.json({
      city: {
        name: cityPage.cityName,
        slug: cityPage.citySlug,
        province: cityPage.province,
        country: cityPage.country,
        trade: cityPage.trade,
        postCount: cityPage.postCount,
        isIndexed: cityPage.isIndexed,
        totalImpressions: cityPage.totalImpressions,
        totalClicks: cityPage.totalClicks,
      },
      posts: posts.map(p => ({
        id: p.id,
        title: p.aiTitle,
        content: p.aiContent,
        metaDescription: p.aiMetaDescription,
        caption: p.caption,
        photoUrl: p.photoUrl,
        keywords: p.seoKeywords,
        publishedAt: p.publishedAt,
        createdAt: p.createdAt,
      })),
      contractors: contractors.map(c => ({
        name: c.name,
        trade: c.trade,
        city: c.city,
        province: c.province,
        verified: c.verified,
        totalPosts: c.totalPosts,
      })),
    });
  } catch (err) {
    console.error("City page error:", err);
    res.status(500).json({ error: "Failed to load city page" });
  }
});

router.get("/cities", async (req: Request, res: Response) => {
  try {
    const trade = req.query.trade as string | undefined;

    let query = db.select().from(cityPagesTable).orderBy(desc(cityPagesTable.postCount));
    const allPages = await query;
    const filtered = trade ? allPages.filter(p => p.trade === trade) : allPages;

    res.json(
      filtered.map(p => ({
        trade: p.trade,
        slug: p.citySlug,
        name: p.cityName,
        province: p.province,
        country: p.country,
        postCount: p.postCount,
        isIndexed: p.isIndexed,
      }))
    );
  } catch (err) {
    console.error("Cities list error:", err);
    res.status(500).json({ error: "Failed to load cities" });
  }
});

export default router;
