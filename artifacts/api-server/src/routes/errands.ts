import { Router, type IRouter } from "express";
import { db, errandsTable, errandTypesTable, insertErrandSchema, backhaulLoadsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

const DEFAULT_ERRAND_TYPES = [
  { name: "Yard of Dirt", slug: "yard_of_dirt", category: "bulk_delivery", description: "Topsoil, fill dirt, or garden soil delivered to your door", icon: "Mountain", basePrice: 65, pricePerKm: 3, pricePerYard: 45, requiresTruck: true, minTruckCapacity: 1, estimatedMinutes: 60 },
  { name: "Gravel Drop", slug: "gravel_drop", category: "bulk_delivery", description: "Crushed gravel for driveways, paths, or drainage", icon: "Layers", basePrice: 75, pricePerKm: 3, pricePerYard: 55, requiresTruck: true, minTruckCapacity: 1, estimatedMinutes: 60 },
  { name: "Mulch Delivery", slug: "mulch_delivery", category: "bulk_delivery", description: "Bark mulch or wood chips for landscaping", icon: "TreePine", basePrice: 55, pricePerKm: 2.5, pricePerYard: 35, requiresTruck: true, minTruckCapacity: 1, estimatedMinutes: 45 },
  { name: "Sand Delivery", slug: "sand_delivery", category: "bulk_delivery", description: "Play sand, masonry sand, or fill sand", icon: "Waves", basePrice: 60, pricePerKm: 3, pricePerYard: 40, requiresTruck: true, minTruckCapacity: 1, estimatedMinutes: 50 },
  { name: "Junk Removal", slug: "junk_removal", category: "removal", description: "Haul away old furniture, appliances, or yard waste", icon: "Trash2", basePrice: 85, pricePerKm: 2, requiresTruck: true, minTruckCapacity: 2, estimatedMinutes: 90 },
  { name: "Furniture Move", slug: "furniture_move", category: "moving", description: "Move a couch, table, or mattress across town", icon: "Armchair", basePrice: 50, pricePerKm: 2, requiresTruck: false, estimatedMinutes: 60 },
  { name: "Letter / Package", slug: "letter_package", category: "courier", description: "Same-day letter or package delivery", icon: "Mail", basePrice: 15, pricePerKm: 1.5, requiresTruck: false, estimatedMinutes: 30 },
  { name: "Grocery Run", slug: "grocery_run", category: "errand", description: "Pick up and deliver groceries from any store", icon: "ShoppingCart", basePrice: 20, pricePerKm: 1.5, requiresTruck: false, estimatedMinutes: 45 },
  { name: "Equipment Rental Pickup", slug: "equipment_pickup", category: "delivery", description: "Pick up rented equipment (saws, compactors, etc.)", icon: "Wrench", basePrice: 40, pricePerKm: 2, requiresTruck: false, estimatedMinutes: 45 },
  { name: "Landscaping Supplies", slug: "landscaping_supplies", category: "bulk_delivery", description: "Pavers, retaining wall blocks, sod rolls", icon: "Flower2", basePrice: 70, pricePerKm: 3, requiresTruck: true, minTruckCapacity: 2, estimatedMinutes: 60 },
];

router.get("/errands", async (req, res) => {
  const status = req.query.status as string || undefined;
  const errands = status
    ? await db.select().from(errandsTable).where(eq(errandsTable.status, status)).orderBy(desc(errandsTable.createdAt)).limit(100)
    : await db.select().from(errandsTable).orderBy(desc(errandsTable.createdAt)).limit(100);
  res.json(errands);
});

router.get("/errands/active", async (_req, res) => {
  const active = await db.select().from(errandsTable)
    .where(sql`${errandsTable.status} IN ('pending', 'assigned', 'in_transit')`)
    .orderBy(desc(errandsTable.createdAt))
    .limit(50);
  res.json(active);
});

router.get("/errands/quote", async (req, res) => {
  const { type, distanceKm, yards } = req.query;
  if (!type) return res.status(400).json({ error: "type query parameter required" });
  const [errandType] = await db.select().from(errandTypesTable).where(eq(errandTypesTable.slug, type as string));
  if (!errandType) return res.status(404).json({ error: "Unknown errand type" });

  const dist = parseFloat(distanceKm as string) || 5;
  const yds = parseFloat(yards as string) || 0;
  let price = errandType.basePrice + (errandType.pricePerKm * dist);
  if (errandType.pricePerYard && yds > 0) price += errandType.pricePerYard * yds;

  res.json({ type: errandType.slug, name: errandType.name, distanceKm: dist, yards: yds, quotedPrice: Math.round(price * 100) / 100, estimatedMinutes: errandType.estimatedMinutes, requiresTruck: errandType.requiresTruck });
});

router.get("/errands/track/:code", async (req, res) => {
  const [errand] = await db.select().from(errandsTable).where(eq(errandsTable.trackingCode, req.params.code));
  if (!errand) return res.status(404).json({ error: "Tracking code not found" });
  res.json({
    id: errand.id,
    status: errand.status,
    errandType: errand.errandType,
    dropoffAddress: errand.dropoffAddress,
    assignedDriverName: errand.assignedDriverName,
    estimatedMinutes: errand.estimatedMinutes,
    currentLat: errand.currentLat,
    currentLng: errand.currentLng,
    pickedUpAt: errand.pickedUpAt,
    deliveredAt: errand.deliveredAt,
    trackingCode: errand.trackingCode,
  });
});

router.get("/errands/types/list", async (_req, res) => {
  let types = await db.select().from(errandTypesTable).orderBy(errandTypesTable.name);
  if (types.length === 0) {
    types = await db.insert(errandTypesTable).values(DEFAULT_ERRAND_TYPES).returning();
  }
  res.json(types);
});

router.get("/errands/stats/summary", async (_req, res) => {
  const [stats] = await db.select({
    totalErrands: sql<number>`count(*)`,
    pending: sql<number>`count(*) filter (where ${errandsTable.status} = 'pending')`,
    active: sql<number>`count(*) filter (where ${errandsTable.status} IN ('assigned', 'in_transit'))`,
    delivered: sql<number>`count(*) filter (where ${errandsTable.status} = 'delivered')`,
    totalRevenue: sql<number>`coalesce(sum(${errandsTable.finalPrice}) filter (where ${errandsTable.status} = 'delivered'), 0)`,
    totalTips: sql<number>`coalesce(sum(${errandsTable.tipAmount}), 0)`,
    avgRating: sql<number>`coalesce(avg(${errandsTable.customerRating}), 0)`,
  }).from(errandsTable);

  res.json(stats);
});

router.get("/errands/:id", async (req, res) => {
  const id = (() => { const _id = parseInt(req.params.id); if (isNaN(_id)) { res.status(400).json({ error: "Invalid ID" }); return -1; } return _id; })();
  if (isNaN(id)) return res.status(400).json({ error: "Invalid errand ID" });
  const [errand] = await db.select().from(errandsTable).where(eq(errandsTable.id, id));
  if (!errand) return res.status(404).json({ error: "Errand not found" });
  res.json(errand);
});

const BULK_ERRAND_TO_LOAD: Record<string, string> = {
  yard_of_dirt: "topsoil",
  gravel_drop: "gravel",
  mulch_delivery: "mulch",
  sand_delivery: "sand",
  landscaping_supplies: "equipment",
  junk_removal: "fill_dirt",
};

router.post("/errands", async (req, res) => {
  const trackingCode = `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const parsed = insertErrandSchema.safeParse({ ...req.body, trackingCode });
  if (!parsed.success) return res.status(400).json({ error: "Invalid errand data", details: parsed.error.issues });
  const [errand] = await db.insert(errandsTable).values(parsed.data).returning();

  const loadType = BULK_ERRAND_TO_LOAD[errand.errandType];
  if (loadType) {
    try {
      await db.insert(backhaulLoadsTable).values({
        title: `Errand: ${errand.errandType.replace(/_/g, " ")}`,
        loadType,
        materialType: loadType,
        description: `Auto-posted from Errand #${errand.id} (${errand.trackingCode}) — ${errand.customerName || "Customer"}`,
        pickupAddress: errand.pickupAddress || "Supplier TBD",
        pickupLat: errand.pickupLat || 48.45,
        pickupLng: errand.pickupLng || -123.35,
        dropoffAddress: errand.dropoffAddress || "Customer address",
        dropoffLat: errand.dropoffLat,
        dropoffLng: errand.dropoffLng,
        quantityYards: errand.quantityYards || 1,
        payoutAmount: errand.quotedPrice ? Math.round(Number(errand.quotedPrice) * 0.7) : 50,
        bonusAmount: errand.priority === "urgent" ? 25 : 10,
        priority: errand.priority || "normal",
        status: "open",
        requestedBy: errand.customerName || "errands.io",
        errandId: errand.id,
      });
    } catch (err) {
      console.error("[Errand→Backhaul] Failed to auto-post load for errand", errand.id, err);
    }
  }

  res.status(201).json(errand);
});

router.post("/errands/:id/assign", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { truckId, driverName } = req.body;
  const [errand] = await db.update(errandsTable)
    .set({ assignedTruckId: truckId, assignedDriverName: driverName, status: "assigned" })
    .where(eq(errandsTable.id, id))
    .returning();
  if (!errand) return res.status(404).json({ error: "Errand not found" });
  res.json(errand);
});

router.post("/errands/:id/pickup", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const [errand] = await db.update(errandsTable)
    .set({ status: "in_transit", pickedUpAt: new Date() })
    .where(eq(errandsTable.id, id))
    .returning();
  if (!errand) return res.status(404).json({ error: "Errand not found" });
  res.json(errand);
});

router.post("/errands/:id/deliver", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const [errand] = await db.update(errandsTable)
    .set({ status: "delivered", deliveredAt: new Date(), finalPrice: req.body.finalPrice })
    .where(eq(errandsTable.id, id))
    .returning();
  if (!errand) return res.status(404).json({ error: "Errand not found" });
  res.json(errand);
});

router.post("/errands/:id/rate", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { rating, notes } = req.body;
  const [errand] = await db.update(errandsTable)
    .set({ customerRating: rating, customerNotes: notes })
    .where(eq(errandsTable.id, id))
    .returning();
  if (!errand) return res.status(404).json({ error: "Errand not found" });
  res.json(errand);
});

router.post("/errands/:id/track", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { lat, lng } = req.body;
  const [errand] = await db.update(errandsTable)
    .set({ currentLat: lat, currentLng: lng })
    .where(eq(errandsTable.id, id))
    .returning();
  if (!errand) return res.status(404).json({ error: "Errand not found" });
  res.json(errand);
});

export default router;
