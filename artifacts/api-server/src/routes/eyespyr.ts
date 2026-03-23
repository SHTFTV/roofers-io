import { Router, type IRouter } from "express";
import multer from "multer";
import crypto from "crypto";
import { db, truthVaultRecordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const TRADE_MODELS: Record<string, { modelId: string; scanTypes: string[] }> = {
  roofing: {
    modelId: "nail-pattern-verify/4",
    scanTypes: ["Nail Pattern", "Flashing Check", "Shingle Alignment", "Ice Shield Verify"],
  },
  framing: {
    modelId: "stud-spacing-check/2",
    scanTypes: ["Stud Spacing", "Point Load", "Shear Wall Nailing", "Header Verify"],
  },
  electrical: {
    modelId: "breaker-panel-audit/1",
    scanTypes: ["Panel Audit", "Wire Gauge Check", "Staple Depth", "Box Fill", "Arc Fault"],
  },
  plumbing: {
    modelId: "pipe-joint-check/2",
    scanTypes: ["Joint Integrity", "Moisture Detection", "Slope Verify", "DFU Check"],
  },
  gasfitting: {
    modelId: "gas-vent-audit/1",
    scanTypes: ["Venting Audit", "Manifold Check", "Clearance Verify", "Leak Test"],
  },
  hvac: {
    modelId: "duct-seal-check/1",
    scanTypes: ["Duct Sealing", "Thermostat Wiring", "Refrigerant Lines", "Airflow Verify"],
  },
  plowwow: {
    modelId: "snow-clearance-v2/1",
    scanTypes: ["Clearance Verify", "Salt Coverage", "Ice Check", "Site-View"],
  },
  hardscaping: {
    modelId: "hardscape-audit/1",
    scanTypes: ["Wall Inspection", "Paver Base Check", "Geogrid Verify", "Turf Seam Audit", "Compaction Test"],
  },
  drywall: {
    modelId: "drywall-finish-check/1",
    scanTypes: ["Wall Inspection", "Joint Compound Check", "Board Condition", "Fire Assembly Verify", "Moisture Check"],
  },
};

function generateVaultId(imageHash: string, tradeType: string, projectId: number): string {
  const input = `${imageHash}:${tradeType}:${projectId}:${Date.now()}`;
  return "TV-" + crypto.createHash("sha256").update(input).digest("hex").substring(0, 16).toUpperCase();
}

function generateWowId(): string {
  return "WOW-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

function hashImage(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function callRoboflow(
  imageBase64: string,
  modelId: string,
  apiKey: string
): Promise<{ predictions: Array<{ class: string; confidence: number; x: number; y: number; width: number; height: number }> }> {
  const [modelName, version] = modelId.split("/");
  const url = `https://detect.roboflow.com/${modelName}/${version}?api_key=${apiKey}&confidence=40&overlap=30`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: imageBase64,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Roboflow API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<{ predictions: Array<{ class: string; confidence: number; x: number; y: number; width: number; height: number }> }>;
}

function determineVerdict(predictions: Array<{ class: string; confidence: number }>): { verdict: string; confidence: number } {
  if (predictions.length === 0) {
    return { verdict: "REVIEW", confidence: 0 };
  }

  const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
  const hasFailures = predictions.some((p) => p.class.toLowerCase().includes("fail") || p.class.toLowerCase().includes("violation") || p.class.toLowerCase().includes("defect"));

  if (hasFailures) {
    return { verdict: "FAIL", confidence: avgConfidence };
  }

  if (avgConfidence >= 0.7) {
    return { verdict: "PASS", confidence: avgConfidence };
  }

  return { verdict: "REVIEW", confidence: avgConfidence };
}

router.get("/eyespyr/models", (_req, res): void => {
  const models = Object.entries(TRADE_MODELS).map(([trade, config]) => ({
    trade,
    modelId: config.modelId,
    scanTypes: config.scanTypes,
  }));
  res.json({ models });
});

router.post("/eyespyr/scan", upload.single("image"), async (req, res): Promise<void> => {
  const { tradeType, scanType, projectId } = req.body;

  if (!tradeType || !scanType || !projectId) {
    res.status(400).json({ error: "Missing required fields: tradeType, scanType, projectId" });
    return;
  }

  const tradeConfig = TRADE_MODELS[tradeType.toLowerCase()];
  if (!tradeConfig) {
    res.status(400).json({ error: `Unknown trade type: ${tradeType}. Valid: ${Object.keys(TRADE_MODELS).join(", ")}` });
    return;
  }

  if (!tradeConfig.scanTypes.includes(scanType)) {
    res.status(400).json({ error: `Invalid scan type for ${tradeType}. Valid: ${tradeConfig.scanTypes.join(", ")}` });
    return;
  }

  const apiKey = process.env.ROBOFLOW_API_KEY;
  const file = req.file;

  let detections: Array<{ class: string; confidence: number; x: number; y: number; width: number; height: number }> = [];
  let imageHash = "";
  let usedSimulation = false;

  if (file) {
    imageHash = hashImage(file.buffer);

    if (apiKey) {
      try {
        const imageBase64 = file.buffer.toString("base64");
        const result = await callRoboflow(imageBase64, tradeConfig.modelId, apiKey);
        detections = result.predictions;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`Roboflow API error: ${errorMessage}`);
        res.status(502).json({ error: `Vision AI error: ${errorMessage}` });
        return;
      }
    } else {
      usedSimulation = true;
      const simCount = Math.floor(Math.random() * 4) + 1;
      for (let i = 0; i < simCount; i++) {
        detections.push({
          class: `${scanType.toLowerCase().replace(/\s/g, "-")}-check`,
          confidence: 0.75 + Math.random() * 0.2,
          x: Math.random() * 500,
          y: Math.random() * 500,
          width: 50 + Math.random() * 100,
          height: 50 + Math.random() * 100,
        });
      }
    }
  } else {
    usedSimulation = true;
    imageHash = crypto.randomBytes(32).toString("hex");
    detections = [
      {
        class: `${scanType.toLowerCase().replace(/\s/g, "-")}-check`,
        confidence: 0.82 + Math.random() * 0.15,
        x: 250,
        y: 250,
        width: 100,
        height: 100,
      },
    ];
  }

  const { verdict, confidence } = determineVerdict(detections);

  const vaultId = generateVaultId(imageHash, tradeType, parseInt(projectId));
  const wowId = generateWowId();

  const retentionExpiry = new Date();
  retentionExpiry.setFullYear(retentionExpiry.getFullYear() + 7);

  try {
    const [record] = await db
      .insert(truthVaultRecordsTable)
      .values({
        vaultId,
        wowId,
        tradeType: tradeType.toLowerCase(),
        projectId: parseInt(projectId),
        projectTable: getProjectTable(tradeType),
        scanType,
        imageHash,
        modelId: tradeConfig.modelId,
        verdict,
        confidence,
        detections,
        metadata: {
          fileName: file?.originalname || "simulation",
          fileSize: file?.size || 0,
          mimeType: file?.mimetype || "image/jpeg",
          simulated: usedSimulation,
          timestamp: new Date().toISOString(),
        },
        retentionExpiry,
        immutable: true,
      })
      .returning();

    res.status(201).json({
      success: true,
      scan: {
        vaultId: record.vaultId,
        wowId: record.wowId,
        verdict: record.verdict,
        confidence: record.confidence,
        scanType: record.scanType,
        tradeType: record.tradeType,
        detections: record.detections,
        retentionExpiry: record.retentionExpiry.toISOString(),
        simulated: usedSimulation,
        createdAt: record.createdAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`Truth-Vault storage error: ${errorMessage}`);
    res.status(500).json({ error: "Failed to store scan in Truth-Vault" });
  }
});

router.get("/eyespyr/vault/:lookupId", async (req, res): Promise<void> => {
  const { lookupId } = req.params;

  const isWow = lookupId.startsWith("WOW-");
  const [record] = await db
    .select()
    .from(truthVaultRecordsTable)
    .where(
      isWow
        ? eq(truthVaultRecordsTable.wowId, lookupId)
        : eq(truthVaultRecordsTable.vaultId, lookupId)
    );

  if (!record) {
    res.status(404).json({ error: "Vault record not found" });
    return;
  }

  res.json({
    vaultId: record.vaultId,
    wowId: record.wowId,
    verdict: record.verdict,
    confidence: record.confidence,
    scanType: record.scanType,
    tradeType: record.tradeType,
    detections: record.detections,
    imageHash: record.imageHash,
    modelId: record.modelId,
    retentionExpiry: record.retentionExpiry.toISOString(),
    immutable: record.immutable,
    createdAt: record.createdAt.toISOString(),
  });
});

router.get("/eyespyr/vault/project/:projectId", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const tradeType = (req.query.trade as string) || undefined;

  let query = db
    .select()
    .from(truthVaultRecordsTable)
    .where(eq(truthVaultRecordsTable.projectId, projectId));

  const records = await query;

  const filtered = tradeType
    ? records.filter((r) => r.tradeType === tradeType.toLowerCase())
    : records;

  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({
    projectId,
    totalScans: filtered.length,
    passCount: filtered.filter((r) => r.verdict === "PASS").length,
    failCount: filtered.filter((r) => r.verdict === "FAIL").length,
    reviewCount: filtered.filter((r) => r.verdict === "REVIEW").length,
    records: filtered.map((r) => ({
      vaultId: r.vaultId,
      wowId: r.wowId,
      verdict: r.verdict,
      confidence: r.confidence,
      scanType: r.scanType,
      tradeType: r.tradeType,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

function getProjectTable(tradeType: string): string {
  const mapping: Record<string, string> = {
    roofing: "jobs",
    framing: "framing_projects",
    electrical: "electrical_projects",
    plumbing: "plumbing_projects",
    gasfitting: "gasfitting_projects",
    hvac: "hvac_projects",
    plowwow: "plowwow_projects",
    hardscaping: "hardscaping_projects",
  };
  return mapping[tradeType.toLowerCase()] || "unknown";
}

export default router;
