import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { contractorsTable, snapPostsTable, cityPagesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { generateSEOPost } from "../lib/ai-content";
import { generateWelcomeMessage, generatePostConfirmation } from "../lib/welcome-message";

const router = Router();

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function twiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${message}</Message></Response>`;
}

router.post("/whatsapp-webhook", async (req: Request, res: Response) => {
  try {
    const { From, Body, MediaUrl0, NumMedia } = req.body;

    if (!From) {
      return res.status(400).json({ error: "Missing phone number (From)" });
    }

    const phone = From.replace("whatsapp:", "").trim();
    const contractors = await db.select().from(contractorsTable).where(eq(contractorsTable.phone, phone));
    const contractor = contractors[0];

    if (!contractor) {
      res.set("Content-Type", "text/xml");
      return res.send(twiml("You're not registered yet. Sign up at estimators.io to start posting."));
    }

    const isFirstContact = !contractor.verified || !contractor.welcomeSent;

    if (isFirstContact) {
      await db.update(contractorsTable)
        .set({
          verified: true,
          welcomeSent: true,
          welcomeSentAt: new Date(),
          whatsappOptIn: true,
        })
        .where(eq(contractorsTable.id, contractor.id));

      const welcomeMsg = generateWelcomeMessage({
        name: contractor.name,
        trade: contractor.trade,
        city: contractor.city,
        province: contractor.province,
        country: contractor.country,
      });

      res.set("Content-Type", "text/xml");
      return res.send(twiml(welcomeMsg));
    }

    const hasMedia = parseInt(NumMedia || "0") > 0;

    if (!hasMedia) {
      res.set("Content-Type", "text/xml");
      return res.send(twiml(`📸 Send a photo with your caption to create a new post for ${contractor.city}.\n\nExample: Snap a pic and write what you did. Our AI handles the rest.`));
    }

    const caption = Body || "Job complete";
    const photoUrl = MediaUrl0 || "";
    const citySlug = slugify(contractor.city);

    let aiResult = {
      title: `${contractor.trade} in ${contractor.city}`,
      content: caption,
      metaDescription: `${contractor.trade} services in ${contractor.city}`,
      keywords: [contractor.trade.toLowerCase(), contractor.city.toLowerCase()],
    };

    try {
      aiResult = await generateSEOPost({
        caption,
        trade: contractor.trade,
        city: contractor.city,
        province: contractor.province,
        country: contractor.country,
      });
    } catch (err) {
      console.error("AI generation failed, using fallback:", err);
    }

    let newPostCount = contractor.totalPosts + 1;

    await db.transaction(async (tx) => {
      await tx.insert(snapPostsTable).values({
        contractorId: contractor.id,
        contractorPhone: phone,
        photoUrl,
        photoStorageUrl: photoUrl,
        caption,
        aiContent: aiResult.content,
        aiTitle: aiResult.title,
        aiMetaDescription: aiResult.metaDescription,
        trade: contractor.trade,
        city: contractor.city,
        citySlug,
        province: contractor.province,
        country: contractor.country,
        status: "published",
        seoKeywords: aiResult.keywords,
      });

      const existing = await tx.select().from(cityPagesTable)
        .where(and(eq(cityPagesTable.citySlug, citySlug), eq(cityPagesTable.trade, contractor.trade)));

      if (existing.length) {
        await tx.update(cityPagesTable)
          .set({ postCount: existing[0].postCount + 1, lastPostAt: new Date() })
          .where(eq(cityPagesTable.id, existing[0].id));
      } else {
        await tx.insert(cityPagesTable).values({
          trade: contractor.trade,
          citySlug,
          cityName: contractor.city,
          province: contractor.province,
          country: contractor.country,
          postCount: 1,
          lastPostAt: new Date(),
        });
      }

      await tx.update(contractorsTable)
        .set({ totalPosts: sql`${contractorsTable.totalPosts} + 1` })
        .where(eq(contractorsTable.id, contractor.id));
    });

    const confirmation = generatePostConfirmation({
      aiTitle: aiResult.title,
      trade: contractor.trade,
      citySlug,
      postNumber: newPostCount,
    });

    res.set("Content-Type", "text/xml");
    res.send(twiml(confirmation));
  } catch (err) {
    console.error("Webhook error:", err);
    res.set("Content-Type", "text/xml");
    res.send(twiml("Something went wrong processing your snap. Please try again in a moment."));
  }
});

router.get("/whatsapp-webhook", (_req: Request, res: Response) => {
  res.status(200).send("Snap & Post webhook is active");
});

export default router;
