import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, plowDriversTable, saltDepotsTable, reputationLedgerTable } from "@workspace/db";

const router: IRouter = Router();

const REPUTATION_ACTIONS: Record<string, { points: number; metric: string; description: string }> = {
  fast_response: { points: 25, metric: "response_time", description: "Fast Response (< 30min from snow alert)" },
  on_time_arrival: { points: 15, metric: "response_time", description: "On-Time Route Arrival" },
  route_complete: { points: 20, metric: "response_time", description: "Route Completed On Schedule" },
  clean_van_audit: { points: 30, metric: "audit_consistency", description: "Clean Van Stock Audit (0 discrepancies)" },
  low_discrepancy_audit: { points: 15, metric: "audit_consistency", description: "Low Discrepancy Audit (< 3 items)" },
  material_usage_match: { points: 20, metric: "audit_consistency", description: "Material Usage Matches Invoice" },
  photo_evidence_uploaded: { points: 10, metric: "evidence_accuracy", description: "Photo Evidence Uploaded to Vault" },
  eyespyr_scan_pass: { points: 35, metric: "evidence_accuracy", description: "EyeSpyR Scan PASS Recorded" },
  truthvault_sealed: { points: 50, metric: "evidence_accuracy", description: "Truth-Vault Record Sealed" },
  zero_dispute_billing: { points: 40, metric: "evidence_accuracy", description: "Zero-Dispute Billing Cycle" },
  salt_efficiency: { points: 15, metric: "audit_consistency", description: "Salt Usage Within Efficiency Targets" },
  no_complaints: { points: 20, metric: "evidence_accuracy", description: "Zero Customer Complaints This Month" },
  gc_recommendation: { points: 100, metric: "evidence_accuracy", description: "GC Master Contract Recommendation" },
};

const RANK_THRESHOLDS = [
  { min: 0, rank: "rookie", label: "Rookie" },
  { min: 100, rank: "reliable", label: "Reliable" },
  { min: 300, rank: "proven", label: "Proven" },
  { min: 600, rank: "elite", label: "Elite" },
  { min: 1200, rank: "master", label: "Master" },
  { min: 2500, rank: "legend", label: "Legend" },
];

function calculateRank(score: number): string {
  let rank = "rookie";
  for (const t of RANK_THRESHOLDS) {
    if (score >= t.min) rank = t.rank;
  }
  return rank;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get("/plow-drivers", async (_req, res): Promise<void> => {
  const drivers = await db.select().from(plowDriversTable).orderBy(desc(plowDriversTable.reputationScore));
  res.json(drivers);
});

router.post("/plow-drivers", async (req, res): Promise<void> => {
  const body = req.body;
  const [driver] = await db.insert(plowDriversTable).values({
    name: body.name,
    vanId: body.vanId || "Van_1",
    phone: body.phone || "",
    email: body.email || "",
    kycStatus: body.kycStatus || "pending",
    saltCapacityKg: body.saltCapacityKg || 500,
  }).returning();
  res.status(201).json(driver);
});

router.get("/plow-drivers/leaderboard", async (_req, res): Promise<void> => {
  const drivers = await db.select().from(plowDriversTable)
    .orderBy(desc(plowDriversTable.reputationScore))
    .limit(20);

  res.json({
    leaderboard: drivers.map((d, i) => ({
      rank: i + 1,
      id: d.id,
      name: d.name,
      vanId: d.vanId,
      reputationScore: d.reputationScore,
      reputationRank: d.reputationRank,
      totalJobs: d.totalJobs,
      isLive: d.isLive,
      kycStatus: d.kycStatus,
    })),
    rankThresholds: RANK_THRESHOLDS,
  });
});

router.get("/plow-drivers/reputation-actions", (_req, res): void => {
  res.json({
    actions: Object.entries(REPUTATION_ACTIONS).map(([key, val]) => ({
      action: key,
      ...val,
    })),
    rankThresholds: RANK_THRESHOLDS,
    metrics: [
      { key: "response_time", label: "Response Time", description: "GPS trigger vs. Snow Start time. High score = Priority for next year's GC master contracts." },
      { key: "audit_consistency", label: "Audit Consistency", description: "Van scans vs. Material usage. Proves contractor isn't leaking company supplies." },
      { key: "evidence_accuracy", label: "Evidence Accuracy", description: "Photo logs in the Evidence Vault. Zero-dispute billing for the GC." },
    ],
  });
});

router.get("/plow-drivers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [driver] = await db.select().from(plowDriversTable).where(eq(plowDriversTable.id, id));
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }
  res.json(driver);
});

router.patch("/plow-drivers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = req.body;
  const updateData: Record<string, unknown> = {};
  for (const key of ["name", "vanId", "phone", "email", "kycStatus"]) {
    if (body[key] !== undefined) updateData[key] = body[key];
  }
  for (const key of ["saltCapacityKg"]) {
    if (body[key] !== undefined) updateData[key] = body[key];
  }
  if (body.activeJobIds !== undefined) updateData.activeJobIds = body.activeJobIds;
  if (body.badges !== undefined) updateData.badges = body.badges;

  const [driver] = await db.update(plowDriversTable).set(updateData).where(eq(plowDriversTable.id, id)).returning();
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }
  res.json(driver);
});

router.post("/plow-drivers/:id/go-live", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(plowDriversTable).where(eq(plowDriversTable.id, id));
  if (!existing) { res.status(404).json({ error: "Driver not found" }); return; }

  if (existing.kycStatus !== "verified") {
    res.status(403).json({ error: "KYC must be verified before going live", kycStatus: existing.kycStatus });
    return;
  }

  const [driver] = await db.update(plowDriversTable).set({
    isLive: true,
  }).where(eq(plowDriversTable.id, id)).returning();
  res.json({ ...driver, message: "Driver is now LIVE" });
});

router.post("/plow-drivers/:id/go-offline", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [driver] = await db.update(plowDriversTable).set({
    isLive: false,
  }).where(eq(plowDriversTable.id, id)).returning();
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }
  res.json({ ...driver, message: "Driver is now OFFLINE" });
});

router.post("/plow-drivers/:id/location", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { lat, lng } = req.body;
  if (lat == null || lng == null) { res.status(400).json({ error: "lat and lng required" }); return; }

  const [driver] = await db.update(plowDriversTable).set({
    currentLat: lat,
    currentLng: lng,
    lastLocationAt: new Date(),
  }).where(eq(plowDriversTable.id, id)).returning();
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }
  res.json(driver);
});

router.post("/plow-drivers/:id/salt-update", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { saltInventory } = req.body;
  if (saltInventory == null) { res.status(400).json({ error: "saltInventory (percentage 0-100) required" }); return; }

  const clamped = Math.max(0, Math.min(100, saltInventory));
  const updateData: Record<string, unknown> = { saltInventory: clamped };

  if (clamped < 20) {
    const [existing] = await db.select().from(plowDriversTable).where(eq(plowDriversTable.id, id));
    if (existing && existing.currentLat != null && existing.currentLng != null) {
      const depots = await db.select().from(saltDepotsTable).where(eq(saltDepotsTable.isOpen, true));
      if (depots.length > 0) {
        let nearest = depots[0];
        let minDist = haversineKm(existing.currentLat!, existing.currentLng!, depots[0].lat, depots[0].lng);
        for (const d of depots.slice(1)) {
          const dist = haversineKm(existing.currentLat!, existing.currentLng!, d.lat, d.lng);
          if (dist < minDist) { nearest = d; minDist = dist; }
        }
        updateData.nearestDepotId = nearest.id;
      }
    }
  }

  const [driver] = await db.update(plowDriversTable).set(updateData).where(eq(plowDriversTable.id, id)).returning();
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }

  let nearestDepot = null;
  if (driver.nearestDepotId) {
    const [depot] = await db.select().from(saltDepotsTable).where(eq(saltDepotsTable.id, driver.nearestDepotId));
    nearestDepot = depot || null;
  }

  res.json({
    driver,
    saltAlert: clamped < 20 ? "LOW_SALT_WARNING" : clamped < 40 ? "SALT_ADVISORY" : "OK",
    nearestDepot,
    recommendation: clamped < 20
      ? `Refill immediately. ${nearestDepot ? `Nearest depot: ${nearestDepot.name} (${nearestDepot.address})` : "No depot found nearby."}`
      : null,
  });
});

router.post("/plow-drivers/:id/salt-check", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [driver] = await db.select().from(plowDriversTable).where(eq(plowDriversTable.id, id));
  if (!driver) { res.status(404).json({ error: "Driver not found" }); return; }

  if (driver.currentLat == null || driver.currentLng == null) {
    res.status(400).json({ error: "Driver location not set. Post to /plow-drivers/:id/location first." });
    return;
  }

  const depots = await db.select().from(saltDepotsTable).where(eq(saltDepotsTable.isOpen, true));
  const withDistance = depots.map(d => ({
    ...d,
    distanceKm: Math.round(haversineKm(driver.currentLat!, driver.currentLng!, d.lat, d.lng) * 10) / 10,
  })).sort((a, b) => a.distanceKm - b.distanceKm);

  const nearest = withDistance[0] || null;

  if (nearest) {
    await db.update(plowDriversTable).set({ nearestDepotId: nearest.id }).where(eq(plowDriversTable.id, id));
  }

  res.json({
    driverId: driver.id,
    saltInventory: driver.saltInventory,
    saltCapacityKg: driver.saltCapacityKg,
    remainingKg: Math.round(driver.saltCapacityKg * (driver.saltInventory / 100)),
    alert: driver.saltInventory < 20 ? "LOW_SALT_WARNING" : driver.saltInventory < 40 ? "SALT_ADVISORY" : "OK",
    nearestDepot: nearest,
    allDepots: withDistance.slice(0, 5),
  });
});

router.post("/plow-drivers/:id/reputation", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { action, jobId, details = "" } = req.body;
  if (!action) { res.status(400).json({ error: "action is required" }); return; }

  const actionDef = REPUTATION_ACTIONS[action];
  if (!actionDef) {
    res.status(400).json({
      error: `Unknown action: ${action}`,
      availableActions: Object.keys(REPUTATION_ACTIONS),
    });
    return;
  }

  const [existing] = await db.select().from(plowDriversTable).where(eq(plowDriversTable.id, id));
  if (!existing) { res.status(404).json({ error: "Driver not found" }); return; }

  await db.insert(reputationLedgerTable).values({
    driverId: id,
    action,
    points: actionDef.points,
    metric: actionDef.metric,
    details: details || actionDef.description,
    jobId: jobId || null,
  });

  const newScore = existing.reputationScore + actionDef.points;
  const newRank = calculateRank(newScore);

  const metricUpdates: Record<string, unknown> = {
    reputationScore: newScore,
    reputationRank: newRank,
  };

  if (actionDef.metric === "response_time" && action === "route_complete") {
    metricUpdates.totalJobs = existing.totalJobs + 1;
  }

  const [driver] = await db.update(plowDriversTable).set(metricUpdates).where(eq(plowDriversTable.id, id)).returning();

  const rankChanged = existing.reputationRank !== newRank;

  res.json({
    driver,
    awarded: { action, points: actionDef.points, metric: actionDef.metric, description: actionDef.description },
    rankUp: rankChanged ? { from: existing.reputationRank, to: newRank } : null,
  });
});

router.get("/plow-drivers/:id/reputation-history", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const ledger = await db.select().from(reputationLedgerTable)
    .where(eq(reputationLedgerTable.driverId, id))
    .orderBy(desc(reputationLedgerTable.createdAt))
    .limit(50);

  const [driver] = await db.select().from(plowDriversTable).where(eq(plowDriversTable.id, id));

  const byMetric: Record<string, number> = {};
  for (const entry of ledger) {
    byMetric[entry.metric] = (byMetric[entry.metric] || 0) + entry.points;
  }

  res.json({
    driverId: id,
    currentScore: driver?.reputationScore || 0,
    currentRank: driver?.reputationRank || "rookie",
    totalEntries: ledger.length,
    breakdown: byMetric,
    history: ledger,
  });
});

router.get("/salt-depots", async (_req, res): Promise<void> => {
  const depots = await db.select().from(saltDepotsTable);
  res.json(depots);
});

router.post("/salt-depots", async (req, res): Promise<void> => {
  const body = req.body;
  const [depot] = await db.insert(saltDepotsTable).values({
    name: body.name,
    address: body.address || "",
    lat: body.lat,
    lng: body.lng,
    region: body.region || "CA-BC",
    saltType: body.saltType || "rock_salt",
    saltTypes: body.saltTypes || [body.saltType || "rock_salt"],
    products: body.products || [],
    pricePerTonne: body.pricePerTonne || 120,
    operatingHours: body.operatingHours || "06:00-18:00",
    phone: body.phone || "",
    email: body.email || "",
    website: body.website || "",
    isOpen: body.isOpen !== false,
  }).returning();
  res.status(201).json(depot);
});

router.get("/salt-depots/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const [depot] = await db.select().from(saltDepotsTable).where(eq(saltDepotsTable.id, id));
  if (!depot) { res.status(404).json({ error: "Depot not found" }); return; }
  res.json(depot);
});

router.patch("/salt-depots/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const body = req.body;
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.website !== undefined) updateData.website = body.website;
  if (body.saltType !== undefined) updateData.saltType = body.saltType;
  if (body.saltTypes !== undefined) updateData.saltTypes = body.saltTypes;
  if (body.products !== undefined) updateData.products = body.products;
  if (body.pricePerTonne !== undefined) updateData.pricePerTonne = body.pricePerTonne;
  if (body.operatingHours !== undefined) updateData.operatingHours = body.operatingHours;
  if (body.isOpen !== undefined) updateData.isOpen = body.isOpen;
  if (body.activeDeal !== undefined) updateData.activeDeal = body.activeDeal;
  if (body.dealExpiresAt !== undefined) updateData.dealExpiresAt = body.dealExpiresAt ? new Date(body.dealExpiresAt) : null;
  if (body.adSlotEnabled !== undefined) updateData.adSlotEnabled = body.adSlotEnabled;
  if (body.adImageUrl !== undefined) updateData.adImageUrl = body.adImageUrl;
  if (body.adTargetUrl !== undefined) updateData.adTargetUrl = body.adTargetUrl;
  if (body.adExpiresAt !== undefined) updateData.adExpiresAt = body.adExpiresAt ? new Date(body.adExpiresAt) : null;

  const [depot] = await db.update(saltDepotsTable).set(updateData).where(eq(saltDepotsTable.id, id)).returning();
  if (!depot) { res.status(404).json({ error: "Depot not found" }); return; }
  res.json(depot);
});

router.post("/salt-depots/:id/claim", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { name, email, phone, website } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: "Supplier name and email are required to claim a listing" });
    return;
  }

  const [existing] = await db.select().from(saltDepotsTable).where(eq(saltDepotsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Depot not found" }); return; }
  if (existing.isClaimed) {
    res.status(409).json({ error: "This depot listing has already been claimed", claimedByName: existing.claimedByName });
    return;
  }

  const [depot] = await db.update(saltDepotsTable).set({
    isClaimed: true,
    claimedAt: new Date(),
    claimedByName: name,
    claimedByEmail: email,
    email: email,
    phone: phone || existing.phone,
    website: website || existing.website,
  }).where(eq(saltDepotsTable.id, id)).returning();

  res.json({
    message: `Depot "${depot.name}" successfully claimed by ${name}`,
    depot,
  });
});

router.post("/salt-depots/:id/deal", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const { deal, expiresAt } = req.body;
  if (!deal) { res.status(400).json({ error: "Deal text is required" }); return; }

  const [existing] = await db.select().from(saltDepotsTable).where(eq(saltDepotsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Depot not found" }); return; }
  if (!existing.isClaimed) { res.status(403).json({ error: "Only claimed depots can post deals. Claim this listing first." }); return; }

  const [depot] = await db.update(saltDepotsTable).set({
    activeDeal: deal,
    dealExpiresAt: expiresAt ? new Date(expiresAt) : null,
  }).where(eq(saltDepotsTable.id, id)).returning();

  res.json({
    message: `Deal posted for "${depot.name}"`,
    deal: depot.activeDeal,
    expiresAt: depot.dealExpiresAt,
  });
});

router.post("/salt-depots/seed", async (_req, res): Promise<void> => {
  const existing = await db.select().from(saltDepotsTable);
  if (existing.length > 0) {
    res.status(409).json({ error: "Depots already seeded", count: existing.length });
    return;
  }

  const depots = [
    {
      name: "Victoria Salt & Sand Yard", address: "1234 Store St, Victoria, BC", lat: 48.4284, lng: -123.3656, region: "CA-BC",
      saltType: "rock_salt", saltTypes: ["rock_salt", "treated_salt", "calcium_chloride", "sand_mix"],
      products: [
        { type: "Rock Salt (NaCl)", pricePerTonne: 115, unit: "tonne", minOrder: "0.5t", inStock: true },
        { type: "Treated Salt (Pre-wet)", pricePerTonne: 145, unit: "tonne", minOrder: "1t", inStock: true },
        { type: "Calcium Chloride Flakes", pricePerTonne: 320, unit: "tonne", minOrder: "0.25t", inStock: true },
        { type: "Sand/Salt Mix (4:1)", pricePerTonne: 85, unit: "tonne", minOrder: "1t", inStock: true },
      ],
      pricePerTonne: 115, operatingHours: "05:00-20:00", phone: "250-555-0201"
    },
    {
      name: "Langford Municipal Depot", address: "800 Goldstream Ave, Langford, BC", lat: 48.4497, lng: -123.5046, region: "CA-BC",
      saltType: "treated_salt", saltTypes: ["treated_salt", "brine_solution", "magnesium_chloride"],
      products: [
        { type: "Treated Salt (Pre-wet)", pricePerTonne: 135, unit: "tonne", minOrder: "0.5t", inStock: true },
        { type: "Brine Solution (23%)", pricePerTonne: 65, unit: "1000L", minOrder: "500L", inStock: true },
        { type: "Magnesium Chloride Liquid", pricePerTonne: 280, unit: "1000L", minOrder: "200L", inStock: true },
      ],
      pricePerTonne: 135, operatingHours: "06:00-18:00", phone: "250-555-0202"
    },
    {
      name: "Sidney Sand & Gravel", address: "2100 Henry Ave, Sidney, BC", lat: 48.6505, lng: -123.3987, region: "CA-BC",
      saltType: "rock_salt", saltTypes: ["rock_salt", "sand_mix", "gravel"],
      products: [
        { type: "Rock Salt (NaCl)", pricePerTonne: 125, unit: "tonne", minOrder: "1t", inStock: true },
        { type: "Sand/Salt Mix (3:1)", pricePerTonne: 75, unit: "tonne", minOrder: "2t", inStock: true },
        { type: "Winter Gravel (3/8\")", pricePerTonne: 55, unit: "tonne", minOrder: "2t", inStock: true },
      ],
      pricePerTonne: 125, operatingHours: "07:00-17:00", phone: "250-555-0203"
    },
    {
      name: "Nanaimo Bulk Materials", address: "500 Terminal Ave, Nanaimo, BC", lat: 49.1659, lng: -123.9401, region: "CA-BC",
      saltType: "brine_solution", saltTypes: ["brine_solution", "rock_salt", "calcium_chloride", "potassium_acetate"],
      products: [
        { type: "Brine Solution (23%)", pricePerTonne: 55, unit: "1000L", minOrder: "500L", inStock: true },
        { type: "Rock Salt (NaCl)", pricePerTonne: 110, unit: "tonne", minOrder: "1t", inStock: true },
        { type: "Calcium Chloride Liquid", pricePerTonne: 290, unit: "1000L", minOrder: "200L", inStock: true },
        { type: "Potassium Acetate (Eco)", pricePerTonne: 450, unit: "tonne", minOrder: "0.5t", inStock: false },
      ],
      pricePerTonne: 95, operatingHours: "06:00-19:00", phone: "250-555-0204"
    },
    {
      name: "Sooke Salt Supply", address: "6700 Sooke Rd, Sooke, BC", lat: 48.3745, lng: -123.7260, region: "CA-BC",
      saltType: "rock_salt", saltTypes: ["rock_salt", "treated_salt"],
      products: [
        { type: "Rock Salt (NaCl)", pricePerTonne: 140, unit: "tonne", minOrder: "0.5t", inStock: true },
        { type: "Treated Salt (Pre-wet)", pricePerTonne: 165, unit: "tonne", minOrder: "0.5t", inStock: true },
      ],
      pricePerTonne: 140, operatingHours: "07:00-16:00", phone: "250-555-0205"
    },
  ];

  await db.insert(saltDepotsTable).values(depots);
  res.status(201).json({ seeded: depots.length, depots: depots.map(d => d.name) });
});

export default router;
