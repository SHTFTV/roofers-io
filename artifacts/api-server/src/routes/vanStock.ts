import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, vanStockItemsTable, vanStockAuditsTable } from "@workspace/db";

const router: IRouter = Router();

const MASTER_PARTS_DICTIONARY: Record<string, {
  label: string;
  logicType: string;
  items: Array<{ sku: string; name: string; defaultMin: number; defaultMax: number; unitCost: number; specs?: Record<string, unknown>; faultMapping?: string }>;
}> = {
  electrical: {
    label: "Electrical / Controls",
    logicType: "text_recognition",
    items: [
      { sku: "CAP-35-5", name: "35/5 Capacitor", defaultMin: 2, defaultMax: 6, unitCost: 18.50, specs: { microfarad: "35/5", voltage: "440V" }, faultMapping: "Failed_Capacitor" },
      { sku: "CAP-45-5", name: "45/5 Capacitor", defaultMin: 2, defaultMax: 6, unitCost: 22.00, specs: { microfarad: "45/5", voltage: "440V" }, faultMapping: "Failed_Capacitor" },
      { sku: "CAP-60-5", name: "60/5 Capacitor", defaultMin: 1, defaultMax: 4, unitCost: 28.00, specs: { microfarad: "60/5", voltage: "440V" }, faultMapping: "Failed_Capacitor" },
      { sku: "CONT-SP-30", name: "Single Pole Contactor 30A", defaultMin: 2, defaultMax: 5, unitCost: 14.00, specs: { poles: 1, amps: 30 }, faultMapping: "Failed_Contactor" },
      { sku: "CONT-DP-40", name: "Double Pole Contactor 40A", defaultMin: 1, defaultMax: 3, unitCost: 22.00, specs: { poles: 2, amps: 40 }, faultMapping: "Failed_Contactor" },
      { sku: "RELAY-24V", name: "24V Relay DPDT", defaultMin: 2, defaultMax: 6, unitCost: 12.00, specs: { voltage: "24V", type: "DPDT" }, faultMapping: "Failed_Relay" },
      { sku: "XFMR-40VA", name: "40VA Transformer 120/24V", defaultMin: 1, defaultMax: 3, unitCost: 35.00, specs: { va: 40, primary: "120V", secondary: "24V" }, faultMapping: "Failed_Transformer" },
      { sku: "BOARD-UNIV", name: "Universal Control Board", defaultMin: 1, defaultMax: 2, unitCost: 145.00, faultMapping: "Failed_Board" },
    ],
  },
  refrigeration: {
    label: "Refrigeration / Brazing",
    logicType: "shape_detection",
    items: [
      { sku: "TXV-3T", name: "TXV Valve 3-Ton R410A", defaultMin: 1, defaultMax: 2, unitCost: 85.00, specs: { tonnage: 3, refrigerant: "R410A" }, faultMapping: "Failed_TXV" },
      { sku: "TXV-5T", name: "TXV Valve 5-Ton R410A", defaultMin: 1, defaultMax: 2, unitCost: 110.00, specs: { tonnage: 5, refrigerant: "R410A" }, faultMapping: "Failed_TXV" },
      { sku: "FD-083", name: 'Filter Drier 3/8"', defaultMin: 2, defaultMax: 6, unitCost: 15.00, faultMapping: "Restricted_Drier" },
      { sku: "FD-084", name: 'Filter Drier 1/2"', defaultMin: 2, defaultMax: 6, unitCost: 18.00, faultMapping: "Restricted_Drier" },
      { sku: "SG-3-8", name: 'Sight Glass 3/8"', defaultMin: 1, defaultMax: 3, unitCost: 22.00 },
      { sku: "SOL-24V", name: "Solenoid Valve 24V", defaultMin: 1, defaultMax: 3, unitCost: 45.00, faultMapping: "Failed_Solenoid" },
      { sku: "SV-R410A", name: "Schrader Valve Core R410A", defaultMin: 4, defaultMax: 12, unitCost: 2.50 },
    ],
  },
  gas: {
    label: "Gas Train",
    logicType: "part_number_sync",
    items: [
      { sku: "GV-24V-STD", name: "24V Gas Valve Standard", defaultMin: 1, defaultMax: 2, unitCost: 95.00, faultMapping: "Failed_Gas_Valve" },
      { sku: "GV-24V-2ST", name: "24V Gas Valve Two-Stage", defaultMin: 1, defaultMax: 2, unitCost: 135.00, faultMapping: "Failed_Gas_Valve" },
      { sku: "HSI-UNIV", name: "Hot Surface Igniter Universal", defaultMin: 2, defaultMax: 5, unitCost: 28.00, faultMapping: "Failed_Igniter" },
      { sku: "HSI-NORTON", name: "Hot Surface Igniter Norton 271", defaultMin: 1, defaultMax: 3, unitCost: 32.00, faultMapping: "Failed_Igniter" },
      { sku: "FLAME-ROD", name: "Flame Rod / Sensor", defaultMin: 2, defaultMax: 6, unitCost: 12.00, faultMapping: "Weak_Flame_Signal" },
      { sku: "TC-30MV", name: 'Thermocouple 30mV 24"', defaultMin: 2, defaultMax: 6, unitCost: 8.00, faultMapping: "Failed_Thermocouple" },
      { sku: "TC-ADAPT", name: "Thermocouple Adapter Kit", defaultMin: 1, defaultMax: 3, unitCost: 6.50 },
    ],
  },
  plumbing: {
    label: "Plumbing / Condensate",
    logicType: "volume_counting",
    items: [
      { sku: "PTRAP-3-4", name: '3/4" P-Trap PVC', defaultMin: 2, defaultMax: 6, unitCost: 4.50 },
      { sku: "CPUMP-MINI", name: "Condensate Pump Mini", defaultMin: 1, defaultMax: 2, unitCost: 65.00, faultMapping: "Failed_Condensate_Pump" },
      { sku: "PVC-90-3-4", name: '3/4" PVC 90° Elbow', defaultMin: 6, defaultMax: 20, unitCost: 1.25 },
      { sku: "PVC-TEE-3-4", name: '3/4" PVC Tee', defaultMin: 4, defaultMax: 12, unitCost: 1.50 },
      { sku: "PVC-COUP-3-4", name: '3/4" PVC Coupler', defaultMin: 4, defaultMax: 12, unitCost: 0.85 },
      { sku: "DRAIN-TAB", name: "Condensate Drain Tablets (6pk)", defaultMin: 2, defaultMax: 6, unitCost: 8.00 },
    ],
  },
  duct: {
    label: "Duct / Airside",
    logicType: "consumables_audit",
    items: [
      { sku: "TAPE-FOIL-2", name: 'Silver Foil Tape 2"', defaultMin: 3, defaultMax: 8, unitCost: 9.50 },
      { sku: "TAPE-MASTIC", name: "Mastic Sealant Tube", defaultMin: 2, defaultMax: 6, unitCost: 7.00 },
      { sku: "ZIP-6", name: '6" UV Zip Ties (100pk)', defaultMin: 2, defaultMax: 5, unitCost: 6.00 },
      { sku: "ZIP-11", name: '11" UV Zip Ties (100pk)', defaultMin: 2, defaultMax: 5, unitCost: 8.00 },
      { sku: "REG-4X10", name: '4x10" Register White', defaultMin: 2, defaultMax: 6, unitCost: 12.00 },
      { sku: "REG-6X10", name: '6x10" Register White', defaultMin: 2, defaultMax: 6, unitCost: 14.00 },
      { sku: "DAMPER-MTR", name: "Damper Motor 24V", defaultMin: 1, defaultMax: 2, unitCost: 55.00, faultMapping: "Failed_Damper" },
    ],
  },
  fittings: {
    label: "Fittings & Hardware",
    logicType: "weight_volume",
    items: [
      { sku: "FLARE-3-8", name: '3/8" Copper Flare Nut', defaultMin: 6, defaultMax: 20, unitCost: 2.00 },
      { sku: "FLARE-1-2", name: '1/2" Copper Flare Nut', defaultMin: 6, defaultMax: 20, unitCost: 2.50 },
      { sku: "FLARE-5-8", name: '5/8" Copper Flare Nut', defaultMin: 4, defaultMax: 12, unitCost: 3.00 },
      { sku: "FLARE-3-4", name: '3/4" Copper Flare Nut', defaultMin: 4, defaultMax: 12, unitCost: 3.50 },
      { sku: "WASHER-ASSORT", name: "Washer Assortment Kit", defaultMin: 1, defaultMax: 2, unitCost: 15.00 },
      { sku: "SCREW-HEX-KIT", name: "Hex Screw Kit HVAC", defaultMin: 1, defaultMax: 3, unitCost: 12.00 },
      { sku: "WIRENUT-ASSORT", name: "Wire Nut Assortment", defaultMin: 2, defaultMax: 5, unitCost: 8.00 },
    ],
  },
  tools: {
    label: "Tools & Equipment",
    logicType: "asset_tracking",
    items: [
      { sku: "VACUUM-2STG", name: "Vacuum Pump 2-Stage", defaultMin: 1, defaultMax: 1, unitCost: 350.00 },
      { sku: "RECOVERY-UNIT", name: "Recovery Machine", defaultMin: 1, defaultMax: 1, unitCost: 1200.00 },
      { sku: "MANIFOLD-DIG", name: "Digital Manifold Gauges", defaultMin: 1, defaultMax: 1, unitCost: 450.00 },
      { sku: "LEAK-DET", name: "Refrigerant Leak Detector", defaultMin: 1, defaultMax: 1, unitCost: 185.00 },
      { sku: "TORCH-TURBO", name: "Turbo Torch Kit", defaultMin: 1, defaultMax: 1, unitCost: 120.00 },
      { sku: "FLARE-TOOL", name: "Flaring Tool Set", defaultMin: 1, defaultMax: 1, unitCost: 85.00 },
      { sku: "MULTIMETER", name: "Digital Multimeter HVAC", defaultMin: 1, defaultMax: 1, unitCost: 95.00 },
    ],
  },
};

const FAULT_TO_PARTS: Record<string, { category: string; skus: string[]; repairAction: string }> = {};
for (const [cat, config] of Object.entries(MASTER_PARTS_DICTIONARY)) {
  for (const item of config.items) {
    if (item.faultMapping) {
      if (!FAULT_TO_PARTS[item.faultMapping]) {
        FAULT_TO_PARTS[item.faultMapping] = { category: cat, skus: [], repairAction: `Replace ${item.name}` };
      }
      FAULT_TO_PARTS[item.faultMapping].skus.push(item.sku);
    }
  }
}

router.get("/van-stock/master-parts", (_req, res): void => {
  const categories = Object.entries(MASTER_PARTS_DICTIONARY).map(([key, config]) => ({
    key,
    label: config.label,
    logicType: config.logicType,
    itemCount: config.items.length,
    items: config.items.map(i => ({
      sku: i.sku,
      name: i.name,
      defaultMin: i.defaultMin,
      defaultMax: i.defaultMax,
      unitCost: i.unitCost,
      specs: i.specs || null,
      faultMapping: i.faultMapping || null,
    })),
  }));
  const totalParts = categories.reduce((sum, c) => sum + c.itemCount, 0);
  res.json({ totalParts, categories });
});

router.get("/van-stock/categories", (_req, res): void => {
  const categories: Record<string, string[]> = {};
  for (const [key, config] of Object.entries(MASTER_PARTS_DICTIONARY)) {
    categories[key] = config.items.map(i => i.sku);
  }
  res.json({ categories });
});

router.get("/van-stock/items", async (req, res): Promise<void> => {
  const vanId = (req.query.vanId as string) || "Van_1";
  const category = req.query.category as string | undefined;

  let items;
  if (category) {
    items = await db.select().from(vanStockItemsTable)
      .where(and(eq(vanStockItemsTable.vanId, vanId), eq(vanStockItemsTable.category, category)));
  } else {
    items = await db.select().from(vanStockItemsTable)
      .where(eq(vanStockItemsTable.vanId, vanId));
  }

  const lowStock = items.filter(i => i.currentQty < i.minQty);
  const totalValue = items.reduce((sum, i) => sum + (i.currentQty * i.unitCost), 0);

  res.json({
    vanId,
    itemCount: items.length,
    lowStockCount: lowStock.length,
    totalInventoryValue: Math.round(totalValue * 100) / 100,
    items,
    lowStockItems: lowStock,
  });
});

router.post("/van-stock/items", async (req, res): Promise<void> => {
  const body = req.body;
  const [item] = await db.insert(vanStockItemsTable).values({
    sku: body.sku,
    name: body.name,
    category: body.category,
    subcategory: body.subcategory || "",
    logicType: body.logicType || "count",
    vanId: body.vanId || "Van_1",
    drawerLocation: body.drawerLocation || "",
    currentQty: body.currentQty || 0,
    minQty: body.minQty || 1,
    maxQty: body.maxQty || 10,
    unitCost: body.unitCost || 0,
    supplier: body.supplier || "",
    partNumber: body.partNumber || "",
    specs: body.specs || {},
    faultMapping: body.faultMapping || "",
  }).returning();
  res.status(201).json(item);
});

router.patch("/van-stock/items/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = req.body;
  const updateData: Record<string, unknown> = {};
  for (const key of ["sku", "name", "category", "subcategory", "logicType", "vanId", "drawerLocation", "supplier", "partNumber", "faultMapping"]) {
    if (body[key] !== undefined) updateData[key] = body[key];
  }
  for (const key of ["currentQty", "minQty", "maxQty", "unitCost"]) {
    if (body[key] !== undefined) updateData[key] = body[key];
  }
  if (body.specs !== undefined) updateData.specs = body.specs;

  const [item] = await db.update(vanStockItemsTable).set(updateData).where(eq(vanStockItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(item);
});

router.delete("/van-stock/items/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [item] = await db.delete(vanStockItemsTable).where(eq(vanStockItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.sendStatus(204);
});

router.post("/van-stock/seed", async (req, res): Promise<void> => {
  const vanId = req.body.vanId || "Van_1";

  const existing = await db.select().from(vanStockItemsTable).where(eq(vanStockItemsTable.vanId, vanId));
  if (existing.length > 0) {
    res.status(409).json({ error: "Van already has inventory. Delete existing items first or use a different vanId.", existingCount: existing.length });
    return;
  }

  const toInsert: Array<Record<string, unknown>> = [];
  for (const [cat, config] of Object.entries(MASTER_PARTS_DICTIONARY)) {
    for (const item of config.items) {
      const drawerMap: Record<string, string> = {
        electrical: "Shelf_A_Drawer_1",
        refrigeration: "Shelf_A_Drawer_2",
        gas: "Shelf_B_Drawer_1",
        plumbing: "Shelf_B_Drawer_2",
        duct: "Shelf_C_Drawer_1",
        fittings: "Shelf_C_Drawer_2",
        tools: "Shelf_D_Top",
      };
      toInsert.push({
        sku: item.sku,
        name: item.name,
        category: cat,
        subcategory: config.label,
        logicType: config.logicType,
        vanId,
        drawerLocation: drawerMap[cat] || "",
        currentQty: Math.round((item.defaultMin + item.defaultMax) / 2),
        minQty: item.defaultMin,
        maxQty: item.defaultMax,
        unitCost: item.unitCost,
        supplier: "",
        partNumber: "",
        specs: item.specs || {},
        faultMapping: item.faultMapping || "",
      });
    }
  }

  await db.insert(vanStockItemsTable).values(toInsert as any);
  res.status(201).json({
    vanId,
    itemsSeeded: toInsert.length,
    categories: Object.keys(MASTER_PARTS_DICTIONARY).length,
    message: `Seeded ${toInsert.length} parts across ${Object.keys(MASTER_PARTS_DICTIONARY).length} categories for ${vanId}`,
  });
});

router.post("/van-stock/audit", async (req, res): Promise<void> => {
  const { vanId = "Van_1", drawerLocation, category, results: scanResults, auditType = "drawer_scan", notes = "", auditedBy = "" } = req.body;

  if (!scanResults || !Array.isArray(scanResults)) {
    res.status(400).json({ error: "results array is required" });
    return;
  }

  const inventory = await db.select().from(vanStockItemsTable).where(eq(vanStockItemsTable.vanId, vanId));
  const inventoryMap = new Map(inventory.map(i => [i.sku, i]));

  const auditResults: Array<{
    sku: string;
    name: string;
    expectedQty: number;
    detectedQty: number;
    status: string;
    logicUsed: string;
  }> = [];

  let discrepancies = 0;

  for (const scanned of scanResults) {
    const existing = inventoryMap.get(scanned.sku || scanned.id);
    if (!existing) {
      auditResults.push({
        sku: scanned.sku || scanned.id,
        name: scanned.name || "Unknown",
        expectedQty: 0,
        detectedQty: scanned.detectedQty || scanned.count || scanned.estimatedVolume || 0,
        status: "UNREGISTERED",
        logicUsed: "none",
      });
      discrepancies++;
      continue;
    }

    const detectedQty = scanned.detectedQty || scanned.count || scanned.estimatedVolume || 0;
    const diff = Math.abs(existing.currentQty - detectedQty);
    let status: string;

    if (detectedQty < existing.minQty) {
      status = "LOW_STOCK";
      discrepancies++;
    } else if (diff > 1) {
      status = "DISCREPANCY";
      discrepancies++;
    } else {
      status = "OK";
    }

    auditResults.push({
      sku: existing.sku,
      name: existing.name,
      expectedQty: existing.currentQty,
      detectedQty,
      status,
      logicUsed: existing.logicType,
    });

    await db.update(vanStockItemsTable)
      .set({ currentQty: detectedQty, lastAuditedAt: new Date() })
      .where(eq(vanStockItemsTable.id, existing.id));
  }

  const [audit] = await db.insert(vanStockAuditsTable).values({
    vanId,
    auditType,
    drawerLocation: drawerLocation || "",
    category: category || "",
    itemsScanned: scanResults.length,
    discrepancies,
    results: auditResults,
    notes,
    auditedBy,
  }).returning();

  res.status(201).json({
    auditId: audit.id,
    vanId,
    itemsScanned: scanResults.length,
    discrepancies,
    passRate: scanResults.length > 0
      ? `${((1 - discrepancies / scanResults.length) * 100).toFixed(1)}%`
      : "N/A",
    results: auditResults,
    reorderRequired: auditResults.filter(r => r.status === "LOW_STOCK").map(r => ({
      sku: r.sku,
      name: r.name,
      currentQty: r.detectedQty,
    })),
  });
});

router.get("/van-stock/audits", async (req, res): Promise<void> => {
  const vanId = (req.query.vanId as string) || "Van_1";
  const audits = await db.select().from(vanStockAuditsTable)
    .where(eq(vanStockAuditsTable.vanId, vanId));
  audits.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(audits);
});

router.post("/van-stock/diagnose", async (req, res): Promise<void> => {
  const { fault, vanId = "Van_1" } = req.body;

  if (!fault) {
    res.status(400).json({ error: "fault code is required" });
    return;
  }

  const mapping = FAULT_TO_PARTS[fault];
  if (!mapping) {
    res.status(404).json({
      error: `Unknown fault code: ${fault}`,
      availableFaults: Object.keys(FAULT_TO_PARTS),
    });
    return;
  }

  const inventory = await db.select().from(vanStockItemsTable)
    .where(and(eq(vanStockItemsTable.vanId, vanId), eq(vanStockItemsTable.category, mapping.category)));
  const inventoryMap = new Map(inventory.map(i => [i.sku, i]));

  const parts = mapping.skus.map(sku => {
    const masterItem = MASTER_PARTS_DICTIONARY[mapping.category]?.items.find(i => i.sku === sku);
    const vanItem = inventoryMap.get(sku);

    return {
      sku,
      name: masterItem?.name || "Unknown",
      category: mapping.category,
      inStock: vanItem ? vanItem.currentQty > 0 : false,
      currentQty: vanItem?.currentQty || 0,
      drawerLocation: vanItem?.drawerLocation || null,
      unitCost: masterItem?.unitCost || 0,
      stockStatus: vanItem && vanItem.currentQty > 0
        ? "READY_IN_VAN"
        : "ORDER_REQUIRED_FROM_SUPPLY_HOUSE",
    };
  });

  const anyInStock = parts.some(p => p.inStock);
  const bestMatch = parts.find(p => p.inStock) || parts[0];

  res.json({
    fault,
    repairAction: mapping.repairAction,
    overallStatus: anyInStock ? "PARTS_AVAILABLE" : "ORDER_REQUIRED",
    bestMatch: {
      sku: bestMatch.sku,
      name: bestMatch.name,
      stockStatus: bestMatch.stockStatus,
      location: bestMatch.drawerLocation,
    },
    allOptions: parts,
    suggestedSuppliers: anyInStock ? [] : [
      "Johnstone Supply",
      "Ferguson",
      "Wolseley",
      "Local Supply House",
    ],
  });
});

router.get("/van-stock/fault-codes", (_req, res): void => {
  const faults = Object.entries(FAULT_TO_PARTS).map(([code, mapping]) => ({
    code,
    category: mapping.category,
    repairAction: mapping.repairAction,
    partCount: mapping.skus.length,
    skus: mapping.skus,
  }));
  res.json({ totalFaults: faults.length, faults });
});

export default router;
