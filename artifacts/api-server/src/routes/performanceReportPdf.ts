import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { snapPostsTable, cityPagesTable, contractorsTable } from "@workspace/db";
import PDFDocument from "pdfkit";

const router = Router();

const COLORS = {
  bg: "#0f1115",
  card: "#1a1d24",
  border: "#2a2d35",
  primary: "#f97316",
  emerald: "#34d399",
  blue: "#60a5fa",
  violet: "#a78bfa",
  amber: "#fbbf24",
  text: "#ffffff",
  muted: "#9ca3af",
  dim: "#6b7280",
};

function drawRoundedRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, r: number) {
  doc.moveTo(x + r, y)
    .lineTo(x + w - r, y)
    .quadraticCurveTo(x + w, y, x + w, y + r)
    .lineTo(x + w, y + h - r)
    .quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    .lineTo(x + r, y + h)
    .quadraticCurveTo(x, y + h, x, y + h - r)
    .lineTo(x, y + r)
    .quadraticCurveTo(x, y, x + r, y);
}

function drawStatCard(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number,
  label: string, value: string | number, color: string, subtitle?: string
) {
  doc.save();
  drawRoundedRect(doc, x, y, w, 70, 6);
  doc.fillColor(COLORS.card).fill();
  doc.save();
  drawRoundedRect(doc, x, y, w, 70, 6);
  doc.lineWidth(1).strokeColor(color).strokeOpacity(0.3).stroke();
  doc.restore();

  doc.fillColor(COLORS.muted).fontSize(7).font("Helvetica-Bold")
    .text(label.toUpperCase(), x + 12, y + 12, { width: w - 24 });
  doc.fillColor(COLORS.text).fontSize(22).font("Helvetica-Bold")
    .text(String(value), x + 12, y + 26, { width: w - 24 });
  if (subtitle) {
    doc.fillColor(COLORS.dim).fontSize(7).font("Helvetica")
      .text(subtitle, x + 12, y + 52, { width: w - 24 });
  }
  doc.restore();
}

function drawProgressBar(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  value: number, max: number, color: string
) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  doc.save();
  drawRoundedRect(doc, x, y, w, h, h / 2);
  doc.fillColor("#ffffff").fillOpacity(0.06).fill();
  doc.restore();
  if (pct > 0) {
    doc.save();
    drawRoundedRect(doc, x, y, Math.max(w * pct, h), h, h / 2);
    doc.fillColor(color).fillOpacity(0.8).fill();
    doc.restore();
  }
}

function drawSectionHeader(doc: PDFKit.PDFDocument, x: number, y: number, title: string, color: string) {
  doc.save();
  doc.rect(x, y, 3, 14).fill(color);
  doc.fillColor(COLORS.text).fontSize(10).font("Helvetica-Bold")
    .text(title, x + 10, y + 1);
  doc.restore();
  return y + 22;
}

router.get("/performance-report/pdf", async (req: Request, res: Response) => {
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

    const publishedPosts = posts.filter(p => p.status === "published");
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

    const verifiedCount = contractors.filter(c => c.verified).length;
    const onboardedCount = contractors.filter(c => c.welcomeSent).length;

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

    const contractorLeaderboard = contractors
      .sort((a, b) => b.totalPosts - a.totalPosts)
      .slice(0, 5);

    const cityRankings = pages
      .sort((a, b) => b.postCount - a.postCount)
      .slice(0, 5);

    const provinceCoverage: Record<string, { cities: number; posts: number }> = {};
    for (const p of pages) {
      const key = `${p.province}, ${p.country}`;
      if (!provinceCoverage[key]) provinceCoverage[key] = { cities: 0, posts: 0 };
      provinceCoverage[key].cities++;
      provinceCoverage[key].posts += p.postCount;
    }

    const postsGrowth = previousPosts.length > 0
      ? Math.round(((recentPosts.length - previousPosts.length) / previousPosts.length) * 100)
      : recentPosts.length > 0 ? 100 : 0;

    const doc = new PDFDocument({
      size: "letter",
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const pdfReady = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const pageWidth = 612;
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;

    doc.rect(0, 0, pageWidth, 792).fill(COLORS.bg);

    doc.fillColor(COLORS.primary).fontSize(18).font("Helvetica-Bold")
      .text("EYESPYR", margin, 42);
    doc.fillColor(COLORS.text).fontSize(18).font("Helvetica")
      .text(" Performance Report", margin + 62, 42, { continued: false });

    doc.fillColor(COLORS.dim).fontSize(8).font("Helvetica")
      .text(
        `${thirtyDaysAgo.toLocaleDateString()} — ${now.toLocaleDateString()}  |  Generated ${now.toLocaleString()}`,
        margin, 66
      );

    doc.moveTo(margin, 82).lineTo(pageWidth - margin, 82)
      .lineWidth(0.5).strokeColor(COLORS.border).stroke();

    let curY = 92;

    const cardW = (contentWidth - 12) / 4;
    drawStatCard(doc, margin, curY, cardW, "Total Content", posts.length, COLORS.primary,
      `${publishRate}% published · ${postsGrowth > 0 ? "+" : ""}${postsGrowth}% growth`);
    drawStatCard(doc, margin + cardW + 4, curY, cardW, "City Coverage", pages.length, COLORS.emerald,
      `${Object.keys(provinceCoverage).length} regions`);
    drawStatCard(doc, margin + (cardW + 4) * 2, curY, cardW, "Contractors", contractors.length, COLORS.blue,
      `${verifiedCount} verified · ${onboardedCount} onboarded`);
    drawStatCard(doc, margin + (cardW + 4) * 3, curY, cardW, "Active Trades", Object.keys(tradeBreakdown).length, COLORS.violet,
      Object.keys(tradeBreakdown).slice(0, 3).join(", "));

    curY += 84;

    curY = drawSectionHeader(doc, margin, curY, "Content Activity — Last 30 Days", COLORS.primary);

    const chartW = contentWidth;
    const chartH = 50;
    const maxDayCount = Math.max(...last30Days.map(d => d.count), 1);

    doc.save();
    drawRoundedRect(doc, margin, curY, chartW, chartH + 10, 4);
    doc.fillColor(COLORS.card).fill();
    doc.restore();

    const barW = (chartW - 20) / last30Days.length;
    for (let i = 0; i < last30Days.length; i++) {
      const d = last30Days[i];
      const barH = (d.count / maxDayCount) * chartH;
      if (barH > 0) {
        doc.rect(
          margin + 10 + i * barW,
          curY + 5 + (chartH - barH),
          Math.max(barW - 1, 1),
          barH
        ).fill(COLORS.primary);
      }
    }

    curY += chartH + 20;

    const leftCol = margin;
    const rightCol = margin + contentWidth / 2 + 6;
    const halfW = contentWidth / 2 - 6;

    let leftY = drawSectionHeader(doc, leftCol, curY, "Trade Breakdown", COLORS.violet);
    const tradeEntries = Object.entries(tradeBreakdown);
    const maxTradePosts = Math.max(...tradeEntries.map(([, d]) => d.posts), 1);
    const tColors = [COLORS.primary, COLORS.emerald, COLORS.blue, COLORS.violet, COLORS.amber];

    for (let i = 0; i < tradeEntries.length; i++) {
      const [tradeName, td] = tradeEntries[i];
      doc.fillColor(COLORS.text).fontSize(8).font("Helvetica-Bold")
        .text(tradeName, leftCol, leftY, { width: halfW * 0.5 });
      doc.fillColor(COLORS.dim).fontSize(7).font("Helvetica")
        .text(`${td.posts} posts · ${td.cities} cities · ${td.contractors} pros`, leftCol + halfW * 0.5, leftY + 1, { width: halfW * 0.5, align: "right" });
      drawProgressBar(doc, leftCol, leftY + 14, halfW, 5, td.posts, maxTradePosts, tColors[i % tColors.length]);
      leftY += 26;
    }

    let rightY = drawSectionHeader(doc, rightCol, curY, "Contractor Leaderboard", COLORS.amber);
    if (contractorLeaderboard.length === 0) {
      doc.fillColor(COLORS.dim).fontSize(8).font("Helvetica")
        .text("No contractors yet", rightCol, rightY);
      rightY += 16;
    } else {
      for (let i = 0; i < contractorLeaderboard.length; i++) {
        const c = contractorLeaderboard[i];
        const medalColors = [COLORS.amber, "#cbd5e1", "#fb923c"];
        const rankColor = i < 3 ? medalColors[i] : COLORS.dim;

        doc.save();
        doc.circle(rightCol + 8, rightY + 7, 8).fillColor(rankColor).fillOpacity(0.2).fill();
        doc.fillColor(rankColor).fillOpacity(1).fontSize(7).font("Helvetica-Bold")
          .text(String(i + 1), rightCol + 3.5, rightY + 3.5, { width: 10, align: "center" });
        doc.restore();

        doc.fillColor(COLORS.text).fontSize(8).font("Helvetica-Bold")
          .text(c.name || "Unknown", rightCol + 22, rightY, { width: halfW - 60 });
        doc.fillColor(COLORS.dim).fontSize(6.5).font("Helvetica")
          .text(`${c.trade} — ${c.city}`, rightCol + 22, rightY + 10, { width: halfW - 60 });
        doc.fillColor(COLORS.primary).fontSize(8).font("Helvetica-Bold")
          .text(`${c.totalPosts}`, rightCol + halfW - 40, rightY, { width: 30, align: "right" });
        doc.fillColor(COLORS.dim).fontSize(6).font("Helvetica")
          .text("posts", rightCol + halfW - 10, rightY + 1, { width: 20 });
        rightY += 24;
      }
    }

    curY = Math.max(leftY, rightY) + 10;

    leftY = drawSectionHeader(doc, leftCol, curY, "Top Cities by Content", COLORS.emerald);
    for (let i = 0; i < Math.min(cityRankings.length, 5); i++) {
      const city = cityRankings[i];
      const flag = city.country === "CA" ? "CA" : city.country === "US" ? "US" : city.country;
      doc.fillColor(COLORS.text).fontSize(8).font("Helvetica-Bold")
        .text(`[${flag}] ${city.cityName}`, leftCol, leftY, { width: halfW * 0.6 });
      doc.fillColor(COLORS.dim).fontSize(6.5).font("Helvetica")
        .text(`${city.trade} · ${city.province}`, leftCol, leftY + 10, { width: halfW * 0.6 });
      doc.fillColor(COLORS.muted).fontSize(7).font("Helvetica")
        .text(`${city.postCount} posts`, leftCol + halfW - 50, leftY + 2, { width: 40, align: "right" });
      doc.fillColor(city.isIndexed === "indexed" ? COLORS.emerald : COLORS.amber).fontSize(6).font("Helvetica-Bold")
        .text(city.isIndexed === "indexed" ? "INDEXED" : "PENDING", leftCol + halfW - 5, leftY + 2, { width: 40 });
      leftY += 24;
    }

    rightY = drawSectionHeader(doc, rightCol, curY, "Regional Coverage", COLORS.blue);
    const provEntries = Object.entries(provinceCoverage);
    const maxRegionPosts = Math.max(...provEntries.map(([, d]) => d.posts), 1);
    for (let i = 0; i < provEntries.length; i++) {
      const [region, rd] = provEntries[i];
      doc.fillColor(COLORS.text).fontSize(8).font("Helvetica-Bold")
        .text(region, rightCol, rightY, { width: halfW * 0.55 });
      doc.fillColor(COLORS.dim).fontSize(7).font("Helvetica")
        .text(`${rd.cities} cities · ${rd.posts} posts`, rightCol + halfW * 0.55, rightY + 1, { width: halfW * 0.45, align: "right" });
      drawProgressBar(doc, rightCol, rightY + 14, halfW, 5, rd.posts, maxRegionPosts, tColors[i % tColors.length]);
      rightY += 26;
    }

    curY = Math.max(leftY, rightY) + 20;

    doc.moveTo(margin, curY).lineTo(pageWidth - margin, curY)
      .lineWidth(0.5).strokeColor(COLORS.border).stroke();

    doc.fillColor(COLORS.dim).fontSize(7).font("Helvetica")
      .text(
        `EyeSpyR Performance Report · estimators.io · ${now.toLocaleString()}`,
        margin, curY + 8,
        { width: contentWidth, align: "center" }
      );

    doc.end();

    const pdfBuffer = await pdfReady;

    const filename = `performance-report-${now.toISOString().split("T")[0]}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).json({ error: "Failed to generate PDF report" });
  }
});

export default router;
