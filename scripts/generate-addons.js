/**
 * scripts/generate-addons.js
 * --------------------------
 * OMSI2 자동 Addon JSON 생성기 (카테고리 인식 버전)
 */

const fs = require("fs");
const path = require("path");
const { Octokit } = require("@octokit/rest");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO;

if (!GITHUB_TOKEN || !REPO) {
  console.error("❌ 환경 변수 누락: GITHUB_TOKEN 또는 REPO 값이 필요합니다.");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// 🔹 카테고리 매칭 규칙
const CATEGORY_KEYWORDS = {
  map: "맵",
  bus: "버스",
  ai: "AI 차량",
  sound: "사운드",
  script: "스크립트",
  patch: "패치",
};

// 이름에서 [tag] 제거하고 카테고리 감지
function detectCategory(name = "") {
  const lower = name.toLowerCase();
  for (const key in CATEGORY_KEYWORDS) {
    if (lower.includes(`[${key}]`)) return CATEGORY_KEYWORDS[key];
  }
  return "기타";
}

// 버전 정규화: "현대_4.1.0.7" -> "4.1.0.7", "v1.2.3" -> "1.2.3"
function normalizeVersion(raw) {
  if (!raw) return "";
  // 기본적으로 v 접두사 제거
  let s = String(raw).trim();
  s = s.replace(/^v/i, "");

  // 첫 번째로 나타나는 숫자+(.숫자)* 패턴을 찾는다
  const m = s.match(/\d+(?:\.\d+)*/);
  if (m) return m[0];

  // 숫자 패턴이 없다면, 맨 앞의 비숫자/언더스코어 접두를 제거
  // ex: "현대_4_1_0_7" 같은 경우는 언더스코어 대신 점으로 바꿔서 처리할 수도 있음,
  // 여기서는 단순히 비숫자 접두만 제거.
  const fallback = s.replace(/^[^\d]+/, "");
  return fallback || s;
}

(async () => {
  try {
    const [owner, repo] = REPO.split("/");
    console.log(`🔍 ${REPO} 저장소의 릴리스 목록을 가져오는 중...`);

    // 최신 릴리스 목록 가져오기 (필요하면 per_page 늘리기)
    const releases = await octokit.repos.listReleases({ owner, repo, per_page: 100 });
    const addons = [];

    for (const rel of releases.data) {
      const category = detectCategory(rel.name || rel.tag_name);

      for (const asset of rel.assets) {
        // zip,7z 파일만 포함 (필요하면 확장자 필터 조정)
        if (!lowerName.endsWith(".zip") && !lowerName.endsWith(".7z")) continue;

        // 정규화된 버전 얻기 (tag_name 우선 -> name)
        const rawVersion = rel.tag_name || rel.name || "";
        const version = normalizeVersion(rawVersion);

        const sizeMB = (asset.size / (1024 * 1024)).toFixed(1);

        addons.push({
          id: asset.name.replace(".zip|7z", "").toLowerCase().replace(/\s+/g, "_"),
          name: (rel.name || asset.name).replace(/^\[.*?\]\s*/, ""), // [map] 제거
          author: owner,
          category: category,
          description: rel.body ? rel.body.split("\n")[0] : "OMSI 2 애드온입니다.",
          version: version,
          sizeMB: parseFloat(sizeMB),
          downloadUrl: asset.browser_download_url,
        });
      }
    }

    const output = {
      generatedAt: new Date().toISOString(),
      addons,
    };

    const outputDir = path.join("docs");
    const outputFile = path.join(outputDir, "omsi-addons.json");

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");

    console.log(`✅ 생성 완료: ${outputFile}`);
    console.log(`📁 총 ${addons.length}개의 애드온이 포함되었습니다.`);
  } catch (err) {
    console.error("❌ 오류 발생:", err.message);
    process.exit(1);
  }
})();
