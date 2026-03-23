import { Router, type IRouter } from "express";
import { db, backhaulTrucksTable, backhaulLoadsTable, backhaulMatchesTable, insertBackhaulTruckSchema, insertBackhaulLoadSchema } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

const router: IRouter = Router();

const LOAD_TYPES = [
  { type: "topsoil", label: "Topsoil", icon: "Mountain", densityLbYd: 2000 },
  { type: "gravel", label: "Gravel", icon: "Layers", densityLbYd: 2800 },
  { type: "sand", label: "Sand", icon: "Waves", densityLbYd: 2700 },
  { type: "mulch", label: "Mulch", icon: "TreePine", densityLbYd: 800 },
  { type: "concrete_rubble", label: "Concrete Rubble", icon: "Blocks", densityLbYd: 3600 },
  { type: "lumber", label: "Lumber", icon: "Box", densityLbYd: 600 },
  { type: "asphalt", label: "Asphalt Millings", icon: "Road", densityLbYd: 2900 },
  { type: "fill_dirt", label: "Fill Dirt", icon: "Mountain", densityLbYd: 2400 },
  { type: "letter_package", label: "Letter / Package", icon: "Mail", densityLbYd: 0 },
  { type: "equipment", label: "Equipment", icon: "Wrench", densityLbYd: 0 },
];

const TRUCK_TYPES = [
  { type: "dump_truck", label: "Dump Truck", maxYards: 14, maxTons: 25 },
  { type: "flatbed", label: "Flatbed", maxYards: 0, maxTons: 20 },
  { type: "tandem", label: "Tandem Axle", maxYards: 18, maxTons: 30 },
  { type: "pickup", label: "Pickup Truck", maxYards: 2, maxTons: 1 },
  { type: "van", label: "Cargo Van", maxYards: 0, maxTons: 2 },
];

router.get("/backhaul/trucks", async (_req, res) => {
  const trucks = await db.select().from(backhaulTrucksTable).orderBy(desc(backhaulTrucksTable.createdAt)).limit(100);
  res.json(trucks);
});

router.get("/backhaul/trucks/:id", async (req, res) => {
  const [truck] = await db.select().from(backhaulTrucksTable).where(eq(backhaulTrucksTable.id, parseInt(req.params.id)));
  if (!truck) return res.status(404).json({ error: "Truck not found" });
  res.json(truck);
});

router.post("/backhaul/trucks", async (req, res) => {
  const parsed = insertBackhaulTruckSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid truck data", details: parsed.error.issues });
  const [truck] = await db.insert(backhaulTrucksTable).values(parsed.data).returning();
  res.status(201).json(truck);
});

router.post("/backhaul/trucks/:id/toggle-return", async (req, res) => {
  const id = parseInt(req.params.id);
  const [truck] = await db.select().from(backhaulTrucksTable).where(eq(backhaulTrucksTable.id, id));
  if (!truck) return res.status(404).json({ error: "Truck not found" });

  const [updated] = await db.update(backhaulTrucksTable)
    .set({ isReturning: !truck.isReturning })
    .where(eq(backhaulTrucksTable.id, id))
    .returning();

  if (updated.isReturning) {
    const openLoads = await db.select().from(backhaulLoadsTable)
      .where(eq(backhaulLoadsTable.status, "open"))
      .limit(10);

    const matches = openLoads.map(load => {
      const detour = Math.abs((updated.currentLat || 49.19) - load.pickupLat) * 111 +
                     Math.abs((updated.currentLng || -122.85) - load.pickupLng) * 85;
      const score = Math.max(0, 100 - detour * 5);
      return { loadId: load.id, detourKm: Math.round(detour * 10) / 10, matchScore: Math.round(score), estimatedBonus: load.bonusAmount || load.payoutAmount * 0.15 };
    }).filter(m => m.matchScore > 20).sort((a, b) => b.matchScore - a.matchScore);

    if (matches.length > 0) {
      await db.insert(backhaulMatchesTable).values(
        matches.slice(0, 5).map(m => ({ truckId: id, loadId: m.loadId, detourKm: m.detourKm, matchScore: m.matchScore, estimatedBonus: m.estimatedBonus, status: "suggested" }))
      );
    }

    res.json({ ...updated, newMatches: matches.slice(0, 5) });
  } else {
    res.json(updated);
  }
});

router.post("/backhaul/trucks/:id/location", async (req, res) => {
  const { lat, lng } = req.body;
  const [updated] = await db.update(backhaulTrucksTable)
    .set({ currentLat: lat, currentLng: lng, lastLocationAt: new Date() })
    .where(eq(backhaulTrucksTable.id, parseInt(req.params.id)))
    .returning();
  if (!updated) return res.status(404).json({ error: "Truck not found" });
  res.json(updated);
});

router.get("/backhaul/loads", async (req, res) => {
  const status = req.query.status as string || undefined;
  const loads = status
    ? await db.select().from(backhaulLoadsTable).where(eq(backhaulLoadsTable.status, status)).orderBy(desc(backhaulLoadsTable.createdAt)).limit(100)
    : await db.select().from(backhaulLoadsTable).orderBy(desc(backhaulLoadsTable.createdAt)).limit(100);
  res.json(loads);
});

router.post("/backhaul/loads", async (req, res) => {
  const parsed = insertBackhaulLoadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid load data", details: parsed.error.issues });
  const [load] = await db.insert(backhaulLoadsTable).values(parsed.data).returning();
  res.status(201).json(load);
});

router.post("/backhaul/loads/:id/assign", async (req, res) => {
  const { truckId } = req.body;
  const [load] = await db.update(backhaulLoadsTable)
    .set({ assignedTruckId: truckId, status: "assigned", assignedAt: new Date() })
    .where(eq(backhaulLoadsTable.id, parseInt(req.params.id)))
    .returning();
  if (!load) return res.status(404).json({ error: "Load not found" });

  await db.update(backhaulMatchesTable)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(and(eq(backhaulMatchesTable.loadId, load.id), eq(backhaulMatchesTable.truckId, truckId)));

  res.json(load);
});

router.post("/backhaul/loads/:id/pickup", async (req, res) => {
  const [load] = await db.update(backhaulLoadsTable)
    .set({ status: "in_transit", pickedUpAt: new Date() })
    .where(eq(backhaulLoadsTable.id, parseInt(req.params.id)))
    .returning();
  if (!load) return res.status(404).json({ error: "Load not found" });
  res.json(load);
});

router.post("/backhaul/loads/:id/deliver", async (req, res) => {
  const [load] = await db.update(backhaulLoadsTable)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(eq(backhaulLoadsTable.id, parseInt(req.params.id)))
    .returning();
  if (!load) return res.status(404).json({ error: "Load not found" });

  if (load.assignedTruckId) {
    await db.update(backhaulTrucksTable)
      .set({
        totalLoads: sql`${backhaulTrucksTable.totalLoads} + 1`,
        totalEarnings: sql`${backhaulTrucksTable.totalEarnings} + ${load.payoutAmount}`,
        backhaulEarnings: sql`${backhaulTrucksTable.backhaulEarnings} + ${load.bonusAmount || 0}`,
      })
      .where(eq(backhaulTrucksTable.id, load.assignedTruckId));
  }
  res.json(load);
});

router.get("/backhaul/matches/:truckId", async (req, res) => {
  const matches = await db.select().from(backhaulMatchesTable)
    .where(eq(backhaulMatchesTable.truckId, parseInt(req.params.truckId)))
    .orderBy(desc(backhaulMatchesTable.matchScore))
    .limit(20);

  const enriched = await Promise.all(matches.map(async (m) => {
    const [load] = await db.select().from(backhaulLoadsTable).where(eq(backhaulLoadsTable.id, m.loadId));
    return { ...m, load };
  }));
  res.json(enriched);
});

const MARKET_CONTEXTS: Record<string, any> = {
  "CA-BC": { region: "CA-BC", market: "Pacific_Northwest", currency: "CAD", currencySymbol: "$", units: "imperial", distanceUnit: "km", weightUnit: "lbs", volumeUnit: "yards", palletSpec: "Standard Wood 48x40", localNodes: ["Slegg Building Materials", "RONA", "Home Depot Pro"], loadStandards: "GVWR Class 7/8", compliance: { authority: "BC Ministry of Transportation", gvwrLimit: "63,500 lbs", hoursOfService: "13hr driving / 14hr on-duty", chainUpZones: true, tradeLanguage: ["10-Wheelers", "Tandem Axle", "Pallets", "GVWR"], regulatorySpy: "MOT Compliance", safetyCard: "BC Safety Certificate" } },
  "CA-ON": { region: "CA-ON", market: "Greater_Toronto", currency: "CAD", currencySymbol: "$", units: "imperial", distanceUnit: "km", weightUnit: "lbs", volumeUnit: "yards", palletSpec: "Standard Wood 48x40", localNodes: ["Home Depot Pro", "RONA", "BMR"], loadStandards: "GVWR Class 7/8", compliance: { authority: "Ontario MTO", gvwrLimit: "63,500 lbs", hoursOfService: "13hr driving / 14hr on-duty", chainUpZones: false, tradeLanguage: ["10-Wheelers", "Pallets", "GVWR"], regulatorySpy: "MTO Compliance", safetyCard: "Ontario Safety Certificate" } },
  "US-WA": { region: "US-WA", market: "Pacific_Northwest", currency: "USD", currencySymbol: "$", units: "imperial", distanceUnit: "miles", weightUnit: "lbs", volumeUnit: "yards", palletSpec: "Standard Wood 48x40", localNodes: ["SiteOne Landscape Supply", "CalPortland", "Lowe's Pro"], loadStandards: "GVWR FMCSA", compliance: { authority: "FMCSA / WA DOT", gvwrLimit: "80,000 lbs", hoursOfService: "11hr driving / 14hr on-duty", chainUpZones: true, tradeLanguage: ["Pallets", "GVWR", "10-Wheelers"], regulatorySpy: "FMCSA Compliance", safetyCard: "CDL Medical Card" } },
  "GB-LDN": { region: "GB-LDN", market: "Greater_London", currency: "GBP", currencySymbol: "£", units: "metric", distanceUnit: "km", weightUnit: "kg", volumeUnit: "tonnes", palletSpec: "Euro-pallet 1200x800", localNodes: ["Jewson", "Travis Perkins", "Wickes Trade"], loadStandards: "EU Tonne Limits", compliance: { authority: "DVSA / TfL", gvwrLimit: "44,000 kg", hoursOfService: "9hr driving / EU tachograph", chainUpZones: false, ulezZone: true, tradeLanguage: ["Tonne Bags", "Euro-pallets", "Luton Vans", "Artics"], regulatorySpy: "ULEZ Status Check", safetyCard: "Driver CPC" } },
  "AU-NSW": { region: "AU-NSW", market: "Greater_Sydney", currency: "AUD", currencySymbol: "$", units: "metric", distanceUnit: "km", weightUnit: "kg", volumeUnit: "tonnes", palletSpec: "Standard AU 1165x1165", localNodes: ["Boral", "Hanson", "Bunnings Trade"], loadStandards: "NHVR Mass Limits", compliance: { authority: "NHVR / RMS NSW", gvwrLimit: "42,500 kg", hoursOfService: "12hr work / 7hr rest", chainUpZones: false, tradeLanguage: ["Utes", "High-Vis", "Site Inductions", "Tippers"], regulatorySpy: "White Card Verification", safetyCard: "White Card" } },
};

router.get("/backhaul/market-context", (req, res) => {
  const region = (req.query.region as string) || "CA-BC";
  const ctx = MARKET_CONTEXTS[region] || MARKET_CONTEXTS["CA-BC"];
  res.json(ctx);
});

router.get("/backhaul/market-regions", (_req, res) => {
  res.json(Object.entries(MARKET_CONTEXTS).map(([key, val]) => ({ code: key, market: val.market, currency: val.currency, units: val.units })));
});

router.post("/backhaul/payload-audit", (req, res) => {
  const { truckId, truckType, capacityYards, maxTonnage, currentLoadYards, currentLoadType, visualScanItems } = req.body || {};
  if (typeof capacityYards !== "number" || typeof maxTonnage !== "number") {
    return res.status(400).json({ error: "capacityYards and maxTonnage must be numbers" });
  }
  const loadTypeInfo = LOAD_TYPES.find(t => t.type === currentLoadType);
  const densityLbYd = loadTypeInfo?.densityLbYd || 2000;
  const estimatedWeightLbs = (currentLoadYards || 0) * densityLbYd;
  const estimatedWeightTons = estimatedWeightLbs / 2000;
  const gvwrPercent = maxTonnage > 0 ? (estimatedWeightTons / maxTonnage) * 100 : 0;
  const volumePercent = capacityYards > 0 ? ((currentLoadYards || 0) / capacityYards) * 100 : 0;

  const discrepancies: string[] = [];
  const alerts: string[] = [];

  if (visualScanItems && Array.isArray(visualScanItems)) {
    visualScanItems.forEach((item: any) => {
      if (item.scannedQty > (item.manifestQty || 0)) {
        discrepancies.push(`Extra ${item.name} detected (scanned: ${item.scannedQty}, manifest: ${item.manifestQty}) — Possible unrecorded backhaul.`);
      }
      if (item.scannedQty < (item.manifestQty || 0)) {
        discrepancies.push(`Missing ${item.name} (scanned: ${item.scannedQty}, manifest: ${item.manifestQty}) — Verify at next checkpoint.`);
      }
    });
  }

  if (gvwrPercent > 100) alerts.push(`OVERWEIGHT: Estimated ${estimatedWeightTons.toFixed(1)}T exceeds max ${maxTonnage}T GVWR`);
  if (gvwrPercent > 90) alerts.push(`Near GVWR limit: ${gvwrPercent.toFixed(0)}% capacity used`);
  if (volumePercent > 100) alerts.push(`OVER-VOLUME: ${currentLoadYards}yd exceeds ${capacityYards}yd capacity`);

  res.json({
    truckId,
    isClear: discrepancies.length === 0 && alerts.length === 0,
    currentGVWR: estimatedWeightLbs,
    gvwrPercent: Math.round(gvwrPercent * 10) / 10,
    volumePercent: Math.round(volumePercent * 10) / 10,
    estimatedWeightTons: Math.round(estimatedWeightTons * 100) / 100,
    remainingCapacityYards: Math.max(0, (capacityYards || 0) - (currentLoadYards || 0)),
    remainingWeightTons: Math.max(0, (maxTonnage || 0) - estimatedWeightTons),
    density: densityLbYd,
    discrepancies,
    alerts,
  });
});

router.get("/backhaul/stats", async (_req, res) => {
  const [truckStats] = await db.select({
    totalTrucks: sql<number>`count(*)`,
    liveTrucks: sql<number>`count(*) filter (where ${backhaulTrucksTable.isLive})`,
    returningTrucks: sql<number>`count(*) filter (where ${backhaulTrucksTable.isReturning})`,
  }).from(backhaulTrucksTable);

  const [loadStats] = await db.select({
    totalLoads: sql<number>`count(*)`,
    openLoads: sql<number>`count(*) filter (where ${backhaulLoadsTable.status} = 'open')`,
    inTransit: sql<number>`count(*) filter (where ${backhaulLoadsTable.status} = 'in_transit')`,
    delivered: sql<number>`count(*) filter (where ${backhaulLoadsTable.status} = 'delivered')`,
    totalRevenue: sql<number>`coalesce(sum(${backhaulLoadsTable.payoutAmount}) filter (where ${backhaulLoadsTable.status} = 'delivered'), 0)`,
  }).from(backhaulLoadsTable);

  res.json({ trucks: truckStats, loads: loadStats, loadTypes: LOAD_TYPES, truckTypes: TRUCK_TYPES });
});

export default router;
