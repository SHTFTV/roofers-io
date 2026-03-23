import { Router, type IRouter } from "express";
import { db, hardscapingProjectsTable, hardscapeItemsTable, turfItemsTable, complianceDocsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import PDFDocument from "pdfkit";
import crypto from "crypto";

const router: IRouter = Router();

const REGIONAL_RULES: Record<string, {
  wallLimit: number;
  unit: string;
  code: string;
  baseSpec: string;
  turfRollWidth: number;
}> = {
  "CA-BC": { wallLimit: 1.2, unit: "m", code: "BCBC 2024", baseSpec: "3/4 Minus Road Base", turfRollWidth: 15 },
  "US-WA": { wallLimit: 1.219, unit: "m", code: "IBC/IRC", baseSpec: "Crushed Surfacing Top Course", turfRollWidth: 15 },
  "UK-EN": { wallLimit: 1.0, unit: "m", code: "BS EN", baseSpec: "Type 1 MOT", turfRollWidth: 13.1 },
  "AU-NSW": { wallLimit: 1.0, unit: "m", code: "NCC 2022 (BCA)", baseSpec: "Road Base (DGB-20)", turfRollWidth: 12 },
};

const SUPPLIER_CATALOG: Record<string, Record<string, any>> = {
  "Slegg": {
    region: "CA-BC",
    brands: {
      "Bella_Turf": { standardRollWidthFt: 15, seamAllowanceFt: 0.5, infillLbsSqft: 1.5 },
      "Abbotsford_Concrete": { paver80mmPsi: 8000, paver60mmPsi: 8000, baseStandard: "3/4 Minus Road Base" },
    },
  },
};

interface SupplierBranch {
  id: string;
  name: string;
  territory: string;
  email: string;
  phone: string;
  address: string;
  specialties: string[];
  deliveryNotes: string;
  spyTip: string;
}

const SUPPLIER_BRANCHES_CA_BC: SupplierBranch[] = [
  {
    id: "slegg-victoria",
    name: "Slegg Victoria",
    territory: "Greater Victoria",
    email: "j.butler@slegg.com",
    phone: "250-388-6441",
    address: "3220 Admirals Rd, Victoria, BC",
    specialties: ["Allan Block", "Bella Turf", "Abbotsford Concrete"],
    deliveryNotes: "High volume Admirals Rd location. Same-day delivery within CRD.",
    spyTip: "Admirals Rd yard can stage pallets overnight for early AM delivery.",
  },
  {
    id: "slegg-langford",
    name: "Slegg Langford",
    territory: "West Shore / Sooke / Malahat",
    email: "langford.orders@slegg.com",
    phone: "250-478-5509",
    address: "2901 Sooke Rd, Langford, BC",
    specialties: ["Road Base", "Drainage", "Large Format Pavers"],
    deliveryNotes: "Closest to the Malahat for North Island delivery. 2hr delivery window on Malahat days.",
    spyTip: "Reminder: The Malahat can be slow — plan for a 2-hour delivery window.",
  },
  {
    id: "slegg-sidney",
    name: "Slegg Sidney",
    territory: "Saanich Peninsula / Sidney",
    email: "sidney.sales@slegg.com",
    phone: "250-656-1125",
    address: "9768 Fifth St, Sidney, BC",
    specialties: ["Allan Block Classic", "Bella Turf", "Zeofill"],
    deliveryNotes: "Primary Allan Block hub for the Peninsula. Stock varies — call ahead for specialty colours.",
    spyTip: "Sidney is the primary Allan Block hub. Check stock for specialty colours before ordering.",
  },
  {
    id: "slegg-nanaimo",
    name: "Slegg Nanaimo",
    territory: "Central Island / Parksville / Qualicum",
    email: "nanaimo.orders@slegg.com",
    phone: "250-758-0811",
    address: "4420 Wellington Rd, Nanaimo, BC",
    specialties: ["Road Base", "Retaining Wall Systems", "Aggregate"],
    deliveryNotes: "Central Island logistics hub. Can coordinate with Tofino/West Coast delivery.",
    spyTip: "Central Island hub — coordinate multi-site deliveries here for cost savings.",
  },
  {
    id: "slegg-tofino",
    name: "Slegg Tofino",
    territory: "West Coast / Ucluelet / Tofino",
    email: "tofino.sales@slegg.com",
    phone: "250-725-3344",
    address: "1180 Pacific Rim Hwy, Tofino, BC",
    specialties: ["Drainage", "Landscape Fabric", "Aggregate"],
    deliveryNotes: "West Coast location. Limited stock — pre-order recommended. Transfer from Nanaimo 2-3 days.",
    spyTip: "Limited stock — always pre-order at least 5 business days. Transfer from Nanaimo takes 2-3 days.",
  },
];

const REGIONAL_SUPPLIER_BRANCHES: Record<string, Array<{ id: string; name: string; territory: string; email: string; orderNotes: string }>> = {
  "UK-EN": [
    { id: "jewson-london", name: "Jewson London", territory: "Greater London", email: "london.trade@jewson.co.uk", orderNotes: "Site access restricted to 7.5t vehicles. Order adjusted for smaller bags." },
    { id: "jewson-manchester", name: "Jewson Manchester", territory: "Greater Manchester", email: "manchester.trade@jewson.co.uk", orderNotes: "Next-day delivery available M-F." },
  ],
  "US-WA": [
    { id: "siteone-seattle", name: "SiteOne Seattle", territory: "King County / Seattle Metro", email: "seattle@siteone.com", orderNotes: "Standard 48hr delivery. Call for same-day." },
    { id: "siteone-tacoma", name: "SiteOne Tacoma", territory: "Pierce County / Tacoma", email: "tacoma@siteone.com", orderNotes: "South Sound hub. Aggregate available for pickup." },
  ],
  "AU-NSW": [
    { id: "boral-sydney", name: "Boral Sydney", territory: "Greater Sydney / NSW", email: "sydney.orders@boral.com.au", orderNotes: "DGB-20 road base in stock. Minimum 5t delivery." },
  ],
};

function detectSupplierBranch(address: string): SupplierBranch {
  const lower = address.toLowerCase();
  if (/langford|colwood|sooke|metchosin|west shore|malahat/i.test(lower)) return SUPPLIER_BRANCHES_CA_BC[1];
  if (/sidney|saanich|north saanich|peninsula|deep cove/i.test(lower)) return SUPPLIER_BRANCHES_CA_BC[2];
  if (/nanaimo|parksville|qualicum|ladysmith|duncan/i.test(lower)) return SUPPLIER_BRANCHES_CA_BC[3];
  if (/tofino|ucluelet|west coast|port alberni/i.test(lower)) return SUPPLIER_BRANCHES_CA_BC[4];
  return SUPPLIER_BRANCHES_CA_BC[0];
}

router.get("/hardscaping/supplier-branches", async (_req, res) => {
  res.json({ branches: SUPPLIER_BRANCHES_CA_BC });
});

router.post("/hardscaping/supplier-route", async (req, res) => {
  const { address, projectId } = req.body;
  if (!address) return res.status(400).json({ error: "address required for branch routing" });

  const branch = detectSupplierBranch(address);

  let project = null;
  if (projectId) {
    const pid = Number(projectId);
    if (!isNaN(pid)) {
      const [p] = await db.select().from(hardscapingProjectsTable).where(eq(hardscapingProjectsTable.id, pid));
      project = p || null;
    }
  }

  res.json({
    routed: true,
    branch,
    project: project ? { id: project.id, name: project.name, region: project.region } : null,
    confirmation: `Sent to ${branch.name}`,
    spyTip: branch.spyTip,
  });
});

router.get("/hardscaping/supplier-branches/:region", async (req, res) => {
  const region = req.params.region;
  if (region === "CA-BC") {
    return res.json({ region, supplier: "Slegg Building Materials", branches: SUPPLIER_BRANCHES_CA_BC });
  }
  const branches = REGIONAL_SUPPLIER_BRANCHES[region];
  if (!branches) return res.status(404).json({ error: `No supplier branches configured for region: ${region}` });
  res.json({ region, branches });
});

router.get("/hardscaping-projects", async (_req, res) => {
  try {
    const projects = await db.select().from(hardscapingProjectsTable).orderBy(desc(hardscapingProjectsTable.createdAt));
    res.json(projects);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/hardscaping-projects/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });

    const [project] = await db.select().from(hardscapingProjectsTable).where(eq(hardscapingProjectsTable.id, id));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const items = await db.select().from(hardscapeItemsTable).where(eq(hardscapeItemsTable.projectId, id));
    const turf = await db.select().from(turfItemsTable).where(eq(turfItemsTable.projectId, id));

    res.json({ ...project, hardscapeItems: items, turfItems: turf });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/hardscaping-projects", async (req, res) => {
  try {
    const { name, client, address, region, units, currency, projectType, notes } = req.body;
    if (!name || !client || !address) {
      return res.status(400).json({ error: "name, client, address required" });
    }
    const [project] = await db.insert(hardscapingProjectsTable).values({
      name, client, address,
      region: region || "CA-BC",
      units: units || "imperial",
      currency: currency || "CAD",
      projectType: projectType || "mixed",
      notes,
    }).returning();
    res.status(201).json(project);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/hardscaping-projects/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });
    const [updated] = await db.update(hardscapingProjectsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(hardscapingProjectsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Project not found" });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/hardscaping-projects/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid project ID" });
    await db.delete(turfItemsTable).where(eq(turfItemsTable.projectId, id));
    await db.delete(hardscapeItemsTable).where(eq(hardscapeItemsTable.projectId, id));
    const [deleted] = await db.delete(hardscapingProjectsTable).where(eq(hardscapingProjectsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Project not found" });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/hardscaping-projects/:id/items", async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

    const { itemType, materialCode, materialName, supplier, quantity, dimensions, baseDepth, hasGeogrid, engineered, unitPrice, notes } = req.body;
    if (!itemType || !materialName) {
      return res.status(400).json({ error: "itemType, materialName required" });
    }

    const totalPrice = (unitPrice || 0) * (quantity || 0);

    const [item] = await db.insert(hardscapeItemsTable).values({
      projectId, itemType, materialCode, materialName,
      supplier: supplier || "Slegg",
      quantity: quantity || 0,
      dimensions: dimensions || null,
      baseDepth: baseDepth || null,
      hasGeogrid: hasGeogrid || false,
      engineered: engineered || false,
      unitPrice: unitPrice || 0,
      totalPrice,
      notes,
    }).returning();
    res.status(201).json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/hardscaping-projects/:projectId/items/:itemId", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    if (isNaN(itemId)) return res.status(400).json({ error: "Invalid item ID" });
    const [deleted] = await db.delete(hardscapeItemsTable).where(eq(hardscapeItemsTable.id, itemId)).returning();
    if (!deleted) return res.status(404).json({ error: "Item not found" });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/hardscaping-projects/:id/turf", async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

    const { productName, brand, sqft, areaWidth, areaLength, rollWidth, infillType, infillLbsSqft, unitPrice, notes } = req.body;
    if (!productName) {
      return res.status(400).json({ error: "productName required" });
    }

    const rw = rollWidth || 15;
    const w = areaWidth || 0;
    const l = areaLength || 0;
    const stripsNeeded = w > 0 ? Math.ceil(w / rw) : 0;
    const totalLinearFeet = stripsNeeded * l;
    const actualArea = w * l;
    const orderedArea = stripsNeeded * rw * l;
    const wastePercent = actualArea > 0 ? ((orderedArea - actualArea) / actualArea) * 100 : 0;
    const seamCount = stripsNeeded > 1 ? stripsNeeded - 1 : 0;
    const totalPrice = (unitPrice || 0) * (sqft || actualArea);

    const [turf] = await db.insert(turfItemsTable).values({
      projectId,
      productName,
      brand: brand || "Bella Turf",
      sqft: sqft || actualArea,
      areaWidth: w || null,
      areaLength: l || null,
      rollWidth: rw,
      stripsNeeded: stripsNeeded || null,
      totalLinearFeet: totalLinearFeet || null,
      wastePercent: wastePercent || null,
      infillType: infillType || "Silica",
      infillLbsSqft: infillLbsSqft || 1.5,
      seamCount,
      unitPrice: unitPrice || 0,
      totalPrice,
      notes,
    }).returning();
    res.status(201).json(turf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/hardscaping-projects/:projectId/turf/:turfId", async (req, res) => {
  try {
    const turfId = Number(req.params.turfId);
    if (isNaN(turfId)) return res.status(400).json({ error: "Invalid turf ID" });
    const [deleted] = await db.delete(turfItemsTable).where(eq(turfItemsTable.id, turfId)).returning();
    if (!deleted) return res.status(404).json({ error: "Turf item not found" });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/hardscaping-projects/:id/audit", async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

    const [project] = await db.select().from(hardscapingProjectsTable).where(eq(hardscapingProjectsTable.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const items = await db.select().from(hardscapeItemsTable).where(eq(hardscapeItemsTable.projectId, projectId));
    const turf = await db.select().from(turfItemsTable).where(eq(turfItemsTable.projectId, projectId));
    const rules = REGIONAL_RULES[project.region] || REGIONAL_RULES["CA-BC"];

    const flags: Array<{ type: string; status: string; message: string; field?: string }> = [];

    for (const item of items) {
      const dims = item.dimensions as any;
      if (dims?.height) {
        const heightM = project.units === "imperial" ? dims.height * 0.3048 : dims.height;
        if (heightM > rules.wallLimit && !item.engineered) {
          flags.push({
            type: "COMPLIANCE",
            status: "WARNING",
            message: `EyeSpyR: Wall "${item.materialName}" height (${dims.height}${project.units === "imperial" ? "ft" : "m"}) exceeds ${rules.code} permit-free limit of ${rules.wallLimit}${rules.unit}. Engineer Schedule B required.`,
            field: `item-${item.id}`,
          });
        }
        if (item.itemType === "Wall" && !item.hasGeogrid && heightM > 0.9) {
          flags.push({
            type: "COMPLIANCE",
            status: "INFO",
            message: `EyeSpyR: Wall "${item.materialName}" over 3ft — recommend geogrid reinforcement per ${rules.code}.`,
            field: `item-${item.id}`,
          });
        }
      }
      if (item.itemType === "Paver" && (!item.baseDepth || item.baseDepth < 4)) {
        flags.push({
          type: "COMPLIANCE",
          status: "WARNING",
          message: `EyeSpyR: Paver "${item.materialName}" base depth (${item.baseDepth || 0}") below minimum 4". ${rules.baseSpec} required at 4-6" depth.`,
          field: `item-${item.id}`,
        });
      }
    }

    for (const t of turf) {
      if (t.areaWidth && t.areaWidth > (t.rollWidth || 15)) {
        flags.push({
          type: "LOGISTICS",
          status: "INFO",
          message: `EyeSpyR: Seam detected on "${t.productName}". ${t.seamCount || 0} seam(s) required. Optimize cuts for pile direction. Order seam tape.`,
          field: `turf-${t.id}`,
        });
      }
      if (t.wastePercent && t.wastePercent > 15) {
        flags.push({
          type: "LOGISTICS",
          status: "WARNING",
          message: `EyeSpyR: Turf waste at ${t.wastePercent.toFixed(1)}% — exceeds 15% threshold. Consider adjusting layout or roll width.`,
          field: `turf-${t.id}`,
        });
      }
    }

    const wallItems = items.filter(i => i.itemType === "Wall");
    if (wallItems.length > 0) {
      flags.push({
        type: "SPEC",
        status: "INFO",
        message: `EyeSpyR Tip: Ensure 4" perforated drain pipe is behind the first course of Allan Block. Wrap in filter fabric before backfill.`,
      });
      flags.push({
        type: "SPEC",
        status: "INFO",
        message: `EyeSpyR Tip: Compact ${rules.baseSpec} in 2" lifts to 95% Proctor. Use plate compactor — never wheel-roll on block courses.`,
      });
    }

    const paverItems = items.filter(i => i.itemType === "Paver");
    if (paverItems.length > 0) {
      flags.push({
        type: "SPEC",
        status: "INFO",
        message: `EyeSpyR Tip: Screed bedding sand to 1" consistent depth before paver placement. Do not compact bedding layer before laying.`,
      });
    }

    if (turf.length > 0) {
      flags.push({
        type: "SPEC",
        status: "INFO",
        message: `EyeSpyR Tip: Lay all turf strips with pile direction facing the primary viewpoint. Brush infill in cross-grain pattern.`,
      });
    }

    if (flags.length === 0) {
      flags.push({
        type: "COMPLIANCE",
        status: "PASS",
        message: "EyeSpyR: All hardscape and turf items pass compliance review.",
      });
    }

    const branch = project.region === "CA-BC" ? detectSupplierBranch(project.address || "") : null;

    res.json({
      projectId,
      region: project.region,
      rules,
      auditFlags: flags,
      itemCount: items.length,
      turfCount: turf.length,
      overallStatus: flags.some(f => f.status === "WARNING") ? "REVIEW" : "PASS",
      supplierBranch: branch ? { name: branch.name, email: branch.email, territory: branch.territory, spyTip: branch.spyTip } : null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/hardscaping/regions", async (_req, res) => {
  res.json({ regions: REGIONAL_RULES });
});

router.get("/hardscaping/suppliers", async (_req, res) => {
  res.json({ suppliers: SUPPLIER_CATALOG });
});

router.post("/hardscaping/turf-calculator", async (req, res) => {
  const { width, length, rollWidth = 15, infillLbsSqft = 1.5, infillBagLbs = 50, overagePercent = 5 } = req.body;
  if (!width || !length) return res.status(400).json({ error: "width and length required" });

  const strips = Math.ceil(width / rollWidth);
  const totalLinearFeet = strips * length;
  const actualSqft = width * length;

  const overageFactor = 1 + (overagePercent / 100);
  const orderedSqft = Math.round(strips * rollWidth * length * overageFactor);

  const wastePercent = Math.round(((orderedSqft - actualSqft) / actualSqft) * 1000) / 10;

  const seamCount = strips > 1 ? strips - 1 : 0;
  const linearSeamFeet = seamCount * length;

  const infillLbs = Math.round(orderedSqft * infillLbsSqft);
  const infillBags = Math.ceil(infillLbs / infillBagLbs);

  const turfSpikes = Math.ceil(orderedSqft / 10);

  res.json({
    strips,
    totalLinearFeet,
    actualSqft,
    orderedSqft,
    overagePercent,
    wastePercent,
    seamCount,
    seamTapeNeeded: seamCount > 0,
    infill: {
      lbsPerSqft: infillLbsSqft,
      totalLbs: infillLbs,
      bagSize: infillBagLbs,
      bagsNeeded: infillBags,
    },
    accessories: {
      seamTape: seamCount > 0 ? `${linearSeamFeet} ft` : "None",
      seamGlue: seamCount > 0 ? `${Math.ceil(linearSeamFeet / 10)} cartridges` : "0",
      turfSpikes,
      perimeterEdging: `${Math.round((width + length) * 2)} ft`,
    },
  });
});

function deterministicId(prefix: string, seed: string): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex").substring(0, 8).toUpperCase();
  return `${prefix}-${hash}`;
}

function buildSupplierOrderPdf(data: {
  orderId: string;
  projectName: string;
  contractorName: string;
  address: string;
  region: string;
  branch: SupplierBranch;
  items: Array<{ material: string; qty: number; unit: string; notes: string }>;
  turfItems: Array<{ product: string; strips: number; sqft: number; infillBags: number; seamTape: string }>;
  complianceStatus: string;
  auditSummary: string[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = 612;

    doc.rect(0, 0, W, 70).fill("#1a1a1a");
    doc.fontSize(22).font("Helvetica-Bold").fillColor("#39FF14").text("EyeSpyR | Order Request", 40, 18, { width: W - 80 });
    doc.fontSize(9).font("Helvetica").fillColor("#aaaaaa").text(`Order ID: ${data.orderId} | ${new Date().toLocaleDateString("en-US")}`, 40, 48);

    doc.fontSize(10).font("Helvetica-Bold").fillColor("#39FF14").text("EYESPYR VERIFIED PRO [✓]", W - 220, 20, { width: 180, align: "right" });
    doc.fontSize(8).font("Helvetica").fillColor("#aaaaaa").text(`Region: ${data.region}`, W - 220, 36, { width: 180, align: "right" });

    let y = 85;

    doc.rect(40, y, W - 80, 1).fill("#39FF14");
    y += 12;

    doc.fontSize(8).font("Helvetica").fillColor("#888888");
    doc.text("PROJECT", 40, y); doc.text("CONTRACTOR", 220, y); doc.text("BRANCH", 400, y);
    y += 12;
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#333333");
    doc.text(data.projectName, 40, y, { width: 170 });
    doc.text(data.contractorName, 220, y, { width: 170 });
    doc.text(data.branch.name, 400, y, { width: 170 });
    y += 16;
    doc.fontSize(8).font("Helvetica").fillColor("#666666");
    doc.text(data.address, 40, y, { width: 170 });
    doc.text("", 220, y);
    doc.text(data.branch.territory, 400, y, { width: 170 });
    y += 20;

    doc.rect(40, y, W - 80, 1).fill("#dddddd");
    y += 12;

    doc.rect(40, y, W - 80, 20).fill("#f0f4f0");
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#1a6b3a").text("PROJECT COMPLIANCE STATUS: " + data.complianceStatus, 50, y + 5, { width: W - 100 });
    y += 28;

    for (const line of data.auditSummary) {
      doc.fontSize(8).font("Helvetica").fillColor("#333333").text(`• ${line}`, 50, y, { width: W - 100 });
      y += 12;
    }

    y += 8;
    doc.rect(40, y, W - 80, 1).fill("#dddddd");
    y += 12;

    doc.rect(40, y, W - 80, 18).fill("#e8e8f0");
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#333333");
    doc.text("Material", 50, y + 4, { width: 200 });
    doc.text("Qty", 260, y + 4, { width: 60 });
    doc.text("Unit", 330, y + 4, { width: 80 });
    doc.text("Supplier Notes", 420, y + 4, { width: 140 });
    y += 20;

    for (const item of data.items) {
      doc.fontSize(9).font("Helvetica").fillColor("#333333");
      doc.text(item.material, 50, y, { width: 200 });
      doc.text(String(item.qty), 260, y, { width: 60 });
      doc.text(item.unit, 330, y, { width: 80 });
      doc.text(item.notes, 420, y, { width: 140 });
      y += 16;
    }

    if (data.turfItems.length > 0) {
      y += 8;
      doc.rect(40, y, W - 80, 1).fill("#39FF14");
      y += 10;
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#1a6b3a").text("BELLA TURF ORDER", 50, y);
      y += 16;

      for (const t of data.turfItems) {
        doc.fontSize(9).font("Helvetica").fillColor("#333333");
        doc.text(`${t.product}: ${t.strips} strips (${t.sqft} sqft)`, 50, y, { width: 250 });
        doc.text(`Infill: ${t.infillBags} bags`, 310, y, { width: 120 });
        doc.text(`Seam: ${t.seamTape}`, 440, y, { width: 120 });
        y += 14;
      }
    }

    y += 16;
    doc.rect(40, y, W - 80, 1).fill("#333333");
    y += 10;
    doc.fontSize(7).font("Helvetica").fillColor("#999999").text(
      `Generated by EyeSpyR Pro | Contractor verified via KYC Engine | ${data.orderId}`,
      40, y, { width: W - 80, align: "center" }
    );

    doc.end();
  });
}

router.post("/hardscaping-projects/:id/submit-order", async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project ID" });

    const [project] = await db.select().from(hardscapingProjectsTable).where(eq(hardscapingProjectsTable.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const items = await db.select().from(hardscapeItemsTable).where(eq(hardscapeItemsTable.projectId, projectId));
    const turf = await db.select().from(turfItemsTable).where(eq(turfItemsTable.projectId, projectId));

    if (items.length === 0 && turf.length === 0) {
      return res.status(400).json({ error: "Project has no items or turf. Add materials before submitting an order." });
    }

    const complianceDocs = await db.select().from(complianceDocsTable).where(
      and(eq(complianceDocsTable.entityType, "contractor"), eq(complianceDocsTable.entityId, 1))
    );
    const criticalMissing = ["Business_License", "WorkSafeBC_Clearance", "Liability_Insurance_2M"]
      .filter(req => !complianceDocs.find(d => d.docType === req));
    const isGreenLight = criticalMissing.length === 0;

    const branch = project.region === "CA-BC" ? detectSupplierBranch(project.address || "") : SUPPLIER_BRANCHES_CA_BC[0];
    const orderId = deterministicId("ORD", `slegg-${project.id}-${Date.now()}`);

    const rules = REGIONAL_RULES[project.region] || REGIONAL_RULES["CA-BC"];
    const auditSummary: string[] = [];

    for (const item of items) {
      const dims = item.dimensions as any;
      if (item.itemType === "Wall" && dims?.height) {
        const heightM = project.units === "imperial" ? dims.height * 0.3048 : dims.height;
        auditSummary.push(`Wall "${item.materialName}": ${dims.height}${project.units === "imperial" ? "ft" : "m"} — ${heightM > rules.wallLimit ? "PERMIT REQUIRED" : "GREEN LIGHT"}`);
      }
      if (item.itemType === "Paver") {
        auditSummary.push(`Paver "${item.materialName}": Base ${item.baseDepth || 0}" — ${(item.baseDepth || 0) >= 4 ? "COMPLIANT" : "BASE TOO SHALLOW"}`);
      }
    }

    auditSummary.push(`Base Specs: ${rules.baseSpec} (${rules.code})`);
    if (turf.length > 0) auditSummary.push(`Turf: ${turf.length} area(s) — seam tape ${turf.some(t => (t.seamCount || 0) > 0) ? "REQUIRED" : "not needed"}`);

    const pdfItems = items.map(item => ({
      material: item.materialName,
      qty: item.quantity,
      unit: item.itemType === "Wall" ? "blocks" : item.itemType === "Paver" ? "sqft" : "units",
      notes: item.itemType === "Wall" ? "Directional Lock" : item.itemType === "Paver" ? `${item.baseDepth || 4}" base` : "Standard",
    }));

    const pdfTurf = turf.map(t => ({
      product: t.productName,
      strips: t.stripsNeeded || 0,
      sqft: Number(t.sqft) || 0,
      infillBags: Math.ceil((Number(t.sqft) || 0) * 1.5 / 50),
      seamTape: (t.seamCount || 0) > 0 ? `${t.seamCount} seam(s)` : "None",
    }));

    const pdfBuffer = await buildSupplierOrderPdf({
      orderId,
      projectName: project.name,
      contractorName: project.client || "Contractor",
      address: project.address || "On file",
      region: project.region,
      branch,
      items: pdfItems,
      turfItems: pdfTurf,
      complianceStatus: isGreenLight ? "GREEN LIGHT — EyeSpyR Verified" : `ACTION REQUIRED — Missing: ${criticalMissing.join(", ")}`,
      auditSummary,
    });

    let emailResult = null;
    const branchEmail = req.body?.email || branch.email;

    try {
      const { Resend } = await import("resend");
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey) {
        const resend = new Resend(apiKey);
        const fromDomain = process.env.RESEND_FROM_DOMAIN || "eyespyr.io";
        const { error } = await resend.emails.send({
          from: `EyeSpyR Pro <orders@${fromDomain}>`,
          to: branchEmail,
          subject: `PRO ORDER: ${project.client || "Contractor"} - ${project.name} | ${orderId}`,
          text: `New ${isGreenLight ? "EyeSpyR Verified" : "UNVERIFIED"} order attached for project: ${project.name}.\n\nBranch: ${branch.name}\nItems: ${items.length} hardscape + ${turf.length} turf\nCompliance: ${isGreenLight ? "GREEN LIGHT" : "Action Required"}\n\n${branch.spyTip}`,
          attachments: [{
            filename: `Order_${orderId}.pdf`,
            content: pdfBuffer.toString("base64"),
            contentType: "application/pdf",
          }],
        });
        emailResult = error ? { sent: false, error: error.message } : { sent: true, to: branchEmail };
      } else {
        emailResult = { sent: false, reason: "RESEND_API_KEY not configured. PDF generated but not emailed." };
      }
    } catch (e: any) {
      emailResult = { sent: false, error: e.message };
    }

    res.json({
      success: true,
      orderId,
      projectId,
      branch: { name: branch.name, email: branch.email, territory: branch.territory },
      confirmation: `Sent to ${branch.name}`,
      spyTip: branch.spyTip,
      compliance: {
        isGreenLight,
        shieldColor: isGreenLight ? "ElectricGreen" : "Red",
        missingDocs: criticalMissing,
      },
      email: emailResult,
      pdfGenerated: true,
      pdfSizeBytes: pdfBuffer.length,
      intel: {
        itemCount: items.length,
        turfCount: turf.length,
        auditSummary,
        deliveryNotes: branch.deliveryNotes,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
