import { Router, type IRouter } from "express";
import { db, complianceDocsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();

const REGIONAL_REQUIREMENTS: Record<string, Array<{ docType: string; label: string; critical: boolean }>> = {
  "CA-BC": [
    { docType: "Business_License", label: "Business License", critical: true },
    { docType: "WorkSafeBC_Clearance", label: "WorkSafeBC Clearance Letter", critical: true },
    { docType: "Liability_Insurance_2M", label: "Liability Insurance ($2M min)", critical: true },
    { docType: "Drivers_License", label: "Driver's License (KYC)", critical: false },
  ],
  "CA-AB": [
    { docType: "Business_License", label: "Business License", critical: true },
    { docType: "WCB_Alberta_Clearance", label: "WCB Alberta Clearance", critical: true },
    { docType: "Liability_Insurance_2M", label: "Liability Insurance ($2M min)", critical: true },
  ],
  "US-WA": [
    { docType: "Contractor_License", label: "Contractor License (L&I)", critical: true },
    { docType: "General_Liability", label: "General Liability Insurance", critical: true },
    { docType: "Bond", label: "Contractor Bond", critical: true },
  ],
  "UK-ENG": [
    { docType: "Companies_House_Reg", label: "Companies House Registration", critical: true },
    { docType: "Public_Liability_5M", label: "Public Liability Insurance (£5M)", critical: true },
    { docType: "VAT_Registration", label: "VAT Registration", critical: false },
  ],
  "AU-NSW": [
    { docType: "White_Card", label: "White Card (General Construction Induction)", critical: true },
    { docType: "Contractor_License_NSW", label: "NSW Fair Trading Contractor License", critical: true },
    { docType: "Public_Liability_10M", label: "Public Liability Insurance ($10M AUD)", critical: true },
    { docType: "ABN_Registration", label: "ABN Registration", critical: true },
    { docType: "Workers_Comp_NSW", label: "Workers Compensation Insurance (icare)", critical: true },
  ],
};

const DOC_EXTRACTION_FIELDS: Record<string, string[]> = {
  "Business_License": ["businessName", "expiryDate", "civicAddress", "registrationNumber"],
  "WorkSafeBC_Clearance": ["accountNumber", "status", "effectiveDate"],
  "Liability_Insurance_2M": ["policyAmount", "expiryDate", "carrierName", "policyNumber"],
  "Drivers_License": ["fullName", "dateOfBirth", "photoMatch"],
  "Companies_House_Reg": ["companyNumber", "status", "registeredAddress"],
  "Public_Liability_5M": ["policyAmount", "expiryDate", "insurer"],
  "VAT_Registration": ["vatNumber", "effectiveDate"],
  "White_Card": ["cardNumber", "fullName", "issueDate", "state"],
  "Contractor_License_NSW": ["licenseNumber", "category", "expiryDate", "holder"],
  "Public_Liability_10M": ["policyAmount", "expiryDate", "insurer", "policyNumber"],
  "ABN_Registration": ["abn", "entityName", "gstRegistered", "status"],
  "Workers_Comp_NSW": ["policyNumber", "insurer", "expiryDate", "wageDeclaration"],
};

router.get("/compliance/requirements/:region", async (req, res) => {
  const region = req.params.region;
  const reqs = REGIONAL_REQUIREMENTS[region];
  if (!reqs) {
    return res.status(404).json({ error: `Unknown region: ${region}. Valid: ${Object.keys(REGIONAL_REQUIREMENTS).join(", ")}` });
  }
  res.json({
    region,
    requirements: reqs,
    extractionFields: Object.fromEntries(
      reqs.map(r => [r.docType, DOC_EXTRACTION_FIELDS[r.docType] || []])
    ),
  });
});

router.get("/compliance/regions", async (_req, res) => {
  res.json({
    regions: Object.entries(REGIONAL_REQUIREMENTS).map(([id, reqs]) => ({
      id,
      requiredDocs: reqs.length,
      criticalDocs: reqs.filter(r => r.critical).length,
    })),
  });
});

router.get("/compliance/entity/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const id = Number(entityId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid entity ID" });

    const docs = await db
      .select()
      .from(complianceDocsTable)
      .where(
        and(
          eq(complianceDocsTable.entityType, entityType),
          eq(complianceDocsTable.entityId, id)
        )
      )
      .orderBy(desc(complianceDocsTable.createdAt));

    res.json(docs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/compliance/docs", async (req, res) => {
  try {
    const { entityType, entityId, docType, docName, issuer, docNumber, issuedDate, expiryDate, region, extractedData, fileHash } = req.body;

    if (!entityType || !entityId || !docType || !docName) {
      return res.status(400).json({ error: "entityType, entityId, docType, docName required" });
    }

    const [doc] = await db.insert(complianceDocsTable).values({
      entityType,
      entityId,
      docType,
      docName,
      issuer: issuer || null,
      docNumber: docNumber || null,
      issuedDate: issuedDate ? new Date(issuedDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      status: "pending",
      region: region || "CA-BC",
      extractedData: extractedData || null,
      fileHash: fileHash || null,
    }).returning();

    res.status(201).json(doc);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/compliance/docs/:id/verify", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid doc ID" });

    const { status, verificationMethod, extractedData } = req.body;
    const validStatuses = ["verified", "rejected", "expired", "pending"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${validStatuses.join(", ")}` });
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (status === "verified") updates.verifiedAt = new Date();
    if (verificationMethod) updates.verificationMethod = verificationMethod;
    if (extractedData) updates.extractedData = extractedData;

    const [updated] = await db
      .update(complianceDocsTable)
      .set(updates)
      .where(eq(complianceDocsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Document not found" });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/compliance/docs/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid doc ID" });
    const [deleted] = await db.delete(complianceDocsTable).where(eq(complianceDocsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "Document not found" });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/compliance/check/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const region = (req.query.region as string) || "CA-BC";
    const id = Number(entityId);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid entity ID" });

    const reqs = REGIONAL_REQUIREMENTS[region];
    if (!reqs) return res.status(400).json({ error: `Unknown region: ${region}` });

    const docs = await db
      .select()
      .from(complianceDocsTable)
      .where(
        and(
          eq(complianceDocsTable.entityType, entityType),
          eq(complianceDocsTable.entityId, id)
        )
      );

    const now = new Date();

    const missing = reqs.filter(req => !docs.find(doc => doc.docType === req.docType));
    const expired = docs.filter(doc => doc.expiryDate && new Date(doc.expiryDate) < now);
    const expiringSoon = docs.filter(doc => {
      if (!doc.expiryDate) return false;
      const exp = new Date(doc.expiryDate);
      const daysUntil = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return daysUntil > 0 && daysUntil <= 30;
    });
    const verified = docs.filter(doc => doc.status === "verified");
    const pending = docs.filter(doc => doc.status === "pending");

    const criticalMissing = missing.filter(m => m.critical);
    const criticalExpired = expired.filter(e => {
      const req = reqs.find(r => r.docType === e.docType);
      return req?.critical;
    });

    const isGreenLight = criticalMissing.length === 0 && criticalExpired.length === 0;
    let shieldColor: string;
    if (isGreenLight && expiringSoon.length === 0) {
      shieldColor = "ElectricGreen";
    } else if (isGreenLight && expiringSoon.length > 0) {
      shieldColor = "Amber";
    } else {
      shieldColor = "Red";
    }

    res.json({
      entityType,
      entityId: id,
      region,
      isGreenLight,
      shieldColor,
      summary: {
        required: reqs.length,
        uploaded: docs.length,
        verified: verified.length,
        pending: pending.length,
        missing: missing.length,
        expired: expired.length,
        expiringSoon: expiringSoon.length,
      },
      missingDocs: missing.map(m => ({ docType: m.docType, label: m.label, critical: m.critical })),
      expiredDocs: expired.map(e => ({
        id: e.id,
        docType: e.docType,
        docName: e.docName,
        expiryDate: e.expiryDate?.toISOString(),
      })),
      expiringSoonDocs: expiringSoon.map(e => ({
        id: e.id,
        docType: e.docType,
        docName: e.docName,
        expiryDate: e.expiryDate?.toISOString(),
        daysRemaining: Math.ceil((new Date(e.expiryDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      })),
      allDocs: docs.map(d => ({
        id: d.id,
        docType: d.docType,
        docName: d.docName,
        status: d.status,
        expiryDate: d.expiryDate?.toISOString(),
        verifiedAt: d.verifiedAt?.toISOString(),
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === JURISDICTION ENGINE ===

interface JurisdictionProfile {
  id: string;
  label: string;
  country: string;
  currency: string;
  units: "metric" | "imperial";
  safetyBody: { name: string; acronym: string; api: string; verifyEndpoint: string };
  buildingCode: string;
  wallLimit: { value: number; unit: string };
  insuranceMinimum: { amount: number; currency: string; label: string };
  permitAuthority: string;
  tradeRules: Record<string, Record<string, unknown>>;
  taxId: { name: string; pattern: string; example: string };
}

const JURISDICTIONS: Record<string, JurisdictionProfile> = {
  "CA-BC": {
    id: "CA-BC", label: "British Columbia, Canada", country: "CA", currency: "CAD", units: "imperial",
    safetyBody: { name: "WorkSafeBC", acronym: "WSBC", api: "https://api.worksafebc.com", verifyEndpoint: "/clearance/verify" },
    buildingCode: "BCBC 2024",
    wallLimit: { value: 1.2, unit: "m" },
    insuranceMinimum: { amount: 2_000_000, currency: "CAD", label: "$2M CGL" },
    permitAuthority: "Municipal Building Department",
    tradeRules: {
      roofing: { requiresPermit: true, maxStoreys: 3, iceShieldRequired: true },
      electrical: { masterLicenseRequired: true, permitPerJob: true, fsraNumber: true },
      plumbing: { crossConnectionCert: true, backflowTesting: "annual" },
      gasfitting: { bTechRequired: true, tsaRegistration: true, gasTag: true },
      hardscaping: { geoGridOver3ft: true, baseSpec: "3/4 Minus Road Base", minBaseDepth: 4, turfRollWidth: 15 },
      hvac: { hcfcPhaseOut: true, fridgeCert: "ODS", energyStarReq: true },
      framing: { engineeredRequired: ">3_stories", windLoadZone: "moderate" },
    },
    taxId: { name: "GST/PST", pattern: "^\\d{9}RT\\d{4}$", example: "123456789RT0001" },
  },
  "CA-AB": {
    id: "CA-AB", label: "Alberta, Canada", country: "CA", currency: "CAD", units: "imperial",
    safetyBody: { name: "WCB Alberta", acronym: "WCB-AB", api: "https://api.wcb.ab.ca", verifyEndpoint: "/clearance/check" },
    buildingCode: "ABC 2019 (NBC based)",
    wallLimit: { value: 1.2, unit: "m" },
    insuranceMinimum: { amount: 2_000_000, currency: "CAD", label: "$2M CGL" },
    permitAuthority: "Municipal Safety Codes Officer",
    tradeRules: {
      roofing: { requiresPermit: true, maxStoreys: 3 },
      electrical: { masterLicenseRequired: true, permitPerJob: true },
      plumbing: { journeymanRequired: true },
      gasfitting: { gasFitterCert: true, absa: true },
      hardscaping: { geoGridOver3ft: true, baseSpec: "Crushed Gravel", minBaseDepth: 4, turfRollWidth: 15 },
      hvac: { fridgeCert: "ODS" },
      framing: { engineeredRequired: ">3_stories" },
    },
    taxId: { name: "GST", pattern: "^\\d{9}RT\\d{4}$", example: "123456789RT0001" },
  },
  "US-WA": {
    id: "US-WA", label: "Washington State, USA", country: "US", currency: "USD", units: "imperial",
    safetyBody: { name: "Labor & Industries", acronym: "L&I", api: "https://fortress.wa.gov/lni/api", verifyEndpoint: "/contractor/verify" },
    buildingCode: "IBC/IRC 2021",
    wallLimit: { value: 1.219, unit: "m" },
    insuranceMinimum: { amount: 1_000_000, currency: "USD", label: "$1M General Liability" },
    permitAuthority: "County/City Building Department",
    tradeRules: {
      roofing: { contractorLicenseRequired: true, bondRequired: true, bondMinimum: 12000 },
      electrical: { journeymanRequired: true, inspectionRequired: true },
      plumbing: { journeymanRequired: true, crossConnectionRequired: true },
      gasfitting: { plumberLicenseCovers: true },
      hardscaping: { geoGridOver4ft: true, baseSpec: "Crushed Surfacing Top Course", minBaseDepth: 4, turfRollWidth: 15 },
      hvac: { epaSection608: true, universalCert: true },
      framing: { contractorRegRequired: true },
    },
    taxId: { name: "EIN", pattern: "^\\d{2}-\\d{7}$", example: "91-1234567" },
  },
  "UK-ENG": {
    id: "UK-ENG", label: "England, UK", country: "UK", currency: "GBP", units: "metric",
    safetyBody: { name: "Health & Safety Executive / CSCS", acronym: "HSE/CSCS", api: "https://api.cscs.uk.com", verifyEndpoint: "/card/verify" },
    buildingCode: "Building Regulations 2010 (Approved Docs)",
    wallLimit: { value: 1.0, unit: "m" },
    insuranceMinimum: { amount: 5_000_000, currency: "GBP", label: "£5M Public Liability" },
    permitAuthority: "Local Authority Building Control (LABC)",
    tradeRules: {
      roofing: { competentPersonScheme: true, partL: "insulation", scaffoldRegRequired: true },
      electrical: { partP: true, nicEicRequired: true, bs7671: true },
      plumbing: { waterRegs: true, wipsCert: true },
      gasfitting: { gasSafeRequired: true, gasSafeRegister: "https://www.gassaferegister.co.uk" },
      hardscaping: { baseSpec: "Type 1 MOT", minBaseDepth: 100, turfRollWidth: 4, turfRollWidthUnit: "m" },
      hvac: { fgasRequired: true, refcomElite: true },
      framing: { structuralEngineerApproval: true, buildingRegsNotice: true },
    },
    taxId: { name: "VAT Number", pattern: "^GB\\d{9}$", example: "GB123456789" },
  },
  "AU-NSW": {
    id: "AU-NSW", label: "New South Wales, Australia", country: "AU", currency: "AUD", units: "metric",
    safetyBody: { name: "SafeWork NSW / White Card", acronym: "SWNSW", api: "https://api.safework.nsw.gov.au", verifyEndpoint: "/whitecard/verify" },
    buildingCode: "NCC 2022 (BCA Vol 1 & 2)",
    wallLimit: { value: 1.0, unit: "m" },
    insuranceMinimum: { amount: 10_000_000, currency: "AUD", label: "$10M Public Liability" },
    permitAuthority: "Local Council / NSW Fair Trading",
    tradeRules: {
      roofing: { contractorLicenseRequired: true, whiteCardRequired: true, asbestosClearance: true, heightSafetyRequired: true },
      electrical: { electricalLicenseRequired: true, classA: true, levelII_ASP: false, complianceCertificate: true },
      plumbing: { plumbingLicenseRequired: true, watermarkCompliance: true, backflowRequired: true },
      gasfitting: { gasfittingLicense: true, type_A: true, compliancePlate: true },
      hardscaping: { geoGridOver1m: true, baseSpec: "Road Base (DGB-20)", minBaseDepth: 100, turfRollWidth: 3.66, turfRollWidthUnit: "m" },
      hvac: { arcticTickRequired: true, refrigerantHandlingLicense: true, energyEfficiencyRating: true },
      framing: { carpenterLicense: true, builderLicenseOver5k: true, basixCert: true },
    },
    taxId: { name: "ABN", pattern: "^\\d{11}$", example: "51824753556" },
  },
};

router.get("/compliance/jurisdictions", async (_req, res) => {
  res.json({
    jurisdictions: Object.values(JURISDICTIONS).map(j => ({
      id: j.id,
      label: j.label,
      country: j.country,
      currency: j.currency,
      units: j.units,
      safetyBody: j.safetyBody.name,
      buildingCode: j.buildingCode,
      wallLimit: `${j.wallLimit.value}${j.wallLimit.unit}`,
      insuranceMinimum: j.insuranceMinimum.label,
      trades: Object.keys(j.tradeRules),
    })),
  });
});

router.get("/compliance/jurisdictions/:id", async (req, res) => {
  const j = JURISDICTIONS[req.params.id];
  if (!j) return res.status(404).json({ error: `Unknown jurisdiction: ${req.params.id}. Valid: ${Object.keys(JURISDICTIONS).join(", ")}` });
  res.json(j);
});

router.get("/compliance/jurisdictions/:id/trade/:trade", async (req, res) => {
  const j = JURISDICTIONS[req.params.id];
  if (!j) return res.status(404).json({ error: `Unknown jurisdiction: ${req.params.id}` });
  const rules = j.tradeRules[req.params.trade];
  if (!rules) return res.status(404).json({ error: `No rules for trade "${req.params.trade}" in ${j.label}. Available: ${Object.keys(j.tradeRules).join(", ")}` });
  res.json({
    jurisdiction: j.id,
    trade: req.params.trade,
    safetyBody: j.safetyBody,
    buildingCode: j.buildingCode,
    insuranceMinimum: j.insuranceMinimum,
    tradeRules: rules,
  });
});

router.post("/compliance/jurisdiction-switch", async (req, res) => {
  try {
    const { address, taxId, documentText, tradeType } = req.body;

    if (!address && !taxId && !documentText) {
      return res.status(400).json({ error: "Provide address, taxId, or documentText to detect jurisdiction" });
    }

    const searchText = [address, taxId, documentText].filter(Boolean).join(" ");

    const regionDetect = detectRegion(searchText);
    if (!regionDetect) {
      return res.status(400).json({
        error: "Could not determine jurisdiction from provided data",
        hint: "Include a city/province/state name, postal code pattern, or known tax ID format",
        availableJurisdictions: Object.keys(JURISDICTIONS),
      });
    }

    const jurisdiction = JURISDICTIONS[regionDetect.region];
    if (!jurisdiction) {
      return res.json({
        detected: regionDetect,
        jurisdiction: null,
        message: `Region ${regionDetect.region} detected but no jurisdiction profile configured yet.`,
      });
    }

    const result: Record<string, unknown> = {
      detected: regionDetect,
      jurisdiction: {
        id: jurisdiction.id,
        label: jurisdiction.label,
        currency: jurisdiction.currency,
        units: jurisdiction.units,
        safetyBody: jurisdiction.safetyBody,
        buildingCode: jurisdiction.buildingCode,
        wallLimit: jurisdiction.wallLimit,
        insuranceMinimum: jurisdiction.insuranceMinimum,
        permitAuthority: jurisdiction.permitAuthority,
        taxId: jurisdiction.taxId,
      },
      safetyVerification: {
        action: `Initiating ${jurisdiction.safetyBody.name} verification...`,
        endpoint: `${jurisdiction.safetyBody.api}${jurisdiction.safetyBody.verifyEndpoint}`,
        status: "ready",
      },
    };

    if (tradeType && jurisdiction.tradeRules[tradeType]) {
      result.tradeCompliance = {
        trade: tradeType,
        rules: jurisdiction.tradeRules[tradeType],
        buildingCode: jurisdiction.buildingCode,
      };
    } else if (tradeType) {
      result.tradeCompliance = {
        trade: tradeType,
        rules: null,
        message: `No specific rules for "${tradeType}" in ${jurisdiction.label}. Available trades: ${Object.keys(jurisdiction.tradeRules).join(", ")}`,
      };
    }

    if (documentText) {
      const amount = extractAmount(documentText);
      if (amount !== null) {
        const minInsurance = jurisdiction.insuranceMinimum.amount;
        result.coverageCheck = {
          detected: amount,
          minimum: minInsurance,
          currency: jurisdiction.currency,
          status: amount >= minInsurance ? "ADEQUATE" : "INSUFFICIENT",
          message: amount >= minInsurance
            ? `Coverage $${amount.toLocaleString()} meets ${jurisdiction.insuranceMinimum.label} requirement.`
            : `EyeSpyR Alert: Coverage $${amount.toLocaleString()} is below ${jurisdiction.insuranceMinimum.label} minimum.`,
        };
      }

      const wallHeightMatch = documentText.match(/(?:wall|retaining).*?(\d+(?:\.\d+)?)\s*(ft|feet|m|metres?|meters?)/i);
      if (wallHeightMatch) {
        let heightM = parseFloat(wallHeightMatch[1]);
        const unit = wallHeightMatch[2].toLowerCase();
        if (unit.startsWith("ft") || unit === "feet") heightM *= 0.3048;
        else if (unit.startsWith("m")) { /* already meters */ }

        result.structuralCheck = {
          wallHeight: { value: parseFloat(wallHeightMatch[1]), unit: wallHeightMatch[2], meters: parseFloat(heightM.toFixed(3)) },
          limit: jurisdiction.wallLimit,
          compliance: heightM >= jurisdiction.wallLimit.value ? "Permit Required" : "Green Light",
          message: heightM >= jurisdiction.wallLimit.value
            ? `Wall height ${wallHeightMatch[1]}${wallHeightMatch[2]} exceeds ${jurisdiction.wallLimit.value}${jurisdiction.wallLimit.unit} limit. ${jurisdiction.buildingCode} requires engineering approval.`
            : `Wall height ${wallHeightMatch[1]}${wallHeightMatch[2]} is within permit-free limit of ${jurisdiction.wallLimit.value}${jurisdiction.wallLimit.unit}.`,
        };
      }
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const COVERAGE_MINIMUMS: Record<string, Record<string, number>> = {
  "CA-BC": {
    "Liability_Insurance_2M": 2_000_000,
  },
  "CA-AB": {
    "Liability_Insurance_2M": 2_000_000,
  },
  "US-WA": {
    "General_Liability": 1_000_000,
    "Bond": 12_000,
  },
  "UK-ENG": {
    "Public_Liability_5M": 5_000_000,
  },
  "AU-NSW": {
    "Public_Liability_10M": 10_000_000,
  },
};

const REGION_DETECT_RULES: Array<{ patterns: RegExp[]; region: string; label: string }> = [
  { patterns: [/victoria/i, /vancouver/i, /surrey/i, /burnaby/i, /kelowna/i, /nanaimo/i, /\bBC\b/, /british columbia/i], region: "CA-BC", label: "British Columbia, Canada" },
  { patterns: [/calgary/i, /edmonton/i, /red deer/i, /lethbridge/i, /\bAB\b/, /alberta/i], region: "CA-AB", label: "Alberta, Canada" },
  { patterns: [/seattle/i, /tacoma/i, /spokane/i, /olympia/i, /\bWA\b/, /washington state/i], region: "US-WA", label: "Washington State, USA" },
  { patterns: [/london/i, /manchester/i, /birmingham/i, /bristol/i, /liverpool/i, /\beng\b/i, /england/i], region: "UK-ENG", label: "England, UK" },
  { patterns: [/sydney/i, /melbourne/i, /brisbane/i, /perth/i, /\bNSW\b/, /new south wales/i, /australia/i, /\bAU\b/], region: "AU-NSW", label: "New South Wales, Australia" },
];

const DOC_TYPE_DETECT_RULES: Array<{ patterns: RegExp[]; docType: string; label: string }> = [
  { patterns: [/certificate of (liability|insurance)/i, /commercial general liability/i, /CGL/i, /liability insurance/i, /insurance certificate/i], docType: "Liability_Insurance_2M", label: "Certificate of Liability Insurance" },
  { patterns: [/worksafe\s*bc/i, /clearance letter/i, /workers.?compensation/i, /WCB.*clearance/i], docType: "WorkSafeBC_Clearance", label: "WorkSafeBC Clearance Letter" },
  { patterns: [/business licen[cs]e/i, /municipal.*licen[cs]e/i, /trade licen[cs]e/i], docType: "Business_License", label: "Business License" },
  { patterns: [/driver.?s? licen[cs]e/i, /motor vehicle/i, /\bDL\b/, /\bMVB\b/], docType: "Drivers_License", label: "Driver's License" },
  { patterns: [/companies house/i, /certificate of incorporation/i], docType: "Companies_House_Reg", label: "Companies House Registration" },
  { patterns: [/public liability/i, /employer.?s? liability/i], docType: "Public_Liability_5M", label: "Public Liability Insurance" },
  { patterns: [/VAT.*registration/i, /value added tax/i, /\bVAT\b.*certificate/i], docType: "VAT_Registration", label: "VAT Registration Certificate" },
  { patterns: [/contractor.*licen[cs]e/i, /labor.*industries/i, /\bL&I\b/i, /contractor registration/i], docType: "Contractor_License", label: "Contractor License (L&I)" },
  { patterns: [/surety bond/i, /contractor bond/i, /performance bond/i], docType: "Bond", label: "Contractor Bond" },
  { patterns: [/WCB.*alberta/i, /alberta.*workers/i], docType: "WCB_Alberta_Clearance", label: "WCB Alberta Clearance" },
  { patterns: [/white\s*card/i, /general.*construction.*induction/i, /GCI/i], docType: "White_Card", label: "White Card (GCI)" },
  { patterns: [/NSW.*fair.*trading/i, /contractor.*licen[cs]e.*NSW/i, /home.*building.*licen[cs]e/i], docType: "Contractor_License_NSW", label: "NSW Contractor License" },
  { patterns: [/\bABN\b/, /australian business number/i, /business.*registration.*au/i], docType: "ABN_Registration", label: "ABN Registration" },
  { patterns: [/workers?\s*comp.*NSW/i, /\bicare\b/i, /workers?\s*compensation.*insurance/i], docType: "Workers_Comp_NSW", label: "Workers Compensation (NSW)" },
  { patterns: [/public liability.*\$?\s*10/i, /10.*million.*liab/i, /AU.*public.*liab/i], docType: "Public_Liability_10M", label: "Public Liability Insurance ($10M AUD)" },
];

const AMOUNT_PATTERNS = [
  /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:million|M)/i,
  /\$\s*([\d,]+(?:\.\d{2})?)/,
  /£\s*([\d,]+(?:\.\d{2})?)\s*(?:million|M)/i,
  /£\s*([\d,]+(?:\.\d{2})?)/,
  /([\d,]+(?:\.\d{2})?)\s*(?:million|M)/i,
];

const DATE_PATTERNS = [
  /(?:expir(?:y|es|ation)|exp\.?\s*date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  /(?:expir(?:y|es|ation)|exp\.?\s*date)[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
  /(?:valid\s+(?:until|thru|through))[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  /(?:valid\s+(?:until|thru|through))[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
];

const ACCOUNT_PATTERNS = [
  /card\s+number[:\s]+([A-Z0-9\-]{4,20})/i,
  /licen[cs]e\s+(?:#|no\.?|number)?[:\s]*([A-Z0-9\-]{4,20})/i,
  /(?:ABN|abn)[:\s]*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})/,
  /(?:WCB|WorkSafeBC)\s*(?:#|no\.?|number)?[:\s]*([A-Z0-9\-]{4,20})/i,
  /(?:account|acct|policy|reg|certificate)\s*(?:#|no\.?|number)?[:\s]*([A-Z0-9\-]{4,20})/i,
];

function detectRegion(text: string): { region: string; label: string; confidence: number } | null {
  for (const rule of REGION_DETECT_RULES) {
    const matches = rule.patterns.filter(p => p.test(text));
    if (matches.length > 0) {
      return { region: rule.region, label: rule.label, confidence: Math.min(0.95, 0.7 + matches.length * 0.1) };
    }
  }
  return null;
}

function detectDocType(text: string): { docType: string; label: string; confidence: number } | null {
  let bestMatch: { docType: string; label: string; matchCount: number } | null = null;
  for (const rule of DOC_TYPE_DETECT_RULES) {
    const matches = rule.patterns.filter(p => p.test(text));
    if (matches.length > 0 && (!bestMatch || matches.length > bestMatch.matchCount)) {
      bestMatch = { docType: rule.docType, label: rule.label, matchCount: matches.length };
    }
  }
  if (!bestMatch) return null;
  return { docType: bestMatch.docType, label: bestMatch.label, confidence: Math.min(0.97, 0.65 + bestMatch.matchCount * 0.12) };
}

function extractAmount(text: string): number | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      let val = parseFloat(match[1].replace(/,/g, ""));
      if (/million|M/i.test(match[0])) val *= 1_000_000;
      return val;
    }
  }
  return null;
}

function extractExpiry(text: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      try {
        const d = new Date(match[1]);
        if (!isNaN(d.getTime())) return d.toISOString();
      } catch { }
    }
  }
  return null;
}

function extractAccountNumber(text: string): string | null {
  for (const pattern of ACCOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

interface PipelineStep {
  step: string;
  action: string;
  detail: string;
  status: "OK" | "FLAG" | "ALERT" | "SKIP";
  timestamp: string;
}

interface PipelineAlert {
  severity: "CRITICAL" | "WARNING" | "INFO";
  code: string;
  message: string;
  field?: string;
  expected?: string | number;
  actual?: string | number;
}

router.post("/compliance/eyespyr-scan", async (req, res) => {
  try {
    const { documentText, entityType, entityId, regionOverride } = req.body;

    if (!documentText || typeof documentText !== "string") {
      return res.status(400).json({ error: "documentText (string) is required — paste or OCR the document content" });
    }
    if (!entityType || !entityId) {
      return res.status(400).json({ error: "entityType and entityId required" });
    }

    const eId = Number(entityId);
    if (isNaN(eId)) return res.status(400).json({ error: "Invalid entityId" });

    const vaultId = `TV-${Array.from({ length: 16 }, () => "0123456789ABCDEF"[Math.floor(Math.random() * 16)]).join("")}`;
    const wowId = `WOW-${Array.from({ length: 12 }, () => "0123456789ABCDEF"[Math.floor(Math.random() * 16)]).join("")}`;

    const pipeline: PipelineStep[] = [];
    const alerts: PipelineAlert[] = [];
    const now = () => new Date().toISOString();

    // === STEP 1: SCAN — Identify Document Type ===
    const docDetect = detectDocType(documentText);
    if (docDetect) {
      pipeline.push({
        step: "SCAN",
        action: "Document Type Identified",
        detail: `Detected "${docDetect.label}" (confidence: ${(docDetect.confidence * 100).toFixed(1)}%)`,
        status: "OK",
        timestamp: now(),
      });
    } else {
      pipeline.push({
        step: "SCAN",
        action: "Document Type Unknown",
        detail: "Could not auto-detect document type from content. Manual classification required.",
        status: "FLAG",
        timestamp: now(),
      });
      alerts.push({ severity: "WARNING", code: "SCAN_UNRECOGNIZED", message: "EyeSpyR could not identify document type. Manual review required." });
    }

    // === STEP 2: LOCATE — Detect Region ===
    const regionDetect = regionOverride
      ? { region: regionOverride, label: regionOverride, confidence: 1.0, overridden: true }
      : detectRegion(documentText);

    if (regionDetect) {
      pipeline.push({
        step: "LOCATE",
        action: "Region Resolved",
        detail: `Region: ${regionDetect.label} (${(regionDetect as any).overridden ? "manual override" : `confidence: ${(regionDetect.confidence * 100).toFixed(1)}%`})`,
        status: "OK",
        timestamp: now(),
      });
    } else {
      pipeline.push({
        step: "LOCATE",
        action: "Region Unknown",
        detail: "No geographic identifiers found. Defaulting to CA-BC.",
        status: "FLAG",
        timestamp: now(),
      });
      alerts.push({ severity: "INFO", code: "LOCATE_DEFAULT", message: "Region could not be determined. Defaulting to CA-BC rules." });
    }

    const resolvedRegion = regionDetect?.region || "CA-BC";

    // === STEP 3: VERIFY — Check Coverage, Expiry, Amounts ===
    const extractedAmount = extractAmount(documentText);
    const extractedExpiry = extractExpiry(documentText);
    const extractedAccount = extractAccountNumber(documentText);

    const extractedData: Record<string, unknown> = {};
    if (extractedAmount !== null) extractedData.policyAmount = extractedAmount;
    if (extractedExpiry) extractedData.expiryDate = extractedExpiry;
    if (extractedAccount) extractedData.accountNumber = extractedAccount;

    if (docDetect && extractedAmount !== null) {
      const minimums = COVERAGE_MINIMUMS[resolvedRegion];
      const requiredMin = minimums?.[docDetect.docType];

      if (requiredMin !== undefined) {
        if (extractedAmount < requiredMin) {
          pipeline.push({
            step: "VERIFY",
            action: "Insufficient Coverage",
            detail: `Policy amount $${extractedAmount.toLocaleString()} is below regional minimum of $${requiredMin.toLocaleString()} for ${resolvedRegion}.`,
            status: "ALERT",
            timestamp: now(),
          });
          alerts.push({
            severity: "CRITICAL",
            code: "VERIFY_INSUFFICIENT_COVERAGE",
            message: `EyeSpyR Alert: "${docDetect.label}" coverage of $${extractedAmount.toLocaleString()} is below the ${resolvedRegion} minimum of $${requiredMin.toLocaleString()}.`,
            field: "policyAmount",
            expected: requiredMin,
            actual: extractedAmount,
          });
        } else {
          pipeline.push({
            step: "VERIFY",
            action: "Coverage Adequate",
            detail: `Policy amount $${extractedAmount.toLocaleString()} meets or exceeds minimum of $${requiredMin.toLocaleString()}.`,
            status: "OK",
            timestamp: now(),
          });
        }
      }
    }

    if (extractedExpiry) {
      const expDate = new Date(extractedExpiry);
      const nowDate = new Date();
      const daysUntil = Math.ceil((expDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntil < 0) {
        pipeline.push({
          step: "VERIFY",
          action: "Document Expired",
          detail: `Document expired ${Math.abs(daysUntil)} days ago (${expDate.toLocaleDateString()}).`,
          status: "ALERT",
          timestamp: now(),
        });
        alerts.push({ severity: "CRITICAL", code: "VERIFY_EXPIRED", message: `Document expired on ${expDate.toLocaleDateString()}.` });
      } else if (daysUntil <= 30) {
        pipeline.push({
          step: "VERIFY",
          action: "Expiring Soon",
          detail: `Document expires in ${daysUntil} days (${expDate.toLocaleDateString()}).`,
          status: "FLAG",
          timestamp: now(),
        });
        alerts.push({ severity: "WARNING", code: "VERIFY_EXPIRING_SOON", message: `Document expires in ${daysUntil} days. Renewal recommended.` });
      } else {
        pipeline.push({
          step: "VERIFY",
          action: "Expiry Valid",
          detail: `Document valid for ${daysUntil} days (expires ${expDate.toLocaleDateString()}).`,
          status: "OK",
          timestamp: now(),
        });
      }
    } else {
      pipeline.push({
        step: "VERIFY",
        action: "No Expiry Found",
        detail: "Could not extract expiry date. Manual review required.",
        status: "FLAG",
        timestamp: now(),
      });
    }

    // === STEP 4: INTEGRATE — Cross-reference external systems ===
    const integrationChecks: PipelineStep[] = [];

    if (docDetect?.docType === "WorkSafeBC_Clearance" && resolvedRegion === "CA-BC") {
      if (extractedAccount) {
        integrationChecks.push({
          step: "INTEGRATE",
          action: "WorkSafeBC API Check",
          detail: `Checking WorkSafeBC API for Account #${extractedAccount}... Status: CLEAR (simulated).`,
          status: "OK",
          timestamp: now(),
        });
        extractedData.worksafeBcStatus = "CLEAR";
        extractedData.worksafeBcCheckedAt = now();
      } else {
        integrationChecks.push({
          step: "INTEGRATE",
          action: "WorkSafeBC API Skipped",
          detail: "No account number extracted. Cannot verify against WorkSafeBC API.",
          status: "FLAG",
          timestamp: now(),
        });
        alerts.push({ severity: "WARNING", code: "INTEGRATE_NO_ACCOUNT", message: "WorkSafeBC account number not found. Manual verification required." });
      }
    }

    if (docDetect?.docType === "Business_License" && resolvedRegion.startsWith("CA-")) {
      integrationChecks.push({
        step: "INTEGRATE",
        action: "BC Business Registry Check",
        detail: `Cross-referencing business name with BC Business Registry... Match found (simulated).`,
        status: "OK",
        timestamp: now(),
      });
      extractedData.registryVerified = true;
      extractedData.registryCheckedAt = now();
    }

    if (docDetect?.docType === "Companies_House_Reg" && resolvedRegion === "UK-ENG") {
      integrationChecks.push({
        step: "INTEGRATE",
        action: "Companies House API Check",
        detail: `Querying Companies House API for registration... Active status confirmed (simulated).`,
        status: "OK",
        timestamp: now(),
      });
      extractedData.companiesHouseStatus = "ACTIVE";
      extractedData.companiesHouseCheckedAt = now();
    }

    if (docDetect?.docType === "Contractor_License" && resolvedRegion === "US-WA") {
      integrationChecks.push({
        step: "INTEGRATE",
        action: "WA L&I License Lookup",
        detail: `Checking Washington L&I contractor database... License active (simulated).`,
        status: "OK",
        timestamp: now(),
      });
      extractedData.lniStatus = "ACTIVE";
      extractedData.lniCheckedAt = now();
    }

    if (docDetect?.docType === "White_Card" && resolvedRegion === "AU-NSW") {
      if (extractedAccount) {
        integrationChecks.push({
          step: "INTEGRATE",
          action: "SafeWork NSW White Card Check",
          detail: `Checking SafeWork NSW database for White Card #${extractedAccount}... Card valid (simulated).`,
          status: "OK",
          timestamp: now(),
        });
        extractedData.whiteCardStatus = "VALID";
        extractedData.whiteCardCheckedAt = now();
      } else {
        integrationChecks.push({
          step: "INTEGRATE",
          action: "SafeWork NSW Check Skipped",
          detail: "No card number extracted. Cannot verify against SafeWork NSW database.",
          status: "FLAG",
          timestamp: now(),
        });
        alerts.push({ severity: "WARNING", code: "INTEGRATE_NO_CARD", message: "White Card number not found. Manual verification required." });
      }
    }

    if (docDetect?.docType === "ABN_Registration" && resolvedRegion === "AU-NSW") {
      integrationChecks.push({
        step: "INTEGRATE",
        action: "ABR Lookup",
        detail: `Checking Australian Business Register for ABN... Entity active (simulated).`,
        status: "OK",
        timestamp: now(),
      });
      extractedData.abrStatus = "ACTIVE";
      extractedData.abrCheckedAt = now();
    }

    if (integrationChecks.length === 0) {
      integrationChecks.push({
        step: "INTEGRATE",
        action: "No External API Available",
        detail: `No automated verification endpoint configured for ${docDetect?.docType || "unknown"} in ${resolvedRegion}.`,
        status: "SKIP",
        timestamp: now(),
      });
    }

    pipeline.push(...integrationChecks);

    // === PERSIST — Save the document record ===
    let savedDoc = null;
    if (docDetect) {
      const [doc] = await db.insert(complianceDocsTable).values({
        entityType,
        entityId: eId,
        docType: docDetect.docType,
        docName: docDetect.label,
        issuer: null,
        docNumber: extractedAccount,
        issuedDate: null,
        expiryDate: extractedExpiry ? new Date(extractedExpiry) : null,
        status: alerts.some(a => a.severity === "CRITICAL") ? "rejected" : "pending",
        region: resolvedRegion,
        extractedData: Object.keys(extractedData).length > 0 ? extractedData : null,
        verificationMethod: "eyespyr-doc-scan",
        fileHash: null,
      }).returning();
      savedDoc = doc;
    }

    const hasCritical = alerts.some(a => a.severity === "CRITICAL");
    const hasWarning = alerts.some(a => a.severity === "WARNING");

    res.json({
      success: true,
      vaultId,
      wowId,
      verdict: hasCritical ? "FAIL" : hasWarning ? "REVIEW" : "PASS",
      pipeline,
      alerts,
      extracted: extractedData,
      region: resolvedRegion,
      docType: docDetect?.docType || null,
      docLabel: docDetect?.label || null,
      savedDocId: savedDoc?.id || null,
      retentionExpiry: new Date(Date.now() + 7 * 365.25 * 24 * 60 * 60 * 1000).toISOString(),
      simulated: true,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
