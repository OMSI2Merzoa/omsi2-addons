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
// 여러 "레포 → 애드온들" 구조를 인덱싱해서 docs/omsi-addons.json 생성

import fs from "fs";
import path from "path";
import process from "process";

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!GH_TOKEN) {
  console.error("❌ GITHUB_TOKEN (또는 GH_TOKEN) 환경변수가 필요합니다.");
  process.exit(1);
}

const headers = {
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${GH_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28"
};

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "sources.json"); // ← 레포 단위 스키마의 파일명 유지
const OUTPUT_DIR = path.join(ROOT, "docs");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "omsi-addons.json");

// ─────────────── 유틸 ───────────────
async function gh(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
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
  filtered.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
  return filtered[0] || null;
}

function pickAsset(assets, assetPriority) {
  for (const ext of assetPriority) {
    const cand = (assets || []).find(a => a.name && a.name.toLowerCase().endsWith(ext));
    if (cand) return cand;
  }
  return null;
}

// ─────────────── 메인 ───────────────
async function run() {
  const cfg = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
  const repos = cfg.repos || []; // 레포 단위 스키마: { repos: [ { repo, assetPriority?, prerelease?, addons: [ ... ] } ] }
  const addonsOut = [];

  for (const repoCfg of repos) {
    const repo = repoCfg.repo; // "owner/name"
    const repoAssetPriority = repoCfg.assetPriority || [".7z", ".zip"];
    const repoPrerelease = !!repoCfg.prerelease;

    console.log(`📦 레포 조회: ${repo}`);
    let releaseList;
    try {
      // 각 레포의 릴리즈 목록 한 번만 가져와 캐시(애드온별로 tagPrefix만 다름)
      releaseList = await gh(`https://api.github.com/repos/${repo}/releases?per_page=30`);
    } catch (e) {
      console.warn(`⚠️  ${repo}: 릴리즈 목록 조회 실패 → ${e.message}`);
      continue; // 이 레포는 스킵
    }

    for (const addon of (repoCfg.addons || [])) {
      try {
        const {
          id,
          category,
          tagPrefix,                         // 필수: addonId-v...
          assetPriority = repoAssetPriority, // 애드온별 > 레포 공통
          prerelease = repoPrerelease
        } = addon;

        if (!id || !tagPrefix) {
          console.warn(`⚠️  ${repo}: addon 항목에 id/tagPrefix 누락 → 스킵`);
          continue;
        }

        console.log(`  🔎 ${id} (${category || "Unknown"}) → tagPrefix=${tagPrefix}, prerelease=${prerelease}`);

        const rel = pickRelease(releaseList, { tagPrefix, prerelease });
        if (!rel) {
          console.warn(`  ⚠️  ${repo}: '${tagPrefix}*' 릴리즈 없음(드래프트/프리릴리즈 조건 확인)`);
          continue;
        }

        const asset = pickAsset(rel.assets || [], assetPriority);
        if (!asset) {
          console.warn(`  ⚠️  ${repo}: '${tagPrefix}' 최신 릴리즈에 ${assetPriority.join(", ")} 애셋 없음`);
          continue;
        }

        const version = rel.tag_name.substring(tagPrefix.length).replace(/^v/, "");
        addonsOut.push({
          id,
          name: rel.name || id,
          version,
          category,
          repo,
          releaseTag: rel.tag_name,
          publishedAt: rel.published_at || rel.created_at,
          downloadUrl: asset.browser_download_url,
          fileName: asset.name,
          size: asset.size
        });
      } catch (e) {
        console.warn(`  ⚠️  ${repo}: addon 수집 중 오류 → ${e.message}`);
        continue;
      }
    }
  }

  // 정렬(카테고리 → 이름)
  addonsOut.sort((a, b) =>
    (a.category || "").localeCompare((b.category || "")) ||
    (a.name || "").localeCompare((b.name || ""))
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ addons: addonsOut }, null, 2), "utf8");
  console.log(`✅ 생성 완료: ${OUTPUT_PATH} (총 ${addonsOut.length}개)`);
}

run().catch(err => {
  console.error("❌ 오류:", err);
  process.exit(1);
});
