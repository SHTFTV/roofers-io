import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { cityPagesTable, snapPostsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

function scoreMeta(title: string, description: string): number {
  let score = 0;
  if (title && title.length >= 20 && title.length <= 70) score += 25;
  else if (title && title.length > 0) score += 10;
  if (description && description.length >= 50 && description.length <= 160) score += 25;
  else if (description && description.length > 0) score += 10;
  return score;
}

function scoreKeywords(keywords: string[] | null): number {
  if (!keywords || !Array.isArray(keywords)) return 0;
  if (keywords.length >= 5) return 25;
  if (keywords.length >= 3) return 15;
  if (keywords.length >= 1) return 8;
  return 0;
}

function scoreContent(content: string): number {
  if (!content) return 0;
  const words = content.split(/\s+/).length;
  if (words >= 300) return 25;
  if (words >= 150) return 18;
  if (words >= 50) return 10;
  return 5;
}

router.get("/seo-scorecard", async (req: Request, res: Response) => {
  try {
    const trade = req.query.trade as string | undefined;

    const cityPages = await db.select().from(cityPagesTable).orderBy(desc(cityPagesTable.postCount));

    const posts = await db
      .select({
        citySlug: snapPostsTable.citySlug,
        trade: snapPostsTable.trade,
        aiTitle: snapPostsTable.aiTitle,
        aiContent: snapPostsTable.aiContent,
        aiMetaDescription: snapPostsTable.aiMetaDescription,
        seoKeywords: snapPostsTable.seoKeywords,
        status: snapPostsTable.status,
      })
      .from(snapPostsTable);

    const postsByCityTrade = new Map<string, typeof posts>();
    for (const p of posts) {
      const key = `${p.citySlug}:${p.trade}`;
      if (!postsByCityTrade.has(key)) postsByCityTrade.set(key, []);
      postsByCityTrade.get(key)!.push(p);
    }

    const scorecards = cityPages
      .filter(cp => !trade || trade === "All" || cp.trade === trade)
      .map(cp => {
        const cityPosts = postsByCityTrade.get(`${cp.citySlug}:${cp.trade}`) || [];
        const publishedPosts = cityPosts.filter(p => p.status === "published");

        let metaScore = 0;
        let keywordScore = 0;
        let contentScore = 0;

        if (publishedPosts.length > 0) {
          const metaScores = publishedPosts.map(p => scoreMeta(p.aiTitle || "", p.aiMetaDescription || ""));
          const kwScores = publishedPosts.map(p => scoreKeywords(p.seoKeywords as string[] | null));
          const contScores = publishedPosts.map(p => scoreContent(p.aiContent || ""));

          metaScore = Math.round(metaScores.reduce((a, b) => a + b, 0) / metaScores.length);
          keywordScore = Math.round(kwScores.reduce((a, b) => a + b, 0) / kwScores.length);
          contentScore = Math.round(contScores.reduce((a, b) => a + b, 0) / contScores.length);
        }

        const indexScore = cp.isIndexed === "indexed" ? 25 : cp.isIndexed === "submitted" ? 12 : 0;
        const totalScore = metaScore + keywordScore + contentScore + indexScore;

        let grade = "F";
        if (totalScore >= 90) grade = "A+";
        else if (totalScore >= 80) grade = "A";
        else if (totalScore >= 70) grade = "B+";
        else if (totalScore >= 60) grade = "B";
        else if (totalScore >= 50) grade = "C+";
        else if (totalScore >= 40) grade = "C";
        else if (totalScore >= 30) grade = "D";

        return {
          citySlug: cp.citySlug,
          cityName: cp.cityName,
          trade: cp.trade,
          country: cp.country,
          isIndexed: cp.isIndexed,
          postCount: cp.postCount,
          publishedCount: publishedPosts.length,
          scores: {
            meta: metaScore,
            keywords: keywordScore,
            content: contentScore,
            indexing: indexScore,
            total: totalScore,
          },
          grade,
        };
      });

    const totalCities = scorecards.length;
    const avgScore = totalCities > 0 ? Math.round(scorecards.reduce((s, c) => s + c.scores.total, 0) / totalCities) : 0;
    const indexedCount = scorecards.filter(c => c.isIndexed === "indexed").length;
    const gradeDistribution: Record<string, number> = {};
    for (const c of scorecards) {
      gradeDistribution[c.grade] = (gradeDistribution[c.grade] || 0) + 1;
    }

    const trades = [...new Set(cityPages.map(c => c.trade))].sort();

    res.json({
      scorecards: scorecards.sort((a, b) => b.scores.total - a.scores.total),
      summary: {
        totalCities: totalCities,
        avgScore,
        indexedCount,
        indexRate: totalCities > 0 ? Math.round((indexedCount / totalCities) * 100) : 0,
        gradeDistribution,
      },
      filters: { trades },
    });
  } catch (err) {
    console.error("SEO scorecard error:", err);
    res.status(500).json({ error: "Failed to load SEO scorecard" });
  }
});

export default router;
