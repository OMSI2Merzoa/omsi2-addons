/**
 * scripts/generate-addons.js
 * --------------------------
 * OMSI2 자동 Addon JSON 생성기 (옵션B: 애드온별 네임스페이스 태그)
 *
 * - 태그명 형식: {addonId}-v{SemVer}
 *   예) seoulmap-v1.4.0, bus-abc-v2.0.1, common-aipack-v3.2.0-rc.1
 * - 같은 addonId에 대해 최신 릴리즈 1개만 출력
 * - draft/prerelease 기본 제외 (INCLUDE_PRERELEASE=true 로 바꿀 수 있음)
 * - 에셋 선택 우선순위: .7z > .zip > 첫번째 > zipball_url/tarball_url
 */

const fs = require("fs");
const path = require("path");
const { Octokit } = require("@octokit/rest");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO;
const INCLUDE_PRERELEASE = /^true$/i.test(process.env.INCLUDE_PRERELEASE || "false");

if (!GITHUB_TOKEN || !REPO) {
  console.error("❌ 환경 변수 누락: GITHUB_TOKEN 또는 REPO 값이 필요합니다.");
  process.exit(1);
}

const [owner, repo] = REPO.split("/");
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// 카테고리 매칭 규칙 ([map], [bus] 같은 태그를 릴리즈 제목에 붙여두면 인식)
const CATEGORY_KEYWORDS = {
  map: "맵",
  bus: "버스",
  ai: "AI 차량",
  sound: "사운드",
  script: "스크립트",
  patch: "패치",
  etc: "기타",
};

function detectCategory(name = "") {
  const lower = name.toLowerCase();
  for (const key of Object.keys(CATEGORY_KEYWORDS)) {
    if (lower.includes(`[${key}]`)) return CATEGORY_KEYWORDS[key];
  }
  return CATEGORY_KEYWORDS.etc;
}

// "v1.2.3" -> "1.2.3", "4.1.0.7" 유지
function normalizeVersion(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  s = s.replace(/^v/i, "");
  const m = s.match(/\d+(?:\.\d+)*/);
  return m ? m[0] : s;
}

function pickAsset(assets = [], preferRegex) {
  if (!assets || assets.length === 0) return null;
  // 우선 정규식(선택) → .7z → .zip → 첫번째
  if (preferRegex) {
    const rx = new RegExp(preferRegex, "i");
    const hit = assets.find(a => rx.test(a.name || ""));
    if (hit) return hit;
  }
  const by7z = assets.find(a => (a.name || "").toLowerCase().endsWith(".7z"));
  if (by7z) return by7z;
  const byZip = assets.find(a => (a.name || "").toLowerCase().endsWith(".zip"));
  if (byZip) return byZip;
  return assets[0];
}

function cleanDisplayName(relName, addonId) {
  // [map] 같은 프리픽스 제거, 없으면 addonId를 타이틀 케이스로
  const base = relName ? relName.replace(/^\[.*?\]\s*/, "").trim() : addonId;
  if (base) return base;
  return addonId.replace(/(^|[-_])(\w)/g, (_, p1, p2) => (p1 ? " " : "") + p2.toUpperCase());
}

(async () => {
  try {
    console.log(`🔍 ${REPO} 릴리즈 목록 수집 중...`);
    // 모든 릴리즈 페이지네이션 수집
    const releases = await octokit.paginate(octokit.repos.listReleases, {
      owner, repo, per_page: 100,
    });

    // addonId -> 최신 릴리즈 매핑
    /** @type {Record<string, {rel:any, asset:any}>} */
    const latestByAddon = {};

    for (const rel of releases) {
      if (rel.draft) continue;
      if (!INCLUDE_PRERELEASE && rel.prerelease) continue;

      const tag = rel.tag_name || "";
      // 태그에서 addonId와 버전 추출: {addonId}-v{...}
      const m = tag.match(/^([a-z0-9][a-z0-9-]*)-v(.+)$/i);
      if (!m) continue;

      const addonId = m[1].toLowerCase();     // ex) seoulmap
      const versionRaw = m[2];                // ex) 1.4.0, 2.0.1-rc.1
      const ts = Date.parse(rel.published_at || rel.created_at || 0) || 0;

      // 최신판만 유지 (published_at 기준, 동일하면 더 나중에 만들어진 것으로)
      if (!latestByAddon[addonId]) {
        latestByAddon[addonId] = { rel, asset: null, _ts: ts };
      } else if (ts > (latestByAddon[addonId]._ts || 0)) {
        latestByAddon[addonId] = { rel, asset: null, _ts: ts };
      }
    }

    // 결과 구성
    const addons = [];

    for (const [addonId, entry] of Object.entries(latestByAddon)) {
      const rel = entry.rel;

      // 에셋 선택 (옵션: 릴리즈 본문에 assetFilter를 적어두고 파싱해도 되지만, 여기선 확장자 우선순위)
      const asset = pickAsset(rel.assets || []);

      // 메타
      const version = normalizeVersion(rel.tag_name.replace(`${addonId}-`, "") || rel.name);
      const category = detectCategory(rel.name || rel.tag_name);
      const name = cleanDisplayName(rel.name, addonId);

      let sizeMB = 0;
      let downloadUrl = rel.zipball_url || rel.tarball_url; // 에셋이 없을 때 폴백
      if (asset) {
        sizeMB = Number((asset.size / (1024 * 1024)).toFixed(1));
        downloadUrl = asset.browser_download_url || downloadUrl;
      }

      addons.push({
        id: addonId,                 // ✅ 애드온 고유 ID = 접두사
        name: name,
        author: owner,
        category: category,
        description: rel.body ? rel.body.split("\n")[0] : "OMSI 2 애드온입니다.",
        version: version,            // 예: "1.4.0"
        sizeMB: sizeMB,
        downloadUrl: downloadUrl,
        repo: REPO                   // 설치기에서 필요 시 참조
      });
    }

    // 보기 좋게 정렬(카테고리 → 이름)
    addons.sort((a, b) => (a.category || "").localeCompare(b.category || "", "ko")
      || (a.name || "").localeCompare(b.name || "", "ko"));

    const output = {
      generatedAt: new Date().toISOString(),
      addons,
    };

    const outputDir = path.join("docs");
    const outputFile = path.join(outputDir, "omsi-addons.json");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");

    console.log(`✅ 생성 완료: ${outputFile}`);
    console.log(`📦 애드온 수: ${addons.length}`);
  } catch (err) {
    console.error("❌ 오류 발생:", err.message);
    process.exit(1);
  }
})();
