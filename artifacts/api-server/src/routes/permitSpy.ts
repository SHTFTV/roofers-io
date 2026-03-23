import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface PermitInspection {
  name: string;
  required: boolean;
  trigger: string;
  description: string;
}

interface ParsedPermit {
  permitNo: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  propertyAddress: string | null;
  applicant: string | null;
  contractor: string | null;
  permitType: string | null;
  jurisdiction: string | null;
  scopeOfWork: string[];
  inspections: PermitInspection[];
  warnings: string[];
  schedules: string[];
  conditions: string[];
  rawMatches: Record<string, string>;
}

function extractRegex(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? match[1]?.trim() || match[0]?.trim() : null;
}

function extractAllMatches(text: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  let m;
  const global = new RegExp(pattern.source, "gi");
  while ((m = global.exec(text)) !== null) {
    matches.push(m[1]?.trim() || m[0]?.trim());
  }
  return matches;
}

function extractDate(text: string, label: string): string | null {
  const patterns = [
    new RegExp(`${label}[:\\s]*([A-Z][a-z]+\\s+\\d{1,2},?\\s+\\d{4})`, "i"),
    new RegExp(`${label}[:\\s]*(\\d{4}-\\d{2}-\\d{2})`, "i"),
    new RegExp(`${label}[:\\s]*(\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4})`, "i"),
  ];
  for (const p of patterns) {
    const match = extractRegex(text, p);
    if (match) return match;
  }
  return null;
}

const HVAC_INSPECTIONS: Array<{
  name: string;
  triggers: string[];
  description: string;
}> = [
  {
    name: "Excavation/Base Inspection",
    triggers: ["subgrade", "excavation", "foundation", "footing", "base preparation"],
    description: "Required before backfill — verify subgrade compaction, depth, and drainage slope",
  },
  {
    name: "Drainage/Pipe Inspection",
    triggers: ["weeping tile", "drain pipe", "condensate line", "sewer connection", "pipe routing"],
    description: "Verify pipe sizing, slope, connection points, and condensate management",
  },
  {
    name: "Structural/Geogrid Inspection",
    triggers: ["schedule b", "structural", "geogrid", "load bearing", "support frame", "pad"],
    description: "Check equipment pad, structural supports, and load distribution per Schedule B",
  },
  {
    name: "Gas Line Inspection",
    triggers: ["gas line", "gas piping", "csst", "black iron", "gas meter", "pressure test", "gas train"],
    description: "Verify gas piping sizing, pressure test, drip leg, shut-off valve placement",
  },
  {
    name: "Electrical Rough-In",
    triggers: ["disconnect", "whip", "electrical panel", "breaker", "amperage", "circuit"],
    description: "Check disconnect box location, wire gauge, breaker sizing, and grounding",
  },
  {
    name: "Refrigerant Line Set",
    triggers: ["line set", "refrigerant", "lineset", "suction line", "liquid line", "r-410a", "r-22"],
    description: "Verify line set sizing, insulation, brazing quality, and nitrogen test",
  },
  {
    name: "Ductwork Inspection",
    triggers: ["duct", "ductwork", "supply air", "return air", "plenum", "flex duct"],
    description: "Check duct sizing, sealing, support spacing, and airflow design per Manual D",
  },
  {
    name: "Venting Inspection",
    triggers: ["venting", "flue pipe", "chimney", "b-vent", "power vent", "concentric vent", "exhaust vent"],
    description: "Verify vent pipe material, sizing, termination clearances, and slope",
  },
  {
    name: "Equipment Commissioning",
    triggers: ["commissioning", "startup", "start-up", "final inspection", "test and balance"],
    description: "Final equipment startup verification — airflow, charge, combustion analysis",
  },
  {
    name: "Insulation/Vapour Barrier",
    triggers: ["insulation", "vapour barrier", "vapor barrier", "r-value", "envelope"],
    description: "Check insulation R-value, vapour barrier continuity around HVAC penetrations",
  },
];

const SCOPE_KEYWORDS: Array<{ keyword: string; scope: string }> = [
  { keyword: "furnace", scope: "Furnace Installation/Replacement" },
  { keyword: "air conditioner", scope: "Air Conditioner Installation" },
  { keyword: "heat pump", scope: "Heat Pump Installation" },
  { keyword: "mini.?split", scope: "Mini-Split System" },
  { keyword: "boiler", scope: "Boiler Installation" },
  { keyword: "hot water", scope: "Hot Water Heater" },
  { keyword: "tankless", scope: "Tankless Water Heater" },
  { keyword: "hrv", scope: "HRV/ERV Installation" },
  { keyword: "erv", scope: "ERV Installation" },
  { keyword: "ductwork", scope: "Ductwork Modification" },
  { keyword: "gas.?line", scope: "Gas Line Work" },
  { keyword: "fireplace", scope: "Gas Fireplace" },
  { keyword: "radiant", scope: "Radiant Heating" },
  { keyword: "rooftop unit", scope: "Commercial Rooftop Unit" },
  { keyword: "rtu", scope: "Commercial Rooftop Unit" },
  { keyword: "make.?up air", scope: "Make-Up Air Unit" },
  { keyword: "exhaust fan", scope: "Exhaust Fan System" },
];

router.post("/permit-spy/analyze", (req, res): void => {
  const { text: permitText, tradeType = "hvac" } = req.body;

  if (!permitText || typeof permitText !== "string") {
    res.status(400).json({ error: "text field is required (extracted permit text)" });
    return;
  }

  const normalizedText = permitText.toLowerCase();
  const rawMatches: Record<string, string> = {};

  const permitNo = extractRegex(permitText, /Permit\s*(?:No|Number|#)[.:\s]*([A-Z0-9\-]+)/i);
  if (permitNo) rawMatches.permitNo = permitNo;

  const issueDate = extractDate(permitText, "Issue(?:d)?\\s*Date") || extractDate(permitText, "Date\\s*Issued");
  const expiryDate = extractDate(permitText, "Expir(?:y|ation)\\s*Date") || extractDate(permitText, "Valid\\s*Until");
  if (issueDate) rawMatches.issueDate = issueDate;
  if (expiryDate) rawMatches.expiryDate = expiryDate;

  const propertyAddress = extractRegex(permitText, /(?:Property|Site|Job)\s*Address[:\s]*([\w\s,.\-#]+?)(?:\n|$)/i);
  const applicant = extractRegex(permitText, /(?:Applicant|Owner)[:\s]*([\w\s.\-]+?)(?:\n|$)/i);
  const contractor = extractRegex(permitText, /(?:Contractor|Licensed\s*Contractor)[:\s]*([\w\s.\-&]+?)(?:\n|$)/i);
  const permitType = extractRegex(permitText, /(?:Permit\s*Type|Type\s*of\s*Permit)[:\s]*([\w\s.\-]+?)(?:\n|$)/i);

  const jurisdiction = extractRegex(permitText, /(?:Municipality|City|County|District|Regional\s*District)[:\s]*([\w\s.\-]+?)(?:\n|$)/i);

  const scopeOfWork: string[] = [];
  for (const kw of SCOPE_KEYWORDS) {
    if (new RegExp(kw.keyword, "i").test(normalizedText)) {
      scopeOfWork.push(kw.scope);
    }
  }

  const inspections: PermitInspection[] = [];
  for (const insp of HVAC_INSPECTIONS) {
    const required = insp.triggers.some(t => normalizedText.includes(t));
    inspections.push({
      name: insp.name,
      required,
      trigger: required ? insp.triggers.find(t => normalizedText.includes(t)) || "" : "",
      description: insp.description,
    });
  }

  const schedules = extractAllMatches(permitText, /Schedule\s+([A-Z0-9]+)/gi);
  const conditions: string[] = [];
  const conditionMatches = permitText.match(/(?:Condition|Note|Requirement)\s*\d*[:\s]*(.*?)(?:\n|$)/gi);
  if (conditionMatches) {
    for (const cm of conditionMatches) {
      const cleaned = cm.replace(/(?:Condition|Note|Requirement)\s*\d*[:\s]*/i, "").trim();
      if (cleaned.length > 5) conditions.push(cleaned);
    }
  }

  const warnings: string[] = [];

  if (expiryDate) {
    const expiry = new Date(expiryDate);
    const now = new Date();
    const daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry < 0) {
      warnings.push(`EXPIRED: Permit expired ${Math.abs(daysUntilExpiry)} days ago`);
    } else if (daysUntilExpiry < 30) {
      warnings.push(`EXPIRING SOON: Permit expires in ${daysUntilExpiry} days`);
    }
  } else {
    warnings.push("NO EXPIRY DATE FOUND: Could not parse expiry date from permit text");
  }

  if (!permitNo) {
    warnings.push("NO PERMIT NUMBER: Could not extract permit number");
  }

  const requiredInspections = inspections.filter(i => i.required);
  if (requiredInspections.length === 0) {
    warnings.push("NO INSPECTIONS TRIGGERED: Text may not contain standard HVAC scope keywords");
  }

  if (normalizedText.includes("asbestos") || normalizedText.includes("hazardous")) {
    warnings.push("HAZARDOUS MATERIAL WARNING: Permit references asbestos or hazardous materials");
  }

  const result: ParsedPermit = {
    permitNo,
    issueDate,
    expiryDate,
    propertyAddress,
    applicant,
    contractor,
    permitType,
    jurisdiction,
    scopeOfWork: [...new Set(scopeOfWork)],
    inspections,
    warnings,
    schedules: [...new Set(schedules)],
    conditions,
    rawMatches,
  };

  res.json({
    success: true,
    tradeType,
    permit: result,
    summary: {
      permitNo: result.permitNo || "NOT FOUND",
      expiry: result.expiryDate || "NOT FOUND",
      requiredInspections: requiredInspections.length,
      totalInspections: inspections.length,
      scopeItems: scopeOfWork.length,
      warningCount: warnings.length,
      schedulesFound: schedules.length,
    },
    milestones: requiredInspections.map((insp, idx) => ({
      order: idx + 1,
      name: insp.name,
      trigger: insp.trigger,
      description: insp.description,
      status: "pending",
    })),
  });
});

router.get("/permit-spy/inspection-types", (_req, res): void => {
  res.json({
    tradeType: "hvac",
    inspections: HVAC_INSPECTIONS.map(i => ({
      name: i.name,
      triggers: i.triggers,
      description: i.description,
    })),
    scopeKeywords: SCOPE_KEYWORDS.map(k => ({
      keyword: k.keyword,
      scope: k.scope,
    })),
  });
});

export default router;
