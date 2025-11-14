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
// scripts/generate-addons.js
import fs from "fs";
import path from "path";
import process from "process";

const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!GH_TOKEN) console.warn("⚠️  GH_TOKEN/GITHUB_TOKEN이 없습니다(공개 레포만 접근).");

const headers = {
  "Accept": "application/vnd.github+json",
  ...(GH_TOKEN ? { "Authorization": `Bearer ${GH_TOKEN}` } : {}),
  "X-GitHub-Api-Version": "2022-11-28"
};

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, "sources.json");      // { repos: [ { repo, addons:[...], ... } ] }
const OUTPUT_DIR = path.join(ROOT, "docs");
const OUT_DOCS = path.join(OUTPUT_DIR, "omsi-addons.json");
const OUT_ROOT = path.join(ROOT, "omsi-addons.json");    // 디버그/호환용(루트에도 기록)

const CATEGORY_MAP = { "Map":"맵", "Bus":"버스", "AI":"AI 차량", "Ai":"AI 차량", "맵":"맵", "버스":"버스", "AI 차량":"AI 차량" };

async function gh(url){ const r=await fetch(url,{headers}); if(!r.ok){throw new Error(`GitHub API ${r.status}: ${await r.text()}`);} return r.json(); }
function toK(cat){ return CATEGORY_MAP[cat] || cat || "기타"; }
function toMB(bytes){ return Math.round((bytes/1048576)*10)/10; }

function pickRelease(releases,{tagPrefix,prerelease}){
  const f=(releases||[]).filter(r=>{
    if(!r.tag_name?.startsWith(tagPrefix)) return false;
    if(r.draft) return false;
    if(!prerelease && r.prerelease) return false;
    return true;
  });
  f.sort((a,b)=> new Date(b.published_at||b.created_at)-new Date(a.published_at||a.created_at));
  return f[0]||null;
}

function pickAsset(assets, prios){ // 단일 패키지(.7z / .zip)
  for(const ext of prios){
    const hit=(assets||[]).find(a=>a.name?.toLowerCase().endsWith(ext.toLowerCase()));
    if(hit) return hit;
  }
  return null;
}

// ── 멀티볼륨: 같은 릴리즈 내에서 .7z.001+ 묶음을 그룹핑 ──
function group7zVolumes(assets, preferBase){
  const map=new Map(); // base -> [asset...]
  for(const a of (assets||[])){
    const name=a.name?.toLowerCase()||"";
    const m=name.match(/^(.*)\.7z\.(\d{3,})$/i);
    if(!m) continue;
    const base=m[1]; // ".7z.001" 앞부분
    if(!map.has(base)) map.set(base,[]);
    map.get(base).push(a);
  }
  if(map.size===0) return null;

  // 정렬(001,002… 순으로)
  for(const [k,arr] of map){
    arr.sort((x,y)=>x.name.localeCompare(y.name,undefined,{numeric:true}));
  }

  // 1) preferBase가 주어지면 그걸 포함하는 그룹 우선
  if(preferBase){
    const preferKey=[...map.keys()].find(k=>k.includes(preferBase.toLowerCase()));
    if(preferKey) return { base: preferKey, files: map.get(preferKey) };
  }
  // 2) 하나뿐이면 그거
  if(map.size===1){
    const [onlyKey,files]=[...map.entries()][0];
    return { base: onlyKey, files };
  }
  // 3) 가장 파일 수가 많은 그룹
  let bestKey=null, bestLen=-1;
  for(const [k,arr] of map){
    if(arr.length>bestLen){ bestLen=arr.length; bestKey=k; }
  }
  return { base: bestKey, files: map.get(bestKey) };
}

async function run(){
  if(!fs.existsSync(INPUT_PATH)) { console.error(`❌ ${INPUT_PATH} 없음`); process.exit(1); }
  let cfg; try{ cfg=JSON.parse(fs.readFileSync(INPUT_PATH,"utf8")); }catch(e){ console.error("❌ sources.json 파싱 오류:",e.message); process.exit(1); }
  const repos=cfg.repos||[];
  const out=[];

  for(const repoCfg of repos){
    const repo=repoCfg.repo;
    if(!repo?.includes("/")){ console.warn(`⚠️  잘못된 repo: ${repo}`); continue; }
    const repoPrios=repoCfg.assetPriority||[".7z",".zip"];
    const repoPre=!!repoCfg.prerelease;

    console.log(`📦 레포 조회: ${repo}`);
    let list; try{ list=await gh(`https://api.github.com/repos/${repo}/releases?per_page=30`);}catch(e){ console.warn(`  ⚠️  목록 실패 → ${e.message}`); continue; }
    const owner=repo.split("/")[0];

    for(const addon of (repoCfg.addons||[])){
      try{
        // 🔹 sources.json 에서 displayAuthor도 함께 읽어옴
        const { id, category, tagPrefix, assetPriority=repoPrios, prerelease=repoPre, displayAuthor } = addon||{};
        if(!id || !tagPrefix){ console.warn(`  ⚠️  ${repo}: id/tagPrefix 누락`); continue; }
        const kCat=toK(category);
        const rel=pickRelease(list,{tagPrefix,prerelease});
        if(!rel){ console.warn(`  ⚠️  ${repo}: '${tagPrefix}*' 릴리즈 없음`); continue; }

        const version = rel.tag_name.substring(tagPrefix.length).replace(/^v/,"");
        const preferBase = `${id}_${version}`.toLowerCase();

        // ① 멀티볼륨 우선
        const grp = group7zVolumes(rel.assets, preferBase);
        if(grp && grp.files?.length){
          const total = grp.files.reduce((s,a)=>s+(a.size||0),0);
          out.push({
            id,
            name: rel.name || id,
            author: owner,
            // 🔹 표시용 작성자 (없으면 빈 문자열 → 클라이언트에서 Author로 폴백)
            displayAuthor: displayAuthor || "",
            description: rel.body || "",
            version,
            category: kCat,
            repo,
            releaseTag: rel.tag_name,
            publishedAt: rel.published_at || rel.created_at,
            assets: grp.files.map(a=>({ fileName: a.name, downloadUrl: a.browser_download_url, size: a.size })),
            size: total,
            sizeMB: toMB(total)
          });
          continue;
        }

        // ② 폴백: 단일 .7z / .zip
        const asset = pickAsset(rel.assets||[], assetPriority);
        if(!asset){ console.warn(`  ⚠️  ${repo}: 애셋(.7z|.zip) 없음`); continue; }
        out.push({
          id,
          name: rel.name || id,
          author: owner,
          // 🔹 여기도 동일하게 displayAuthor 포함
          displayAuthor: displayAuthor || "",
          description: rel.body || "",
          version,
          category: kCat,
          repo,
          releaseTag: rel.tag_name,
          publishedAt: rel.published_at || rel.created_at,
          // 하위호환 필드(기존 설치기 호환 위해 유지)
          downloadUrl: asset.browser_download_url,
          fileName: asset.name,
          size: asset.size,
          sizeMB: toMB(asset.size),
          // 새 필드 형식을 통일하기 위해 assets에도 1개 넣어둠
          assets: [{ fileName: asset.name, downloadUrl: asset.browser_download_url, size: asset.size }]
        });
      }catch(e){
        console.warn(`  ⚠️  ${repo}: '${addon?.id||"unknown"}' 수집 오류 → ${e.message}`);
      }
    }
  }

  out.sort((a,b)=>(a.category||"").localeCompare(b.category||"")||(a.name||"").localeCompare(b.name||""));
  const payload={ generatedAt:new Date().toISOString(), addons: out };

  fs.mkdirSync(OUTPUT_DIR,{recursive:true});
  const json=JSON.stringify(payload,null,2);
  fs.writeFileSync(OUT_DOCS,json,"utf8");
  try{ fs.writeFileSync(OUT_ROOT,json,"utf8"); }catch{}
  console.log(`✅ 생성 완료: ${OUT_DOCS}${fs.existsSync(OUT_ROOT)?` & ${OUT_ROOT}`:""} (총 ${out.length}개)`);
}

run().catch(e=>{ console.error("❌ 치명적 오류:",e); process.exit(1); });
