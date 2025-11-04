/**
 * scripts/generate-addons.js
 * --------------------------
 * GitHub Releases → omsi-addons.json 자동 생성 스크립트
 * (OMSI2Installer용)
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

(async () => {
  try {
    console.log(`🔍 ${REPO} 저장소의 릴리스 목록을 가져오는 중...`);
    const [owner, repo] = REPO.split("/");

    const releases = await octokit.repos.listReleases({ owner, repo });
    const addons = [];

    for (const rel of releases.data) {
      console.log(`📦 릴리스: ${rel.name || rel.tag_name}`);

      for (const asset of rel.assets) {
        if (!asset.name.toLowerCase().endsWith(".zip")) continue; // zip만 포함

        const sizeMB = (asset.size / (1024 * 1024)).toFixed(1);
        const version = rel.tag_name.replace(/^v/i, "");

        addons.push({
          id: asset.name.replace(".zip", "").toLowerCase().replace(/\s+/g, "_"),
          name: asset.name.replace(".zip", ""),
          author: owner,
          description: rel.body ? rel.body.split("\n")[0] : "OMSI 2 Addon",
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
