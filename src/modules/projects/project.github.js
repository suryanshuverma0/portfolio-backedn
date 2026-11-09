import { getOrSetCache } from "../../utils/cache.js";
import { getConfiguredUsernames } from "../integrations/integrations.service.js";

/* ---------------------------------------------------------------------------
   GITHUB IMPORT — turn a repository into a project draft: title, summary,
   tech stack (languages + topics + well-known names in the README),
   features / challenges / learnings from README sections, README
   screenshots as the gallery, and a cover (live-site screenshot when the
   repo has a homepage, otherwise GitHub's social card). Only ever talks to
   api.github.com, so there's no user-controlled host to fetch.
--------------------------------------------------------------------------- */

const API = "https://api.github.com";
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const gh = async (path, accept = "application/vnd.github+json") => {
  const headers = { Accept: accept, "User-Agent": "portfolio-project-import", "X-GitHub-Api-Version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw httpError("GitHub's rate limit was hit — try again in a few minutes", 429);
  if (!res.ok) throw httpError(`GitHub answered ${res.status}`, 502);
  return accept.includes("raw") ? res.text() : res.json();
};

export const parseRepoRef = (input) => {
  const raw = String(input || "").trim().replace(/\.git$/i, "");
  let owner;
  let repo;
  const fromUrl = raw.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)/i);
  if (fromUrl) [, owner, repo] = fromUrl;
  else if (/^[^/\s]+\/[^/\s]+$/.test(raw)) [owner, repo] = raw.split("/");
  if (!owner || !OWNER_RE.test(owner) || !REPO_RE.test(repo)) throw httpError("Use a GitHub repo link like github.com/owner/repo", 400);
  return { owner, repo };
};

/* ---------- README helpers ---------- */

const stripMd = (s = "") =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/^[\s>#-]+/, "")
    .replace(/\s+/g, " ")
    .trim();

const sections = (md) => {
  const out = [];
  let current = { heading: "", level: 0, lines: [] };
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) {
      out.push(current);
      current = { heading: stripMd(h[2]), level: h[1].length, lines: [] };
    } else if (!fence) current.lines.push(line);
  }
  out.push(current);
  return out;
};

const bulletsOf = (lines, max = 10) =>
  lines
    .map((l) => l.match(/^\s{0,3}(?:[-*+]|\d+[.)])\s+(.+)/)?.[1])
    .filter(Boolean)
    .map((b) => stripMd(b).replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter((b) => b.length > 3 && b.length < 300)
    .slice(0, max);

// A section's lines including its sub-sections (### under ##).
const sectionLines = (secs, re) => {
  const i = secs.findIndex((s) => s.level > 1 && re.test(s.heading));
  if (i < 0) return [];
  const lines = [...secs[i].lines];
  for (let j = i + 1; j < secs.length && secs[j].level > secs[i].level; j += 1) lines.push(...secs[j].lines);
  return lines;
};

const tableRows = (lines) =>
  lines
    .filter((l) => /^\s*\|.*\|\s*$/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => stripMd(c)));

// Bullets, or "Area: what it does" rows when the section is a table.
const sectionBullets = (secs, re, max) => {
  const lines = sectionLines(secs, re);
  const bullets = bulletsOf(lines, max);
  if (bullets.length) return bullets;
  return tableRows(lines)
    .slice(1)
    .filter((r) => r.length >= 2 && r[0] && r[1])
    .slice(0, max)
    .map((r) => `${r[0]}: ${r[r.length - 1]}`.slice(0, 400));
};

// First two-plus-column markdown table in a results section → label/value pairs.
const tableMetrics = (secs, re, max = 8) => {
  const rows = tableRows(sectionLines(secs, re));
  return rows
    .slice(1)
    .filter((r) => r.length >= 2 && r[0] && r[r.length - 1])
    .slice(0, max)
    .map((r) => ({ label: r[0].slice(0, 150), value: r[r.length - 1].slice(0, 150) }));
};

const firstParagraph = (secs) => {
  for (const sec of secs.slice(0, 4)) {
    const paras = sec.lines.join("\n").split(/\n\s*\n/).map((p) => p.trim());
    for (const p of paras) {
      if (!p || /^(\[!\[|!\[|<p|<img|<div|<a |\||[-*+]\s|\d+\.\s)/i.test(p)) continue;
      const text = stripMd(p);
      if (text.length > 40) return text.slice(0, 1200);
    }
  }
  return "";
};

const readmeImages = (md, owner, repo, branch) => {
  const urls = [
    ...[...md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...md.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]),
  ];
  const seen = new Set();
  return urls
    .filter((u) => !/shields\.io|badge|badgen|travis-ci|codecov|\.svg(\?|$)|github-readme-stats|skillicons|vercel\.app\/api/i.test(u))
    .map((u) => {
      if (/^https?:\/\//i.test(u)) return u.replace(/^http:/i, "https:").replace(/github\.com\/([^/]+)\/([^/]+)\/blob\//i, "raw.githubusercontent.com/$1/$2/");
      if (/^(data:|javascript:|\/\/)/i.test(u)) return "";
      const path = u.replace(/^\.?\//, "");
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
    })
    .filter((u) => u && !seen.has(u) && seen.add(u))
    .slice(0, 12);
};

/* ---------- tech + category ---------- */

const NAMES = {
  javascript: "JavaScript", typescript: "TypeScript", python: "Python", solidity: "Solidity", java: "Java", kotlin: "Kotlin",
  swift: "Swift", dart: "Dart", go: "Go", rust: "Rust", php: "PHP", ruby: "Ruby", "c++": "C++", c: "C", "c#": "C#",
  html: "HTML", css: "CSS", scss: "SCSS", "jupyter notebook": "Jupyter",
  react: "React", reactjs: "React", nextjs: "Next.js", "next.js": "Next.js", vue: "Vue", vuejs: "Vue", angular: "Angular", svelte: "Svelte",
  vite: "Vite", tailwindcss: "Tailwind CSS", tailwind: "Tailwind CSS", redux: "Redux", "framer-motion": "Framer Motion",
  nodejs: "Node.js", node: "Node.js", "node.js": "Node.js", express: "Express", expressjs: "Express", nestjs: "NestJS",
  mongodb: "MongoDB", mongoose: "Mongoose", mysql: "MySQL", postgresql: "PostgreSQL", postgres: "PostgreSQL", redis: "Redis", firebase: "Firebase",
  supabase: "Supabase", prisma: "Prisma", graphql: "GraphQL", socketio: "Socket.IO", "socket.io": "Socket.IO",
  django: "Django", flask: "Flask", fastapi: "FastAPI", tensorflow: "TensorFlow", keras: "Keras", pytorch: "PyTorch",
  "scikit-learn": "scikit-learn", opencv: "OpenCV", pandas: "pandas", numpy: "NumPy", langchain: "LangChain", openai: "OpenAI",
  ethereum: "Ethereum", hardhat: "Hardhat", truffle: "Truffle", web3: "Web3.js", ethersjs: "Ethers.js", "ethers.js": "Ethers.js",
  ipfs: "IPFS", metamask: "MetaMask", docker: "Docker", kubernetes: "Kubernetes", aws: "AWS", vercel: "Vercel", cloudinary: "Cloudinary",
  flutter: "Flutter", "react-native": "React Native", android: "Android", ios: "iOS", jwt: "JWT", stripe: "Stripe",
};
const README_SCAN = ["React", "Next.js", "Node.js", "Express", "MongoDB", "PostgreSQL", "MySQL", "Redis", "Tailwind CSS", "TensorFlow", "PyTorch", "Keras", "Flask", "Django", "FastAPI", "Solidity", "Hardhat", "Ethers.js", "Web3.js", "IPFS", "Docker", "Firebase", "Socket.IO", "Cloudinary", "OpenCV", "Flutter", "React Native", "GraphQL", "Prisma", "Stripe"];

const techFrom = (languages, topics, md) => {
  const out = [];
  const add = (name) => name && !out.some((t) => t.toLowerCase() === name.toLowerCase()) && out.push(name);
  Object.entries(languages || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([lang]) => add(NAMES[lang.toLowerCase()] || lang));
  (topics || []).forEach((t) => add(NAMES[t] || (t.length <= 3 ? t.toUpperCase() : t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))));
  const lower = md.toLowerCase();
  README_SCAN.forEach((name) => {
    const re = new RegExp(`(^|[^a-z])${name.toLowerCase().replace(/[.+]/g, "\\$&")}([^a-z]|$)`);
    if (re.test(lower)) add(name);
  });
  return out.slice(0, 16);
};

const guessCategory = (tech, topics) => {
  const has = (...names) => names.some((n) => tech.some((t) => t.toLowerCase() === n.toLowerCase()) || topics.includes(n.toLowerCase()));
  if (has("Solidity", "Ethereum", "blockchain", "Hardhat", "web3", "smart-contracts")) return "Blockchain";
  if (has("TensorFlow", "PyTorch", "Keras", "machine-learning", "deep-learning", "ai", "Jupyter", "scikit-learn", "LangChain", "OpenAI", "nlp", "computer-vision")) return "Artificial Intelligence";
  if (has("Flutter", "React Native", "Kotlin", "Swift", "Dart", "android", "ios")) return "Mobile";
  const front = has("React", "Vue", "Angular", "Svelte", "Next.js", "HTML", "Tailwind CSS");
  const back = has("Express", "Node.js", "MongoDB", "PostgreSQL", "MySQL", "Django", "Flask", "FastAPI", "NestJS", "Prisma");
  if (front && back) return "Full Stack";
  if (front) return "Frontend";
  if (back) return "Backend";
  if (has("Docker", "Kubernetes", "terraform", "devops", "ci-cd")) return "DevOps";
  return "Software Engineering";
};

const humanize = (name) =>
  name
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
const screenshot = (url) => `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=1280&h=800`;

/* ---------- public API ---------- */

export const listRepos = async (usernameOverride) => {
  const username = usernameOverride || (await getConfiguredUsernames()).github;
  if (!OWNER_RE.test(username)) throw httpError("Invalid GitHub username", 400);
  return getOrSetCache(`projects:gh-repos:${username.toLowerCase()}`, 10 * 60, async () => {
    const repos = await gh(`/users/${username}/repos?per_page=100&sort=pushed`);
    if (!repos) throw httpError(`GitHub user "${username}" not found`, 404);
    return {
      username,
      repos: repos.map((r) => ({
        fullName: r.full_name,
        name: r.name,
        description: r.description || "",
        language: r.language || "",
        stars: r.stargazers_count,
        fork: r.fork,
        archived: r.archived,
        homepage: r.homepage || "",
        topics: r.topics || [],
        pushedAt: r.pushed_at,
        url: r.html_url,
      })),
    };
  });
};

export const draftFromRepo = async (input) => {
  const { owner, repo } = parseRepoRef(input);
  return getOrSetCache(`projects:gh-draft:${owner.toLowerCase()}/${repo.toLowerCase()}`, 10 * 60, async () => {
    const info = await gh(`/repos/${owner}/${repo}`);
    if (!info) throw httpError("That repository wasn't found (is it public?)", 404);
    const [languages, readme] = await Promise.all([
      gh(`/repos/${owner}/${repo}/languages`).catch(() => ({})),
      gh(`/repos/${owner}/${repo}/readme`, "application/vnd.github.raw+json").catch(() => ""),
    ]);
    const md = (readme || "").slice(0, 200_000);
    const secs = sections(md);
    const topics = info.topics || [];
    const technologies = techFrom(languages, topics, md);
    const h1 = md.match(/^#\s+(.+)$/m)?.[1];
    const readmeTitle = h1 ? stripMd(h1) : "";
    const title = readmeTitle && readmeTitle.length <= 90 ? readmeTitle : humanize(info.name);
    const intro = firstParagraph(secs);
    const summary = [info.description, intro && intro !== info.description ? intro : ""].filter(Boolean).join("\n\n");
    const homepage = /^https?:\/\//i.test(info.homepage || "") ? info.homepage.trim() : "";
    const images = readmeImages(md, owner, repo, info.default_branch || "main");

    return {
      title: title.slice(0, 200),
      slug: slugify(info.name),
      category: guessCategory(technologies, topics),
      description: (summary || `${title} — source on GitHub.`).slice(0, 5000),
      technologies,
      features: sectionBullets(secs, /feature|highlight|what it does|capabilit|functionalit/i, 12),
      challenges: sectionBullets(secs, /challenge|problem|difficult|limitation/i, 8),
      evaluation: tableMetrics(secs, /evaluat|result|benchmark|metric|performance/i),
      learnings: sectionBullets(secs, /learn|takeaway|lesson/i, 8),
      githubUrl: info.html_url,
      liveUrl: homepage,
      thumbnail: { publicId: "", url: homepage ? screenshot(homepage) : images[0] || `https://opengraph.githubassets.com/portfolio/${info.full_name}` },
      gallery: images.map((url) => ({ publicId: "", url })),
      meta: { stars: info.stargazers_count, forks: info.forks_count, pushedAt: info.pushed_at, socialCard: `https://opengraph.githubassets.com/portfolio/${info.full_name}`, images },
    };
  });
};
