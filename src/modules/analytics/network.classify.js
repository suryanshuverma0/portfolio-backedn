// ---------------------------------------------------------------------------
// Classifies the network owner from an IP lookup ("org") so visits from a
// company / university network can be told apart from home & mobile ISPs
// and cloud servers. Keyword heuristics — good enough to surface "someone
// at Acme Corp opened your portfolio", not a source of truth.
// ---------------------------------------------------------------------------

const HOSTING = [
  "amazon", "aws", "google cloud", "microsoft azure", "azure", "digitalocean", "linode", "akamai",
  "ovh", "hetzner", "vultr", "choopa", "contabo", "leaseweb", "cloudflare", "fastly", "oracle cloud",
  "alibaba", "tencent cloud", "huawei cloud", "scaleway", "m247", "datacamp", "hostinger", "godaddy",
  "ionos", "rackspace", "hosting", "datacenter", "data center", "colocation", "server", "vps", "cdn77",
  "zscaler", "netskope", "packethub", "private internet access", "nordvpn", "expressvpn", "proton",
  "mullvad", "surfshark", "tor exit", "render", "vercel", "heroku", "fly.io",
];

const ISP = [
  "telecom", "telekom", "telecommunication", "broadband", "cable", "mobile", "wireless", "cellular",
  "internet service", "isp", "fiber", "fibre", "dsl", "net pvt", "networks pvt", "communications",
  "comcast", "verizon", "at&t", "t-mobile", "charter", "spectrum", "cox", "centurylink", "lumen",
  "frontier", "sprint", "vodafone", "orange", "telefonica", "movistar", "bt", "british telecommunications",
  "sky", "virgin media", "deutsche telekom", "telstra", "optus", "rogers", "bell canada", "shaw",
  "airtel", "bharti", "jio", "reliance", "bsnl", "vodafone idea", "hathway", "act fibernet", "tata",
  "ncell", "nepal telecom", "worldlink", "vianet", "subisu", "classic tech", "dishhome", "techminds",
  "etisalat", "du", "stc", "mtn", "safaricom", "china telecom", "china unicom", "china mobile",
  "softbank", "kddi", "ntt", "sk broadband", "kt corporation", "lg uplus", "pldt", "globe telecom",
  "telkom", "indosat", "viettel", "true internet", "ais", "maxis", "singtel", "starhub", "pccw",
  "claro", "tim", "vivo", "telmex", "megacable", "free sas", "sfr", "bouygues", "swisscom", "kpn",
  "ziggo", "proximus", "telenor", "telia", "elisa", "turk telekom", "turkcell", "rostelecom", "mts",
  "beeline", "megafon", "kyivstar", "liberty global", "starlink", "spacex",
];

const EDUCATION = ["university", "universit", "college", "institute of technology", "school", "academy", "campus", "edu"];
const GOVERNMENT = ["government", "ministry", "federal", "national agency", "department of", "municipal", "gov"];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Keywords match at the start of a word ("universit" → "University",
// "Universität") but never inside one ("ais" must not match "Raisin").
// Short ones (≤3 chars: "bt", "du", "ais") must be the whole word.
const matcher = (words) =>
  new RegExp(
    `(^|[^a-z0-9])(${words
      .map((word) => (word.length <= 3 ? `${escapeRegex(word)}(?![a-z0-9])` : escapeRegex(word)))
      .join("|")})`,
    "i",
  );

const RULES = {
  education: matcher(EDUCATION),
  government: matcher(GOVERNMENT),
  hosting: matcher(HOSTING),
  isp: matcher(ISP),
};

// "AS15169 Google LLC" → "Google LLC"
export const cleanOrg = (org) => String(org || "").replace(/^AS\d+\s+/i, "").trim();

export const classifyOrg = (org) => {
  const text = cleanOrg(org);

  if (!text) return null;

  return Object.keys(RULES).find((type) => RULES[type].test(text)) || "company";
};

// Organisations worth calling out — someone on a workplace / campus network.
export const NOTABLE_TYPES = ["company", "education", "government"];
