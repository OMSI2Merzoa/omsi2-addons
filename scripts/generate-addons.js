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
// 여러 레포의 최신 릴리즈를 모아 docs/omsi-addons.json 생성

import fs from "fs";
import path from "path";
import process from "process";

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!GH_TOKEN) {
  console.error("❌ GITHUB_TOKEN (repo 권한) 환경변수가 필요합니다.");
  process.exit(1);
}

const headers = {
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${GH_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28"
};

const ROOT = process.cwd();
const SOURCES_PATH = path.join(ROOT, "sources.json");
const OUTPUT_DIR = path.join(ROOT, "docs");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "omsi-addons.json");

// 유틸: GitHub API 호출(기본 페이지네이션 최소화)
async function gh(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }
  return res.json();
}

// 릴리즈 중 조건에 맞는 "가장 최신" 항목 찾기
function pickRelease(releases, opt) {
  const { tagPrefix, prerelease } = opt;
  const filtered = releases.filter(r => {
    if (!r.tag_name || !r.tag_name.startsWith(tagPrefix)) return false;
    if (r.draft) return false;
    if (!prerelease && r.prerelease) return false;
    return true;
  });
  // 최신순 정렬(created_at 또는 published_at)
  filtered.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
  return filtered[0] || null;
}

// 애셋 선택(우선순위 확장자)
function pickAsset(assets, assetPriority) {
  for (const ext of assetPriority) {
    const cand = assets.find(a => a.name && a.name.toLowerCase().endsWith(ext));
    if (cand) return cand;
  }
  return null;
}

async function run() {
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8")).sources;
  const addons = [];

  for (const s of sources) {
    const { id, repo, category, tagPrefix, assetPriority = [".7z", ".zip"], prerelease = false } = s;
    console.log(`🔍 ${repo} (${id}) 릴리즈 조회 중...`);

    // 릴리즈 목록(페이지 1만; 보통 최신 30개면 충분)
    const list = await gh(`https://api.github.com/repos/${repo}/releases?per_page=30`);
    const rel = pickRelease(list, { tagPrefix, prerelease });

    if (!rel) {
      console.warn(`⚠️  ${repo}: 조건(tagPrefix=${tagPrefix}, prerelease=${prerelease})에 맞는 릴리즈 없음`);
      continue;
    }

    const asset = pickAsset(rel.assets || [], assetPriority);
    if (!asset) {
      console.warn(`⚠️  ${repo}: 우선순위 ${assetPriority.join(", ")} 에 맞는 애셋이 없음`);
      continue;
    }

    // 버전 문자열(태그에서 prefix 제거)
    const version = rel.tag_name.substring(tagPrefix.length).replace(/^v/, "");
    addons.push({
      id,
      name: rel.name || id,
      version,
      category,
      repo,
      releaseTag: rel.tag_name,
      publishedAt: rel.published_at || rel.created_at,
      downloadUrl: asset.browser_download_url,
      fileName: asset.name,
      size: asset.size,
      // 필요하면 checksum을 업로더가 릴리즈 노트에 써주게 하고 파싱도 가능
    });
  }

  // 출력 폴더 확보
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 정렬(카테고리 → 이름)
  addons.sort((a, b) => (a.category || "").localeCompare(b.category || "") || (a.name || "").localeCompare(b.name || ""));

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ addons }, null, 2), "utf8");
  console.log(`✅ 생성 완료: ${OUTPUT_PATH} (총 ${addons.length}개)`);
}

run().catch(err => {
  console.error("❌ 오류:", err);
  process.exit(1);
});
