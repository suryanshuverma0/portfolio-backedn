import Settings from "../settings/settings.model.js";
import { getOrSetCache } from "../../utils/cache.js";
import logger from "../../utils/logger.js";

/*
  Fallback usernames — used only when the admin hasn't filled in
  socials.github / socials.leetcode in Settings yet. Settings always wins
  once set, so this never goes stale on its own.
*/
const DEFAULT_GITHUB_USERNAME = "suryanshuverma0";
const DEFAULT_LEETCODE_USERNAME = "suryanahu0";

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour — real data, just not per-request

const usernameFromUrl = (url) => {
  if (!url) return null;

  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    // GitHub profile URLs are just "/username"; LeetCode's are "/u/username".
    const segments = path.split("/").filter(Boolean);
    return segments[segments.length - 1] || null;
  } catch {
    return null;
  }
};

const getConfiguredUsernames = async () => {
  const settings = await Settings.findOne({}).select("socials").lean();

  return {
    github: usernameFromUrl(settings?.socials?.github) || DEFAULT_GITHUB_USERNAME,
    leetcode: usernameFromUrl(settings?.socials?.leetcode) || DEFAULT_LEETCODE_USERNAME,
  };
};

// ---------------------------------------------------------------------------
// GitHub — public REST API, no auth needed for a user's public profile/repos.
// ---------------------------------------------------------------------------

export const getGitHubStats = async () => {
  const { github: username } = await getConfiguredUsernames();

  return getOrSetCache(`integrations:github:${username}`, CACHE_TTL_SECONDS, async () => {
    const [profileRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`, {
        headers: { Accept: "application/vnd.github+json" },
      }),
      fetch(`https://api.github.com/users/${username}/repos?per_page=100`, {
        headers: { Accept: "application/vnd.github+json" },
      }),
    ]);

    if (!profileRes.ok) {
      throw new Error(`GitHub profile fetch failed (${profileRes.status})`);
    }

    const profile = await profileRes.json();
    const repos = reposRes.ok ? await reposRes.json() : [];

    const topRepos = [...repos]
      .filter((repo) => !repo.fork)
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .slice(0, 6)
      .map((repo) => ({
        name: repo.name,
        description: repo.description,
        url: repo.html_url,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        updatedAt: repo.updated_at,
      }));

    const totalStars = repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);

    return {
      username: profile.login,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      bio: profile.bio,
      profileUrl: profile.html_url,
      publicRepos: profile.public_repos,
      followers: profile.followers,
      following: profile.following,
      totalStars,
      topRepos,
    };
  });
};

// ---------------------------------------------------------------------------
// LeetCode — no official public API. This queries the same unofficial
// GraphQL endpoint leetcode.com's own frontend uses for public profile
// stats (a well-established community pattern for "solved problems"
// widgets). Cached for an hour specifically so this app is never hammering
// it per-visitor.
// ---------------------------------------------------------------------------

const LEETCODE_QUERY = `
  query getUserProfile($username: String!) {
    matchedUser(username: $username) {
      username
      submitStats {
        acSubmissionNum {
          difficulty
          count
        }
      }
      profile {
        ranking
        userAvatar
      }
    }
  }
`;

export const getLeetCodeStats = async () => {
  const { leetcode: username } = await getConfiguredUsernames();

  return getOrSetCache(`integrations:leetcode:${username}`, CACHE_TTL_SECONDS, async () => {
    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://leetcode.com",
      },
      body: JSON.stringify({
        query: LEETCODE_QUERY,
        variables: { username },
      }),
    });

    if (!response.ok) {
      throw new Error(`LeetCode fetch failed (${response.status})`);
    }

    const { data } = await response.json();
    const user = data?.matchedUser;

    if (!user) {
      throw new Error("LeetCode user not found");
    }

    const counts = Object.fromEntries(
      user.submitStats.acSubmissionNum.map((row) => [row.difficulty, row.count]),
    );

    return {
      username: user.username,
      profileUrl: `https://leetcode.com/u/${user.username}/`,
      avatarUrl: user.profile.userAvatar,
      ranking: user.profile.ranking,
      totalSolved: counts.All || 0,
      easySolved: counts.Easy || 0,
      mediumSolved: counts.Medium || 0,
      hardSolved: counts.Hard || 0,
    };
  });
};

export const getIntegrationsStatus = async () => {
  const results = await Promise.allSettled([getGitHubStats(), getLeetCodeStats()]);

  const [github, leetcode] = results;

  if (github.status === "rejected") {
    logger.warn({ action: "GITHUB_STATS_FAILED", reason: github.reason?.message });
  }

  if (leetcode.status === "rejected") {
    logger.warn({ action: "LEETCODE_STATS_FAILED", reason: leetcode.reason?.message });
  }

  return {
    github: github.status === "fulfilled" ? github.value : null,
    leetcode: leetcode.status === "fulfilled" ? leetcode.value : null,
  };
};
