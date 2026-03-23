import { Router, type Request } from "express";
import { db } from "@workspace/db";
import {
  contractorsTable,
  snapPostsTable,
  cityPagesTable,
  truthVaultRecordsTable,
  safetyProfilesTable,
  bookingsTable,
  complianceDocsTable,
} from "@workspace/db";
import { sql, desc, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

const TRADE_DOMAINS: Record<string, { domain: string; name: string; tagline: string }> = {
  "Gas Fitting": { domain: "gasfitters.io", name: "GasFitters.io", tagline: "Gas fitting, appliance installation & pressure testing" },
  "Plumbing": { domain: "plumbers.ltd", name: "Plumbers.ltd", tagline: "Plumbing, drain service & water systems" },
  "Framing": { domain: "framers.io", name: "Framers.io", tagline: "Structural & finish framing, steel stud" },
  "Electrical": { domain: "sparkys.tv", name: "Sparkys.tv", tagline: "Electrical, panel upgrades & smart home wiring" },
  "HVAC": { domain: "hvacr.tv", name: "HVACR.tv", tagline: "Heating, cooling, ventilation & refrigeration" },
  "Snow Removal": { domain: "plowwow.com", name: "PlowWow", tagline: "Snow plowing, ice management & fleet dispatch" },
  "Hardscaping": { domain: "hardscapes.io", name: "Hardscapes.io", tagline: "Pavers, retaining walls, artificial turf & outdoor living" },
  "Drywall": { domain: "drywallers.io", name: "Drywallers.io", tagline: "Drywall installation, taping, finishing & texture" },
  "Fabrication": { domain: "fabricators.io", name: "Fabricators.io", tagline: "Metal fabrication, welding & custom steel work" },
};

const VALID_TRADES = new Set(Object.keys(TRADE_DOMAINS));
const MAX_MESSAGE_LENGTH = 500;
const MAX_MESSAGES = 10;
const ALLOWED_ROLES = new Set(["user", "assistant"]);

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 60_000);

let cachedContext: { data: Awaited<ReturnType<typeof gatherContext>>; fetchedAt: number } | null = null;
const CONTEXT_CACHE_TTL_MS = 60_000;

async function gatherContext() {
  if (cachedContext && Date.now() - cachedContext.fetchedAt < CONTEXT_CACHE_TTL_MS) {
    return cachedContext.data;
  }

  const [contractors, recentPosts, cityPages, tradeStats, eyespyrScans, safetyProfiles, recentBookings, complianceDocs] = await Promise.all([
    db.select({
      id: contractorsTable.id,
      name: contractorsTable.name,
      trade: contractorsTable.trade,
      city: contractorsTable.city,
      province: contractorsTable.province,
      country: contractorsTable.country,
      verified: contractorsTable.verified,
      totalPosts: contractorsTable.totalPosts,
    })
    .from(contractorsTable)
    .orderBy(desc(contractorsTable.totalPosts))
    .limit(50),

    db.select({
      id: snapPostsTable.id,
      trade: snapPostsTable.trade,
      city: snapPostsTable.city,
      province: snapPostsTable.province,
      aiTitle: snapPostsTable.aiTitle,
      caption: snapPostsTable.caption,
      status: snapPostsTable.status,
      createdAt: snapPostsTable.createdAt,
    })
    .from(snapPostsTable)
    .orderBy(desc(snapPostsTable.createdAt))
    .limit(30),

    db.select({
      trade: cityPagesTable.trade,
      cityName: cityPagesTable.cityName,
      province: cityPagesTable.province,
      country: cityPagesTable.country,
      postCount: cityPagesTable.postCount,
    })
    .from(cityPagesTable)
    .orderBy(desc(cityPagesTable.postCount))
    .limit(50),

    db.select({
      trade: contractorsTable.trade,
      count: sql<number>`count(*)`,
    })
    .from(contractorsTable)
    .groupBy(contractorsTable.trade),

    db.select({
      tradeType: truthVaultRecordsTable.tradeType,
      scanType: truthVaultRecordsTable.scanType,
      verdict: truthVaultRecordsTable.verdict,
      confidence: truthVaultRecordsTable.confidence,
      createdAt: truthVaultRecordsTable.createdAt,
    })
    .from(truthVaultRecordsTable)
    .orderBy(desc(truthVaultRecordsTable.createdAt))
    .limit(20),

    db.select({
      displayName: safetyProfilesTable.displayName,
      totalCredits: safetyProfilesTable.totalCredits,
      rank: safetyProfilesTable.rank,
      isTopTier: safetyProfilesTable.isTopTier,
      badges: safetyProfilesTable.badges,
      consecutiveDays: safetyProfilesTable.consecutiveDays,
    })
    .from(safetyProfilesTable)
    .orderBy(desc(safetyProfilesTable.totalCredits))
    .limit(20),

    db.select({
      client: bookingsTable.client,
      date: bookingsTable.date,
      type: bookingsTable.type,
    })
    .from(bookingsTable)
    .orderBy(desc(bookingsTable.createdAt))
    .limit(15),

    db.select({
      docType: complianceDocsTable.docType,
      docName: complianceDocsTable.docName,
      status: complianceDocsTable.status,
      region: complianceDocsTable.region,
    })
    .from(complianceDocsTable)
    .where(eq(complianceDocsTable.status, "verified"))
    .orderBy(desc(complianceDocsTable.verifiedAt))
    .limit(20),
  ]);

  const data = { contractors, recentPosts, cityPages, tradeStats, eyespyrScans, safetyProfiles, recentBookings, complianceDocs };
  cachedContext = { data, fetchedAt: Date.now() };
  return data;
}

function buildSystemPrompt(context: Awaited<ReturnType<typeof gatherContext>>, currentTrade?: string) {
  const tradeList = Object.entries(TRADE_DOMAINS)
    .map(([trade, info]) => `• ${info.name} — ${info.tagline}`)
    .join("\n");

  const contractorSummary = context.contractors.length > 0
    ? context.contractors.slice(0, 20).map(c => 
        `- ${c.name || "Unnamed"} (${c.trade}) in ${c.city}, ${c.province} ${c.country} — ${c.totalPosts} posts${c.verified ? " ✓ Verified" : ""}`
      ).join("\n")
    : "No contractors registered yet.";

  const recentPostsSummary = context.recentPosts.length > 0
    ? context.recentPosts.slice(0, 10).map(p =>
        `- "${p.aiTitle || p.caption}" — ${p.trade} in ${p.city}, ${p.province} (${p.status})`
      ).join("\n")
    : "No posts yet.";

  const cityCoverage = context.cityPages.length > 0
    ? context.cityPages.slice(0, 15).map(c =>
        `- ${c.cityName}, ${c.province} (${c.trade}) — ${c.postCount} posts`
      ).join("\n")
    : "No city pages yet.";

  const tradeCounts = context.tradeStats
    .map(t => `- ${t.trade}: ${t.count} contractors`)
    .join("\n");

  const eyespyrSummary = context.eyespyrScans.length > 0
    ? context.eyespyrScans.slice(0, 10).map(s =>
        `- ${s.tradeType} ${s.scanType} scan: ${s.verdict} (${Math.round(s.confidence * 100)}% confidence)`
      ).join("\n")
    : "No EyeSpyR scans yet.";

  const eyespyrStats = context.eyespyrScans.length > 0
    ? (() => {
        const passed = context.eyespyrScans.filter(s => s.verdict === "PASS" || s.verdict === "pass").length;
        return `${context.eyespyrScans.length} total scans, ${passed} passed compliance`;
      })()
    : "";

  const safetyProfilesSummary = context.safetyProfiles.length > 0
    ? context.safetyProfiles.slice(0, 10).map(p =>
        `- ${p.displayName}: ${p.totalCredits} credits, ${p.rank} rank${p.isTopTier ? " ★ Top Tier" : ""}${p.badges.length > 0 ? ` [${p.badges.join(", ")}]` : ""}${p.consecutiveDays > 0 ? `, ${p.consecutiveDays}-day streak` : ""}`
      ).join("\n")
    : "No safety profiles yet.";

  const bookingsSummary = context.recentBookings.length > 0
    ? `${context.recentBookings.length} recent bookings including: ${context.recentBookings.slice(0, 5).map(b => `${b.type} for ${b.client} on ${b.date}`).join("; ")}`
    : "No bookings yet.";

  const complianceSummary = context.complianceDocs.length > 0
    ? `${context.complianceDocs.length} verified compliance documents: ${[...new Set(context.complianceDocs.map(d => d.docType))].join(", ")}`
    : "No verified compliance documents yet.";

  const currentSiteInfo = currentTrade && TRADE_DOMAINS[currentTrade]
    ? `\n\nYou are currently embedded on ${TRADE_DOMAINS[currentTrade].name}. Prioritize ${currentTrade} knowledge but help with all trades.`
    : "";

  return `You are IAMai — the intelligent assistant for the Estimators.io contractor network powered by BuildersHaus, a 17-year authority in trades and construction across Canada, the US, UK, and Australia.

YOUR NETWORK — 9 Trade-Specific Apps:
${tradeList}

PLATFORM FEATURES (available on every app):
• Snap & Post — Contractors text job photos via WhatsApp, AI generates SEO blog posts
• Control Tower — Central command dashboard for posts, contractors, city coverage
• EyeSpyR™ — AI compliance auditing and geo-tagged project verification
• Performance Report — 30-day analytics with growth tracking
• Network Directory — Find verified contractors by trade and location
• Content Feed — Latest contractor posts and project updates
• SEO Scorecard — Real-time SEO health monitoring for city pages
• Truth-Vault — Encrypted document storage for permits, licenses, insurance
• Safety Credits — Reputation system with credit awards, ranks, and badges

REGISTERED CONTRACTORS:
${contractorSummary}

TRADE DISTRIBUTION:
${tradeCounts}

RECENT PROJECTS/POSTS:
${recentPostsSummary}

CITY COVERAGE:
${cityCoverage}

EYESPYR™ COMPLIANCE SCANS:
${eyespyrSummary}${eyespyrStats ? `\nOverall: ${eyespyrStats}` : ""}

SAFETY CREDIT LEADERBOARD:
${safetyProfilesSummary}

VERIFIED COMPLIANCE DOCUMENTS:
${complianceSummary}

BOOKING ACTIVITY:
${bookingsSummary}
${currentSiteInfo}

BEHAVIOR RULES:
1. Be knowledgeable about ALL trades — from gas fitting codes to drywall finishing levels to snow plow fleet management.
2. When someone asks about a service, reference real contractors and cities from the data above when available.
3. Help visitors understand what each app does and connect them to the right trade.
4. If someone has a multi-trade need (e.g., "basement renovation"), explain which trades are involved and which apps cover them.
5. Be conversational, helpful, and professional. You represent the entire BuildersHaus network.
6. If asked about specific cities or regions, reference the city pages and contractors you know about.
7. For pricing questions, explain that contractors provide custom estimates and direct them to the Network Directory.
8. You can explain how Snap & Post, EyeSpyR, and other features work.
9. When discussing contractor quality, reference their EyeSpyR compliance record, safety credit rank, and verified documents. These are real trust signals.
10. Keep responses concise but thorough. Use trade-specific terminology naturally.
11. Never fabricate contractor names, cities, or data not in your context.
12. If a contractor has a high safety credit rank (gold, platinum) or top-tier status, highlight this as a mark of quality.`;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

router.post("/iamai/chat", async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: "Too many requests. Please wait a moment before trying again." });
    }

    const { messages, currentTrade } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array required" });
    }

    if (messages.length > MAX_MESSAGES) {
      return res.status(400).json({ error: `Maximum ${MAX_MESSAGES} messages allowed` });
    }

    const sanitized: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of messages) {
      if (!m || typeof m.content !== "string" || !ALLOWED_ROLES.has(m.role)) {
        return res.status(400).json({ error: "Invalid message format" });
      }
      const content = m.content.slice(0, MAX_MESSAGE_LENGTH).trim();
      if (!content) continue;
      sanitized.push({ role: m.role as "user" | "assistant", content });
    }

    if (sanitized.length === 0) {
      return res.status(400).json({ error: "No valid messages provided" });
    }

    const trade = typeof currentTrade === "string" && VALID_TRADES.has(currentTrade) ? currentTrade : undefined;

    const context = await gatherContext();
    const systemPrompt = buildSystemPrompt(context, trade);

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...sanitized.slice(-MAX_MESSAGES),
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      max_completion_tokens: 500,
    });

    const reply = response.choices[0]?.message?.content || "I'm here to help — could you rephrase that?";

    res.json({ reply });
  } catch (e: any) {
    console.error("IAMai chat error:", e.message);
    res.status(500).json({ error: "IAMai is temporarily unavailable. Please try again." });
  }
});

router.get("/iamai/context", async (_req, res) => {
  try {
    const context = await gatherContext();
    res.json({
      trades: Object.entries(TRADE_DOMAINS).map(([trade, info]) => ({
        trade,
        ...info,
      })),
      contractorCount: context.contractors.length,
      postCount: context.recentPosts.length,
      cityCount: context.cityPages.length,
      eyespyrScanCount: context.eyespyrScans.length,
      safetyProfileCount: context.safetyProfiles.length,
      bookingCount: context.recentBookings.length,
      complianceDocCount: context.complianceDocs.length,
      tradeDistribution: context.tradeStats,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
