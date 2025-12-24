import fs from "fs";

const OVERRIDES_PATH = "addon-overrides.json";

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function applyToFile(jsonPath, overrides) {
  if (!exists(jsonPath)) return;

  const data = readJson(jsonPath);
  if (!data || !Array.isArray(data.addons)) return;

  let changed = 0;

  for (const a of data.addons) {
    if (!a?.id) continue;
    const ov = overrides[a.id];
    if (!ov) continue;

    // ov에 들어있는 필드를 전부 덮어씀 (sourceUrl 뿐 아니라 확장 가능)
    for (const [k, v] of Object.entries(ov)) {
      if (a[k] !== v) {
        a[k] = v;
        changed++;
      }
    }
  }

  if (changed > 0) writeJson(jsonPath, data);
  console.log(`[apply-overrides] ${jsonPath} updated fields: ${changed}`);
}

if (!exists(OVERRIDES_PATH)) {
  console.log("[apply-overrides] no addon-overrides.json, skip");
  process.exit(0);
}

const overrides = readJson(OVERRIDES_PATH);

applyToFile("omsi-addons.json", overrides);
applyToFile("docs/omsi-addons.json", overrides);
