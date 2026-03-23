import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { cityPagesTable, insertCityPageSchema, snapPostsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

router.get("/city-pages", async (req: Request, res: Response) => {
  const { trade, country } = req.query;
  const pages = await db.select().from(cityPagesTable).orderBy(desc(cityPagesTable.lastPostAt));
  let filtered = pages;
  if (trade) filtered = filtered.filter(p => p.trade === trade);
  if (country) filtered = filtered.filter(p => p.country === country);
  res.json(filtered);
});

router.get("/city-pages/:id", async (req: Request, res: Response) => {
  const page = await db.select().from(cityPagesTable).where(eq(cityPagesTable.id, Number(req.params.id)));
  if (!page.length) return res.status(404).json({ error: "City page not found" });

  const posts = await db.select().from(snapPostsTable)
    .where(and(eq(snapPostsTable.citySlug, page[0].citySlug), eq(snapPostsTable.trade, page[0].trade)))
    .orderBy(desc(snapPostsTable.createdAt));

  res.json({ ...page[0], posts });
});

router.post("/city-pages", async (req: Request, res: Response) => {
  const parsed = insertCityPageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
  const [created] = await db.insert(cityPagesTable).values(parsed.data).returning();
  res.status(201).json(created);
});

router.delete("/city-pages/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [deleted] = await db.delete(cityPagesTable).where(eq(cityPagesTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ error: "City page not found" });
  res.json(deleted);
});

router.get("/sitemap/:trade", async (req: Request, res: Response) => {
  const trade = req.params.trade;
  const pages = await db.select().from(cityPagesTable).where(eq(cityPagesTable.trade, trade));

  const tradeDomain = trade.toLowerCase().replace(/\s+/g, "") + ".io";
  const urls = pages.map(p => `  <url>
    <loc>https://${tradeDomain}/locations/${p.citySlug}</loc>
    <lastmod>${(p.lastPostAt || p.updatedAt).toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${tradeDomain}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
${urls}
</urlset>`;

  res.set("Content-Type", "application/xml");
  res.send(xml);
});

export default router;
