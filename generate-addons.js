// scripts/generate-addons.js
// Node 18+ 권장
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

(async () => {
  try {
    const repoEnv = process.env.REPO; // "owner/repo"
    if (!repoEnv) throw new Error('Environment variable REPO not set');
    const [owner, repo] = repoEnv.split('/');

    const token = process.env.GITHUB_TOKEN || '';
    const octokit = new Octokit({ auth: token });

    // 최신 릴리스(또는 필요시 모든 릴리스) 가져오기
    const releasesResp = await octokit.repos.listReleases({
      owner,
      repo,
      per_page: 100
    });

    const addons = [];

    // 릴리스 역순(최신 먼저)으로 처리(선택)
    for (const rel of releasesResp.data) {
      const version = rel.tag_name || rel.name || '';
      const author = rel.author?.login || '';
      const description = rel.body ? rel.body.trim() : '';

      // 릴리스의 각 asset을 애드온 항목으로 변환
      for (const asset of rel.assets) {
        // id 생성 규칙: asset name에서 안전한 문자열로
        const rawName = asset.name || asset.label || 'asset';
        const id = rawName
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_\-\.]/g, '')
          .slice(0, 80);

        const name = asset.label || asset.name || `${repo} - ${version}`;
        const sizeMB = Math.round((asset.size / 1024 / 1024) * 10) / 10; // 1자리 소수

        addons.push({
          id,
          name,
          author,
          description,
          version,
          sizeMB,
          downloadUrl: asset.browser_download_url
        });
      }
    }

    const output = { addons };

    const outDir = path.join(process.cwd(), 'docs');
    const outPath = path.join(outDir, 'omsi-addons.json');

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`Wrote ${outPath} (${addons.length} addons)`);
    process.exit(0);
  } catch (err) {
    console.error('Error generating omsi-addons.json:', err);
    process.exit(1);
  }
})();
