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
// scripts/generate-addons.js
// 레포 단위 스키마(sources.json: { repos: [ { repo, assetPriority?, prerelease?, addons: [ {id, category, tagPrefix, assetPriority?, prerelease?}, ... ] } ] })
// 여러 레포의 릴리즈를 인덱싱해 docs/omsi-addons.json (그리고 루트에도) 생성

import fs from "fs";
import path from "path";
import process from "process";

// ──────────────────────────────────────────────────────────────
// 토큰: GH_TOKEN 우선, 없으면 GITHUB_TOKEN (Actions 환경 호환)
// 비공개 레포를 긁을 땐 repo scope 가진 PAT를 GH_TOKEN에 넣으세요.
// ──────────────────────────────────────────────────────────────
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!GH_TOKEN) {
  console.warn("⚠️  GH_TOKEN/GITHUB_TOKEN이 없습니다. 공개 레포만 접근 가능합니다.");
}

const headers = {
  "Accept": "application/vnd.github+json",
  ...(GH_TOKEN ? { "Authorization": `Bearer ${GH_TOKEN}` } : {}),
  "X-GitHub-Api-Version": "2022-11-28"
};

// 경로
const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "sources.json"); // 레포 단위 스키마 파일
const OUTPUT_DIR = path.join(ROOT, "docs");
const OUT_DOCS = path.join(OUTPUT_DIR, "omsi-addons.json");
// 디버그/호환용: 루트에도 동일 파일 생성(원치 않으면 주석 처리)
/** @type {string} */
const OUT_ROOT = path.join(ROOT, "omsi-addons.json");

// 카테고리 한글 매핑 (설치기 UI 탭과 동일하게)
const CATEGORY_MAP = {
  "Map": "맵",
  "Bus": "버스",
  "AI": "AI 차량",
  "Ai": "AI 차량",
  // 이미 한글로 들어오면 그대로 통과
  "맵": "맵",
  "버스": "버스",
  "AI 차량": "AI 차량"
};

// ──────────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────────
async function gh(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}

function pickRelease(releases, { tagPrefix, prerelease }) {
  const filtered = (releases || []).filter(r => {
    if (!r.tag_name || !r.tag_name.startsWith(tagPrefix)) return false;
    if (r.draft) return false;
    if (!prerelease && r.prerelease) return false;
    return true;
  });
  filtered.sort((a, b) =>
    new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at)
  );
  return filtered[0] || null;
}

function pickAsset(assets, assetPriority) {
  const list = assets || [];
  for (const ext of assetPriority) {
    const cand = list.find(a => a.name && a.name.toLowerCase().endsWith(ext.toLowerCase()));
    if (cand) return cand;
  }
  return null;
}

function toSizeMB(bytes) {
  if (!bytes || isNaN(bytes)) return 0;
  return Math.round((bytes / 1048576) * 10) / 10; // 1MB=1,048,576B, 소수1자리
}

function toKoreanCategory(cat) {
  return CATEGORY_MAP[cat] || cat || "기타";
}

// ──────────────────────────────────────────────────────────────
async function run() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`❌ ${INPUT_PATH} 파일을 찾을 수 없습니다.`);
    process.exit(1);
  }

  const cfgRaw = fs.readFileSync(INPUT_PATH, "utf8").trim();
  if (!cfgRaw) {
    console.error("❌ sources.json 내용이 비어있습니다.");
    process.exit(1);
  }

  /** @type {{repos: Array<{repo: string, assetPriority?: string[], prerelease?: boolean, addons: Array<{id: string, category?: string, tagPrefix: string, assetPriority?: string[], prerelease?: boolean}>}>}>} */
  let cfg;
  try {
    cfg = JSON.parse(cfgRaw);
  } catch (e) {
    console.error("❌ sources.json JSON 파싱 오류:", e.message);
    process.exit(1);
  }

  const repos = cfg.repos || [];
  if (!Array.isArray(repos) || repos.length === 0) {
    console.warn("⚠️  sources.json의 repos가 비어있습니다. 생성할 항목이 없습니다.");
  }

  const addonsOut = [];

  for (const repoCfg of repos) {
    const repo = repoCfg.repo;
    if (!repo || typeof repo !== "string" || !repo.includes("/")) {
      console.warn(`⚠️  잘못된 repo 값: ${repo}. 'owner/name' 형식이어야 합니다. 스킵합니다.`);
      continue;
    }
    const repoAssetPriority = repoCfg.assetPriority || [".7z", ".zip"];
    const repoPrerelease = !!repoCfg.prerelease;

    console.log(`📦 레포 조회: ${repo}`);

    let releaseList;
    try {
      // 각 레포마다 릴리즈 목록 한 번만 가져오기 (최신 30개면 보통 충분)
      releaseList = await gh(`https://api.github.com/repos/${repo}/releases?per_page=30`);
    } catch (e) {
      console.warn(`  ⚠️  ${repo}: 릴리즈 목록 조회 실패 → ${e.message}`);
      continue;
    }

    const owner = repo.split("/")[0];

    for (const addon of (repoCfg.addons || [])) {
      try {
        const {
          id,
          category,
          tagPrefix,
          assetPriority = repoAssetPriority,
          prerelease = repoPrerelease
        } = addon || {};

        if (!id || !tagPrefix) {
          console.warn(`  ⚠️  ${repo}: addon에 id/tagPrefix 누락 → 스킵`);
          continue;
        }

        const kCategory = toKoreanCategory(category);
        console.log(`  🔎 ${id} [${kCategory}] tagPrefix=${tagPrefix}, prerelease=${prerelease}`);

        const rel = pickRelease(releaseList, { tagPrefix, prerelease });
        if (!rel) {
          console.warn(`  ⚠️  ${repo}: '${tagPrefix}*' 조건에 맞는 릴리즈 없음(드래프트/프리릴리즈 조건 포함)`);
          continue;
        }

        const asset = pickAsset(rel.assets || [], assetPriority);
        if (!asset) {
          console.warn(`  ⚠️  ${repo}: '${rel.tag_name}' 릴리즈에 ${assetPriority.join(", ")} 애셋이 없습니다.`);
          continue;
        }

        const version = rel.tag_name.substring(tagPrefix.length).replace(/^v/, "");
        addonsOut.push({
          id,
          name: rel.name || id,
          author: owner,
          description: rel.body || "",
          version,
          category: kCategory,
          repo,
          releaseTag: rel.tag_name,
          publishedAt: rel.published_at || rel.created_at,
          downloadUrl: asset.browser_download_url,
          fileName: asset.name,
          size: asset.size,
          sizeMB: toSizeMB(asset.size)
        });
      } catch (e) {
        console.warn(`  ⚠️  ${repo}: '${addon?.id || "unknown"}' 수집 중 오류 → ${e.message}`);
        continue;
      }
    }
  }

  // 정렬: 카테고리 → 이름
  addonsOut.sort((a, b) =>
    (a.category || "").localeCompare(b.category || "") ||
    (a.name || "").localeCompare(b.name || "")
  );

  const output = {
    generatedAt: new Date().toISOString(),
    addons: addonsOut
  };

  // 저장 (docs/, 그리고 루트에도 저장해 디버그/호환성↑)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const json = JSON.stringify(output, null, 2);
  fs.writeFileSync(OUT_DOCS, json, "utf8");
  try {
    fs.writeFileSync(OUT_ROOT, json, "utf8");
  } catch {
    // 루트 쓰기 실패는 무시(권한/정책에 따라 루트 생략 가능)
  }

  console.log(`✅ 생성 완료: ${OUT_DOCS}${fs.existsSync(OUT_ROOT) ? ` & ${OUT_ROOT}` : ""} (총 ${addonsOut.length}개)`);
}

// 실행
run().catch(err => {
  console.error("❌ 치명적 오류:", err);
  process.exit(1);
});
