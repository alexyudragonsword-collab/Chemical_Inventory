// Development / demo seed. Assumes a fresh database (guarded: no-op when data
// exists). All demo accounts share the password "chemtrack-demo".

import { CanonicalUnit, GhsPictogram, PrismaClient, Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { writeAuditEvent } from "../src/server/audit";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "chemtrack-demo";

// Storage classes used by the compatibility matrix.
const SC = {
  FLAMMABLE: "FLAMMABLE",
  OXIDISER: "OXIDISER",
  ACID: "ACID",
  BASE: "BASE",
  TOXIC: "TOXIC",
  WATER_REACTIVE: "WATER_REACTIVE",
  GENERAL: "GENERAL",
} as const;

// Deck slide 16 segregation matrix (symmetric; missing pair = COMPATIBLE).
const MATRIX: [string, string, "COMPATIBLE" | "SEGREGATE" | "NEVER_TOGETHER"][] = [
  [SC.FLAMMABLE, SC.FLAMMABLE, "COMPATIBLE"],
  [SC.FLAMMABLE, SC.OXIDISER, "NEVER_TOGETHER"],
  [SC.FLAMMABLE, SC.ACID, "NEVER_TOGETHER"],
  [SC.FLAMMABLE, SC.BASE, "SEGREGATE"],
  [SC.FLAMMABLE, SC.TOXIC, "COMPATIBLE"],
  [SC.FLAMMABLE, SC.WATER_REACTIVE, "NEVER_TOGETHER"],
  [SC.OXIDISER, SC.OXIDISER, "COMPATIBLE"],
  [SC.OXIDISER, SC.ACID, "NEVER_TOGETHER"],
  [SC.OXIDISER, SC.BASE, "NEVER_TOGETHER"],
  [SC.OXIDISER, SC.TOXIC, "SEGREGATE"],
  [SC.OXIDISER, SC.WATER_REACTIVE, "NEVER_TOGETHER"],
  [SC.ACID, SC.ACID, "COMPATIBLE"],
  [SC.ACID, SC.BASE, "NEVER_TOGETHER"],
  [SC.ACID, SC.TOXIC, "SEGREGATE"],
  [SC.ACID, SC.WATER_REACTIVE, "NEVER_TOGETHER"],
  [SC.BASE, SC.BASE, "COMPATIBLE"],
  [SC.BASE, SC.TOXIC, "SEGREGATE"],
  [SC.BASE, SC.WATER_REACTIVE, "SEGREGATE"],
  [SC.TOXIC, SC.TOXIC, "COMPATIBLE"],
  [SC.TOXIC, SC.WATER_REACTIVE, "SEGREGATE"],
  [SC.WATER_REACTIVE, SC.WATER_REACTIVE, "COMPATIBLE"],
];

const H_STATEMENTS: [string, string, string?][] = [
  ["H225", "Highly flammable liquid and vapour", "Flam. Liq. 2"],
  ["H226", "Flammable liquid and vapour", "Flam. Liq. 3"],
  ["H260", "In contact with water releases flammable gases which may ignite spontaneously", "Water-react. 1"],
  ["H271", "May cause fire or explosion; strong oxidiser", "Ox. Liq. 1"],
  ["H272", "May intensify fire; oxidiser", "Ox. Sol. 2"],
  ["H290", "May be corrosive to metals", "Met. Corr. 1"],
  ["H300", "Fatal if swallowed", "Acute Tox. 2"],
  ["H301", "Toxic if swallowed", "Acute Tox. 3"],
  ["H302", "Harmful if swallowed", "Acute Tox. 4"],
  ["H310", "Fatal in contact with skin", "Acute Tox. 2"],
  ["H311", "Toxic in contact with skin", "Acute Tox. 3"],
  ["H312", "Harmful in contact with skin", "Acute Tox. 4"],
  ["H314", "Causes severe skin burns and eye damage", "Skin Corr. 1A"],
  ["H315", "Causes skin irritation", "Skin Irrit. 2"],
  ["H318", "Causes serious eye damage", "Eye Dam. 1"],
  ["H319", "Causes serious eye irritation", "Eye Irrit. 2"],
  ["H330", "Fatal if inhaled", "Acute Tox. 2"],
  ["H331", "Toxic if inhaled", "Acute Tox. 3"],
  ["H335", "May cause respiratory irritation", "STOT SE 3"],
  ["H336", "May cause drowsiness or dizziness", "STOT SE 3"],
  ["H350", "May cause cancer", "Carc. 1B"],
  ["H360", "May damage fertility or the unborn child", "Repr. 1B"],
  ["H370", "Causes damage to organs", "STOT SE 1"],
  ["H373", "May cause damage to organs through prolonged or repeated exposure", "STOT RE 2"],
  ["H400", "Very toxic to aquatic life", "Aquatic Acute 1"],
  ["H411", "Toxic to aquatic life with long lasting effects", "Aquatic Chronic 2"],
];

const P_STATEMENTS: [string, string][] = [
  ["P210", "Keep away from heat, hot surfaces, sparks, open flames and other ignition sources. No smoking."],
  ["P233", "Keep container tightly closed."],
  ["P260", "Do not breathe dust/fume/gas/mist/vapours/spray."],
  ["P280", "Wear protective gloves/protective clothing/eye protection/face protection."],
  ["P301+P310", "IF SWALLOWED: Immediately call a POISON CENTER/doctor."],
  ["P302+P352", "IF ON SKIN: Wash with plenty of water."],
  ["P305+P351+P338", "IF IN EYES: Rinse cautiously with water for several minutes. Remove contact lenses, if present and easy to do. Continue rinsing."],
  ["P403+P235", "Store in a well-ventilated place. Keep cool."],
  ["P501", "Dispose of contents/container in accordance with local regulations."],
];

const PERMIT_CATEGORIES: [string, string][] = [
  ["HS", "Hazardous Substances"],
  ["CW", "Chemical Weapons Convention Chemicals"],
  ["SCDF", "SCDF Petroleum & Flammable Materials"],
  ["AFI", "AFI & HC1-HC4.3"],
];

type SubstanceSeed = {
  key: string;
  name: string;
  cas: string;
  storageClass: string;
  pictograms: GhsPictogram[];
  signalWord: "DANGER" | "WARNING" | "NONE";
  h: string[];
  legacyHazard?: string;
  minStock?: { level: number; unit: CanonicalUnit };
  controlled?: boolean;
};

const SUBSTANCES: SubstanceSeed[] = [
  { key: "acetone", name: "Acetone, ACS reagent", cas: "67-64-1", storageClass: SC.FLAMMABLE, pictograms: ["GHS02_FLAMMABLE", "GHS07_IRRITANT"], signalWord: "DANGER", h: ["H225", "H319", "H336"], legacyHazard: "3", minStock: { level: 4000, unit: "ML" } },
  { key: "acetonitrile", name: "Acetonitrile, HPLC grade", cas: "75-05-8", storageClass: SC.FLAMMABLE, pictograms: ["GHS02_FLAMMABLE", "GHS07_IRRITANT"], signalWord: "DANGER", h: ["H225", "H302", "H312", "H319"], legacyHazard: "3", minStock: { level: 500, unit: "ML" } },
  { key: "dcm", name: "Dichloromethane", cas: "75-09-2", storageClass: SC.TOXIC, pictograms: ["GHS07_IRRITANT", "GHS08_HEALTH_HAZARD"], signalWord: "WARNING", h: ["H315", "H319", "H336", "H350"], legacyHazard: "6.1" },
  { key: "naoh", name: "Sodium hydroxide, pellets", cas: "1310-73-2", storageClass: SC.BASE, pictograms: ["GHS05_CORROSIVE"], signalWord: "DANGER", h: ["H290", "H314"], legacyHazard: "8", minStock: { level: 500, unit: "G" } },
  { key: "nabh4", name: "Sodium borohydride, ≥98%", cas: "16940-66-2", storageClass: SC.WATER_REACTIVE, pictograms: ["GHS02_FLAMMABLE", "GHS05_CORROSIVE", "GHS06_TOXIC"], signalWord: "DANGER", h: ["H260", "H301", "H314"], legacyHazard: "4.3" },
  { key: "etoac", name: "Ethyl acetate", cas: "141-78-6", storageClass: SC.FLAMMABLE, pictograms: ["GHS02_FLAMMABLE", "GHS07_IRRITANT"], signalWord: "DANGER", h: ["H225", "H319", "H336"], legacyHazard: "3" },
  { key: "toluene", name: "Toluene, anhydrous 99.8%", cas: "108-88-3", storageClass: SC.FLAMMABLE, pictograms: ["GHS02_FLAMMABLE", "GHS07_IRRITANT", "GHS08_HEALTH_HAZARD"], signalWord: "DANGER", h: ["H225", "H315", "H336", "H361", "H373"].filter((c) => c !== "H361"), legacyHazard: "3" },
  { key: "nitric", name: "Nitric acid, 68%", cas: "7697-37-2", storageClass: SC.OXIDISER, pictograms: ["GHS03_OXIDISER", "GHS05_CORROSIVE", "GHS06_TOXIC"], signalWord: "DANGER", h: ["H271", "H290", "H314", "H331"], legacyHazard: "8" },
  { key: "ether", name: "Diethyl ether", cas: "60-29-7", storageClass: SC.FLAMMABLE, pictograms: ["GHS02_FLAMMABLE", "GHS07_IRRITANT"], signalWord: "DANGER", h: ["H225", "H302", "H336"], legacyHazard: "3" },
  { key: "methanol", name: "Methanol, ACS reagent", cas: "67-56-1", storageClass: SC.FLAMMABLE, pictograms: ["GHS02_FLAMMABLE", "GHS06_TOXIC", "GHS08_HEALTH_HAZARD"], signalWord: "DANGER", h: ["H225", "H301", "H311", "H331", "H370"], legacyHazard: "3", minStock: { level: 4000, unit: "ML" } },
  { key: "hexane", name: "Hexane, 95%", cas: "110-54-3", storageClass: SC.FLAMMABLE, pictograms: ["GHS02_FLAMMABLE", "GHS07_IRRITANT", "GHS08_HEALTH_HAZARD", "GHS09_ENVIRONMENT"], signalWord: "DANGER", h: ["H225", "H315", "H336", "H373", "H411"], legacyHazard: "3" },
  { key: "ipa", name: "2-Propanol (Isopropanol)", cas: "67-63-0", storageClass: SC.FLAMMABLE, pictograms: ["GHS02_FLAMMABLE", "GHS07_IRRITANT"], signalWord: "DANGER", h: ["H225", "H319", "H336"], legacyHazard: "3" },
  { key: "chloroform", name: "Chloroform, stabilised", cas: "67-66-3", storageClass: SC.TOXIC, pictograms: ["GHS06_TOXIC", "GHS08_HEALTH_HAZARD"], signalWord: "DANGER", h: ["H302", "H315", "H331", "H350", "H373"], legacyHazard: "6.1" },
  { key: "aceticacid", name: "Acetic acid, glacial", cas: "64-19-7", storageClass: SC.ACID, pictograms: ["GHS02_FLAMMABLE", "GHS05_CORROSIVE"], signalWord: "DANGER", h: ["H226", "H314"], legacyHazard: "8" },
  { key: "kmno4", name: "Potassium permanganate", cas: "7722-64-7", storageClass: SC.OXIDISER, pictograms: ["GHS03_OXIDISER", "GHS07_IRRITANT", "GHS09_ENVIRONMENT"], signalWord: "DANGER", h: ["H272", "H302", "H400", "H411"], legacyHazard: "5.1" },
  { key: "kcn", name: "Potassium cyanide", cas: "151-50-8", storageClass: SC.TOXIC, pictograms: ["GHS06_TOXIC", "GHS08_HEALTH_HAZARD", "GHS09_ENVIRONMENT"], signalWord: "DANGER", h: ["H300", "H310", "H330", "H370", "H400"], legacyHazard: "6.1", controlled: true },
];

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log("Database already seeded — skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // --- Reference data -------------------------------------------------------
  for (const [code, text, cat] of H_STATEMENTS) {
    await prisma.hStatement.create({ data: { code, text, hazardCategory: cat ?? null } });
  }
  for (const [code, text] of P_STATEMENTS) {
    await prisma.pStatement.create({ data: { code, text } });
  }
  for (const [a, b, verdict] of MATRIX) {
    const [classA, classB] = [a, b].sort();
    await prisma.compatibilityRule.upsert({
      where: { classA_classB: { classA, classB } },
      update: { verdict },
      create: { classA, classB, verdict },
    });
  }
  const permits: Record<string, string> = {};
  for (const [code, name] of PERMIT_CATEGORIES) {
    const p = await prisma.permitCategory.create({ data: { code, name } });
    permits[code] = p.id;
  }
  for (const [code, name] of [
    ["44-B", "Suzuki coupling"],
    ["12-A", "Perovskite films"],
    ["TEACH-1", "Undergraduate teaching lab"],
  ] as const) {
    await prisma.project.create({ data: { code, name } });
  }

  // --- Places ---------------------------------------------------------------
  const north = await prisma.site.create({ data: { name: "North Campus" } });
  const south = await prisma.site.create({ data: { name: "South Campus" } });

  const b214 = await prisma.lab.create({
    data: { siteId: north.id, code: "B2-14", name: "Organic Synthesis" },
  });
  const a107 = await prisma.lab.create({
    data: { siteId: north.id, code: "A1-07", name: "Materials Chemistry" },
  });
  const c302 = await prisma.lab.create({
    data: { siteId: south.id, code: "C3-02", name: "Analytical Chemistry" },
  });
  const d111 = await prisma.lab.create({
    data: { siteId: south.id, code: "D1-11", name: "Teaching Laboratory" },
  });

  await prisma.alertThresholdSetting.create({ data: { labId: b214.id } });

  async function cabinet(labId: string, code: string, name: string, kind: "CABINET" | "FRIDGE" | "SHELF", maxVolumeL?: number, shelves = 0) {
    const cab = await prisma.storageLocation.create({
      data: { labId, code, name, kind, maxVolumeL: maxVolumeL ? new Prisma.Decimal(maxVolumeL) : null },
    });
    const children = [];
    for (let i = 1; i <= shelves; i++) {
      children.push(
        await prisma.storageLocation.create({
          data: { labId, parentId: cab.id, code: `${code}/S${i}`, name: `Shelf ${i}`, kind: "SHELF", capacity: 20 },
        }),
      );
    }
    return { cab, children };
  }

  const fc1 = await cabinet(b214.id, "FC-1", "Flammables cabinet FC-1", "CABINET", 50, 2);
  const fc2 = await cabinet(b214.id, "FC-2", "Flammables cabinet FC-2", "CABINET", 50, 2);
  const ac2 = await cabinet(b214.id, "AC-2", "Acid cabinet AC-2", "CABINET", 30, 2);
  const bc1 = await cabinet(b214.id, "BC-1", "Base cabinet BC-1", "CABINET", 30, 1);
  const s1 = await cabinet(b214.id, "S-1", "Ambient shelf S-1", "SHELF", undefined, 0);
  const cr1 = await cabinet(b214.id, "CR-1", "Cold room CR-1", "FRIDGE", undefined, 0);
  const sc4 = await cabinet(a107.id, "SC-4", "Solvent cabinet SC-4", "CABINET", 50, 2);
  const fc3 = await cabinet(a107.id, "FC-3", "Flammables cabinet FC-3", "CABINET", 50, 1);
  const an1 = await cabinet(c302.id, "AN-1", "Analytical store AN-1", "CABINET", 30, 1);
  const t1 = await cabinet(d111.id, "T-1", "Teaching store T-1", "CABINET", 40, 1);
  const poison = await cabinet(b214.id, "PC-1", "Poisons cabinet PC-1 (licensed)", "CABINET", 10, 0);

  // --- Users ----------------------------------------------------------------
  async function user(email: string, name: string, role: Role, labs: { labId: string; isManager?: boolean }[]) {
    return prisma.user.create({
      data: {
        email,
        name,
        role,
        passwordHash,
        labMemberships: {
          create: labs.map((l) => ({ labId: l.labId, isManager: l.isManager ?? false })),
        },
      },
    });
  }

  const admin = await user("admin@lab.internal", "A. Admin", "ADMIN", []);
  const liwei = await user("li.wei@lab.internal", "Li Wei", "LAB_MANAGER", [
    { labId: b214.id, isManager: true },
  ]);
  const mtan = await user("m.tan@lab.internal", "M. Tan", "CUSTODIAN", [{ labId: b214.id }]);
  const riyer = await user("r.iyer@lab.internal", "R. Iyer", "LAB_USER", [{ labId: b214.id }]);
  const ehs = await user("ehs@lab.internal", "K. Osei", "EHS_OFFICER", [
    { labId: b214.id },
    { labId: a107.id },
  ]);
  await user("viewer@lab.internal", "V. Ng", "VIEWER", []);
  const rahman = await user("m.rahman@lab.internal", "M. Rahman", "LAB_MANAGER", [
    { labId: a107.id, isManager: true },
  ]);
  const kaur = await user("s.kaur@lab.internal", "S. Kaur", "LAB_MANAGER", [
    { labId: c302.id, isManager: true },
  ]);
  const lim = await user("j.lim@lab.internal", "J. Lim", "LAB_MANAGER", [
    { labId: d111.id, isManager: true },
  ]);

  // --- Substances -----------------------------------------------------------
  const substances: Record<string, { id: string; controlled: boolean }> = {};
  for (const s of SUBSTANCES) {
    const created = await prisma.substance.create({
      data: {
        name: s.name,
        casNumber: s.cas,
        legacyHazardCode: s.legacyHazard ?? null,
        isControlled: s.controlled ?? false,
        minStockLevel: s.minStock ? new Prisma.Decimal(s.minStock.level) : null,
        minStockUnit: s.minStock?.unit ?? null,
        ghs: {
          create: {
            pictograms: s.pictograms,
            signalWord: s.signalWord,
            storageClass: s.storageClass,
            hStatements: {
              create: s.h.map((code) => ({ hCode: code, source: "SUPPLIER_SDS" as const })),
            },
            pStatements: {
              create: ["P210", "P280"].map((code) => ({ pCode: code, source: "AUTO_DERIVED" as const })),
            },
          },
        },
      },
    });
    substances[s.key] = { id: created.id, controlled: s.controlled ?? false };
  }

  // --- Containers (created through the audit chain, like a real check-in) ---
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  type ContainerSeed = {
    code: string;
    substance: string;
    labId: string;
    locationId: string | null;
    custodianId: string | null;
    qty: number;
    initial: number;
    unit: CanonicalUnit;
    lot?: string;
    expiryDays?: number; // relative to now; negative = already expired
    status?: "ACTIVE" | "EMPTY";
    pending?: Record<string, string>;
    permits?: string[];
  };

  const CONTAINERS: ContainerSeed[] = [
    // Li Wei's custody in B2-14 — the demo core loop
    { code: "B2-14-C03", substance: "acetone", labId: b214.id, locationId: fc1.children[0].id, custodianId: liwei.id, qty: 1900, initial: 2500, unit: "ML", lot: "23K-4410", expiryDays: 6, permits: ["HS", "SCDF"] },
    { code: "B2-14-C04", substance: "acetone", labId: b214.id, locationId: fc1.children[0].id, custodianId: liwei.id, qty: 2500, initial: 2500, unit: "ML", lot: "23K-4411", expiryDays: 200, permits: ["HS", "SCDF"] },
    { code: "B2-14-A11", substance: "acetonitrile", labId: b214.id, locationId: fc1.children[1].id, custodianId: liwei.id, qty: 1450, initial: 2500, unit: "ML", lot: "SHBN1122", expiryDays: 210, permits: ["SCDF"] },
    { code: "B2-14-A12", substance: "acetonitrile", labId: b214.id, locationId: fc1.children[1].id, custodianId: liwei.id, qty: 2500, initial: 2500, unit: "ML", lot: "SHBN1188", expiryDays: 530, permits: ["SCDF"] },
    { code: "B2-14-C02", substance: "dcm", labId: b214.id, locationId: fc2.children[0].id, custodianId: liwei.id, qty: 2300, initial: 2500, unit: "ML", lot: "MKCV1093", expiryDays: 140, permits: ["HS"] },
    { code: "B2-14-D01", substance: "naoh", labId: b214.id, locationId: bc1.children[0].id, custodianId: liwei.id, qty: 180, initial: 500, unit: "G", lot: "20250120", expiryDays: 640, permits: ["HS"] },
    { code: "B2-14-D07", substance: "nabh4", labId: b214.id, locationId: fc1.children[1].id, custodianId: mtan.id, qty: 350, initial: 500, unit: "G", lot: "24A-9911", expiryDays: 390, permits: ["AFI"] },
    { code: "B2-14-A03", substance: "etoac", labId: b214.id, locationId: fc1.children[0].id, custodianId: liwei.id, qty: 3000, initial: 4000, unit: "ML", lot: "23K-5502", expiryDays: 290, permits: ["SCDF"] },
    { code: "B2-14-B04", substance: "toluene", labId: b214.id, locationId: fc2.children[0].id, custodianId: liwei.id, qty: 600, initial: 1000, unit: "ML", lot: "STBC0071", expiryDays: 24, permits: ["SCDF"] },
    { code: "B2-14-S112", substance: "methanol", labId: b214.id, locationId: s1.cab.id, custodianId: mtan.id, qty: 1000, initial: 4000, unit: "ML", lot: "I0855", expiryDays: 180, permits: ["SCDF"] },
    { code: "B2-14-S108", substance: "hexane", labId: b214.id, locationId: s1.cab.id, custodianId: mtan.id, qty: 1800, initial: 2500, unit: "ML", lot: "STBB9917", expiryDays: 260, permits: ["SCDF"] },
    { code: "B2-14-S104", substance: "ipa", labId: b214.id, locationId: s1.cab.id, custodianId: liwei.id, qty: 500, initial: 500, unit: "ML", lot: "SHBM4410", expiryDays: 410, permits: ["SCDF"] },
    // The deliberate compatibility conflict: an oxidising acid in FC-1
    { code: "B2-14-N01", substance: "nitric", labId: b214.id, locationId: fc1.children[1].id, custodianId: liwei.id, qty: 2500, initial: 2500, unit: "ML", lot: "K51124790", expiryDays: 300, permits: ["HS"] },
    // Expired ether (peroxide risk) + expired chloroform
    { code: "B2-14-S099", substance: "ether", labId: b214.id, locationId: s1.cab.id, custodianId: liwei.id, qty: 1000, initial: 1000, unit: "ML", lot: "STBH2201", expiryDays: -12, permits: ["SCDF"] },
    { code: "B2-14-C11", substance: "chloroform", labId: b214.id, locationId: cr1.cab.id, custodianId: liwei.id, qty: 900, initial: 2500, unit: "ML", lot: "MKCT7710", expiryDays: -3, permits: ["HS"] },
    { code: "B2-14-AC1", substance: "aceticacid", labId: b214.id, locationId: ac2.children[0].id, custodianId: mtan.id, qty: 2500, initial: 2500, unit: "ML", lot: "F044721", expiryDays: 520, permits: ["HS"] },
    // Controlled substance in the poisons cabinet
    { code: "B2-14-P01", substance: "kcn", labId: b214.id, locationId: poison.cab.id, custodianId: liwei.id, qty: 100, initial: 100, unit: "G", lot: "TCI-88112", expiryDays: 900, permits: ["HS", "CW"] },
    // Empty container awaiting disposal
    { code: "B2-14-B08", substance: "acetonitrile", labId: b214.id, locationId: null, custodianId: liwei.id, qty: 0, initial: 2500, unit: "ML", lot: "SHBK0033", expiryDays: 30, status: "EMPTY", permits: ["SCDF"] },
    // Pending-correction container (legacy-import shape)
    { code: "B2-14-X01", substance: "kmno4", labId: b214.id, locationId: null, custodianId: null, qty: 500, initial: 500, unit: "G", lot: "-", expiryDays: 700, pending: { custodian: "Pending for Correction", rawLocation: "R2-" }, permits: ["AFI"] },
    // A1-07 (M. Rahman's lab) — cross-lab lookup data
    { code: "A1-07-B12", substance: "toluene", labId: a107.id, locationId: fc3.children[0].id, custodianId: rahman.id, qty: 600, initial: 1000, unit: "ML", lot: "STBC3927", expiryDays: 240, permits: ["SCDF"] },
    { code: "A1-07-B13", substance: "toluene", labId: a107.id, locationId: fc3.children[0].id, custodianId: rahman.id, qty: 2500, initial: 2500, unit: "ML", lot: "STBD1010", expiryDays: 500, permits: ["SCDF"] },
    { code: "A1-07-B15", substance: "toluene", labId: a107.id, locationId: fc3.children[0].id, custodianId: rahman.id, qty: 1800, initial: 2500, unit: "ML", lot: "STBB0083", expiryDays: 460, permits: ["SCDF"] },
    { code: "A1-07-A02", substance: "acetonitrile", labId: a107.id, locationId: sc4.children[0].id, custodianId: rahman.id, qty: 900, initial: 4000, unit: "ML", lot: "SHBF8967", expiryDays: 90, permits: ["SCDF"] },
    { code: "A1-07-S01", substance: "methanol", labId: a107.id, locationId: sc4.children[0].id, custodianId: rahman.id, qty: 4000, initial: 4000, unit: "ML", lot: "I0901", expiryDays: 350, permits: ["SCDF"] },
    // C3-02 and D1-11 — more cross-lab holdings
    { code: "C3-02-B08", substance: "acetonitrile", labId: c302.id, locationId: an1.children[0].id, custodianId: kaur.id, qty: 0, initial: 2500, unit: "ML", lot: "SHBB1279", expiryDays: 12, status: "EMPTY", permits: ["SCDF"] },
    { code: "C3-02-T01", substance: "toluene", labId: c302.id, locationId: an1.children[0].id, custodianId: kaur.id, qty: 3500, initial: 5000, unit: "ML", lot: "MKBX5521", expiryDays: 420, permits: ["SCDF"] },
    { code: "D1-11-T02", substance: "toluene", labId: d111.id, locationId: t1.children[0].id, custodianId: lim.id, qty: 2600, initial: 4000, unit: "ML", lot: "TEACH-33", expiryDays: 380, permits: ["SCDF"] },
    { code: "D1-11-E01", substance: "etoac", labId: d111.id, locationId: t1.children[0].id, custodianId: lim.id, qty: 4000, initial: 4000, unit: "ML", lot: "TEACH-35", expiryDays: 400, permits: ["SCDF"] },
  ];

  const containerIds: Record<string, string> = {};
  for (const c of CONTAINERS) {
    await prisma.$transaction(async (tx) => {
      const created = await tx.container.create({
        data: {
          code: c.code,
          substanceId: substances[c.substance].id,
          labId: c.labId,
          locationId: c.locationId,
          custodianId: c.custodianId,
          currentQuantity: new Prisma.Decimal(c.qty),
          initialQuantity: new Prisma.Decimal(c.initial),
          unit: c.unit,
          lotNumber: c.lot ?? null,
          expiryDate: c.expiryDays !== undefined ? new Date(now + c.expiryDays * day) : null,
          receivedAt: new Date(now - 60 * day),
          status: c.status ?? "ACTIVE",
          pendingCorrection: c.pending ?? undefined,
          permitCategories: {
            create: (c.permits ?? []).map((p) => ({ permitCategoryId: permits[p] })),
          },
        },
      });
      containerIds[c.code] = created.id;
      const event = await writeAuditEvent(tx, {
        eventType: "container.check_in",
        actorId: admin.id,
        onBehalfSystem: true,
        entityType: "container",
        entityId: created.id,
        payload: {
          containerCode: c.code,
          before: 0,
          after: c.qty,
          unit: c.unit,
          reason: "Seed data",
        },
      });
      await tx.inventoryTransaction.create({
        data: {
          auditEventId: event.id,
          containerId: created.id,
          kind: "CHECK_IN",
          quantityBefore: new Prisma.Decimal(0),
          quantityAfter: new Prisma.Decimal(c.qty),
          unit: c.unit,
          reason: "Seed data",
        },
      });
    });
  }

  // A few recent deductions so the dashboard activity feed has content.
  const recent: [string, number, string, string][] = [
    ["B2-14-A11", 50, "Project 44-B — Suzuki coupling", liwei.id],
    ["B2-14-C02", 200, "Project 44-B — extraction", liwei.id],
    ["B2-14-S112", 100, "Mobile phase preparation", mtan.id],
  ];
  for (const [code, amount, reason, actorId] of recent) {
    await prisma.$transaction(async (tx) => {
      const container = await tx.container.findUniqueOrThrow({ where: { code } });
      const before = container.currentQuantity.toNumber() + amount;
      // Rewind then re-apply so seeded current quantities stay as declared.
      const event = await writeAuditEvent(tx, {
        eventType: "container.deduct",
        actorId,
        entityType: "container",
        entityId: container.id,
        payload: {
          containerCode: code,
          before,
          after: container.currentQuantity.toNumber(),
          unit: container.unit,
          reason,
        },
      });
      await tx.inventoryTransaction.create({
        data: {
          auditEventId: event.id,
          containerId: container.id,
          kind: "DEDUCT",
          quantityBefore: new Prisma.Decimal(before),
          quantityAfter: container.currentQuantity,
          unit: container.unit,
          reason,
        },
      });
    });
  }

  // Open transfer request: Li Wei asks M. Rahman for a toluene bottle.
  await prisma.transferRequest.create({
    data: {
      containerId: containerIds["A1-07-B12"],
      requesterId: liwei.id,
      currentCustodianId: rahman.id,
      message: "Borrowing for Project 44-B, ~200 mL needed",
    },
  });

  // SDS documents: current for most, one missing (in-house), one stale.
  for (const key of ["acetone", "acetonitrile", "dcm", "naoh", "nabh4", "etoac", "toluene", "nitric", "methanol", "hexane", "ipa", "chloroform", "aceticacid", "kmno4", "kcn"]) {
    await prisma.sdsDocument.create({
      data: {
        substanceId: substances[key].id,
        supplier: "Sigma-Aldrich",
        revision: key === "ether" ? "2022-04" : "2026-03",
        issuedDate: new Date("2026-03-14"),
        status: "CURRENT",
      },
    });
  }
  await prisma.sdsDocument.create({
    data: {
      substanceId: substances.ether.id,
      supplier: "Sigma-Aldrich",
      revision: "2022-04",
      issuedDate: new Date("2022-04-08"),
      status: "EXPIRED",
    },
  });

  console.log("Seed complete.");
  console.log(`Accounts (password: ${DEMO_PASSWORD}):`);
  console.log("  admin@lab.internal (Admin), li.wei@lab.internal (Lab Manager B2-14),");
  console.log("  m.tan@lab.internal (Custodian), r.iyer@lab.internal (Lab User),");
  console.log("  ehs@lab.internal (EHS Officer), viewer@lab.internal (Viewer),");
  console.log("  m.rahman@lab.internal / s.kaur@lab.internal / j.lim@lab.internal (Lab Managers)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
