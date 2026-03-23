import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { snapPostsTable, cityPagesTable, contractorsTable } from "@workspace/db";
import { eq, desc, sql, gte, and } from "drizzle-orm";

const router = Router();

router.get("/performance-report", async (req: Request, res: Response) => {
  try {
    const trade = req.query.trade as string | undefined;

    const allPosts = await db.select().from(snapPostsTable);
    const allCityPages = await db.select().from(cityPagesTable);
    const allContractors = await db.select().from(contractorsTable);

    const posts = trade ? allPosts.filter(p => p.trade === trade) : allPosts;
    const pages = trade ? allCityPages.filter(p => p.trade === trade) : allCityPages;
    const contractors = trade ? allContractors.filter(c => c.trade === trade) : allContractors;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const recentPosts = posts.filter(p => new Date(p.createdAt!) >= thirtyDaysAgo);
    const previousPosts = posts.filter(p => {
      const d = new Date(p.createdAt!);
      return d >= sixtyDaysAgo && d < thirtyDaysAgo;
    });

    const recentContractors = contractors.filter(c => new Date(c.createdAt!) >= thirtyDaysAgo);
    const previousContractors = contractors.filter(c => {
      const d = new Date(c.createdAt!);
      return d >= sixtyDaysAgo && d < thirtyDaysAgo;
    });

    const publishedPosts = posts.filter(p => p.status === "published");
    const pendingPosts = posts.filter(p => p.status === "pending");
    const publishRate = posts.length > 0 ? Math.round((publishedPosts.length / posts.length) * 100) : 0;

    const tradeBreakdown: Record<string, { posts: number; cities: number; contractors: number }> = {};
    for (const p of posts) {
      if (!tradeBreakdown[p.trade]) tradeBreakdown[p.trade] = { posts: 0, cities: 0, contractors: 0 };
      tradeBreakdown[p.trade].posts++;
    }
    for (const c of pages) {
      if (!tradeBreakdown[c.trade]) tradeBreakdown[c.trade] = { posts: 0, cities: 0, contractors: 0 };
      tradeBreakdown[c.trade].cities++;
    }
    for (const c of contractors) {
      if (!tradeBreakdown[c.trade]) tradeBreakdown[c.trade] = { posts: 0, cities: 0, contractors: 0 };
      tradeBreakdown[c.trade].contractors++;
    }

    const dailyPosts: Record<string, number> = {};
    for (const p of posts) {
      const day = new Date(p.createdAt!).toISOString().split("T")[0];
      dailyPosts[day] = (dailyPosts[day] || 0) + 1;
    }
    const last30Days: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split("T")[0];
      last30Days.push({ date: key, count: dailyPosts[key] || 0 });
    }

    const cityRankings = pages
      .sort((a, b) => b.postCount - a.postCount)
      .slice(0, 10)
      .map(p => ({
        city: p.cityName,
        province: p.province,
        country: p.country,
        trade: p.trade,
        postCount: p.postCount,
        isIndexed: p.isIndexed,
        impressions: p.totalImpressions || 0,
        clicks: p.totalClicks || 0,
      }));

    const contractorLeaderboard = contractors
      .sort((a, b) => b.totalPosts - a.totalPosts)
      .slice(0, 10)
      .map(c => ({
        name: c.name || "Unknown",
        trade: c.trade,
        city: c.city,
        province: c.province,
        totalPosts: c.totalPosts,
        verified: c.verified,
        welcomeSent: c.welcomeSent,
      }));

    const provinceCoverage: Record<string, { cities: number; posts: number }> = {};
    for (const p of pages) {
      const key = `${p.province}, ${p.country}`;
      if (!provinceCoverage[key]) provinceCoverage[key] = { cities: 0, posts: 0 };
      provinceCoverage[key].cities++;
      provinceCoverage[key].posts += p.postCount;
    }

    const verifiedCount = contractors.filter(c => c.verified).length;
    const onboardedCount = contractors.filter(c => c.welcomeSent).length;
    const pendingCount = contractors.filter(c => !c.verified).length;

    res.json({
      generatedAt: now.toISOString(),
      period: { from: thirtyDaysAgo.toISOString(), to: now.toISOString() },
      overview: {
        totalPosts: posts.length,
        publishedPosts: publishedPosts.length,
        pendingPosts: pendingPosts.length,
        publishRate,
        totalCityPages: pages.length,
        totalContractors: contractors.length,
        totalTrades: Object.keys(tradeBreakdown).length,
      },
      growth: {
        postsThisMonth: recentPosts.length,
        postsPreviousMonth: previousPosts.length,
        postsGrowth: previousPosts.length > 0 ? Math.round(((recentPosts.length - previousPosts.length) / previousPosts.length) * 100) : recentPosts.length > 0 ? 100 : 0,
        contractorsThisMonth: recentContractors.length,
        contractorsPreviousMonth: previousContractors.length,
        contractorsGrowth: previousContractors.length > 0 ? Math.round(((recentContractors.length - previousContractors.length) / previousContractors.length) * 100) : recentContractors.length > 0 ? 100 : 0,
      },
      contractors: {
        total: contractors.length,
        verified: verifiedCount,
        onboarded: onboardedCount,
        pending: pendingCount,
        leaderboard: contractorLeaderboard,
      },
      content: {
        dailyPosts: last30Days,
        tradeBreakdown: Object.entries(tradeBreakdown).map(([trade, data]) => ({ trade, ...data })),
      },
      seo: {
        cityRankings,
        provinceCoverage: Object.entries(provinceCoverage).map(([region, data]) => ({ region, ...data })),
        indexedPages: pages.filter(p => p.isIndexed === "indexed").length,
        pendingIndexing: pages.filter(p => p.isIndexed !== "indexed").length,
      },
    });
  } catch (err) {
    console.error("Performance report error:", err);
    res.status(500).json({ error: "Failed to generate performance report" });
  }
});

export default router;
