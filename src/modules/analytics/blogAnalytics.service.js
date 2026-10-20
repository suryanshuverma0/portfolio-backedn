import PageView from "./analytics.model.js";
import { VisitorSession, VisitorEvent } from "./journey.model.js";
import { categorizeReferrer } from "./analytics.service.js";
import Post from "../blog/blog.model.js";
import Comment from "../blog/comment.model.js";
import { getOrSetCache } from "../../utils/cache.js";

// ---------------------------------------------------------------------------
// Blog & comments analytics. Views come from PageView (full history);
// engagement (read time, scroll, completion, clicks, sources) from the
// journey events. Everything is bucketed in the admin's timezone.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const BLOG_POST_PATH = /^\/blog\/[^/]+$/;
const BLOG_ANY_PATH = /^\/blog(\/|$)/;

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : 0);
const change = (cur, prev) => (!prev ? (cur > 0 ? 100 : 0) : round1(((cur - prev) / prev) * 100));
const avg = (list) => (list.length ? list.reduce((t, v) => t + v, 0) / list.length : 0);
const slugOf = (path) => decodeURIComponent(path.slice(6));
const wordsOf = (text = "") => text.trim().split(/\s+/).filter(Boolean).length;

const dayFmt = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
const partsFmt = (tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const getBlogAnalytics = async (rangeDays, tz) =>
  getOrSetCache(`analytics:blog:v1:${rangeDays}:${tz}`, 180, async () => {
    const now = Date.now();
    const since = new Date(now - rangeDays * DAY_MS);
    const prevSince = new Date(since.getTime() - rangeDays * DAY_MS);
    const toDay = dayFmt(tz);
    const toParts = partsFmt(tz);

    const [posts, viewRows, prevViewRows, blogEvents, comments] = await Promise.all([
      Post.find({}).select("title slug isVisible publishedAt createdAt updatedAt readingTime tags content excerpt").lean(),
      PageView.find({ createdAt: { $gte: since }, path: BLOG_ANY_PATH }).select("path visitorId createdAt country device").lean(),
      PageView.aggregate([
        { $match: { createdAt: { $gte: prevSince, $lt: since }, path: BLOG_POST_PATH } },
        { $group: { _id: "$path", views: { $sum: 1 } } },
      ]),
      VisitorEvent.find({
        at: { $gte: since },
        path: BLOG_ANY_PATH,
        type: { $in: ["page_view", "page_leave", "scroll_depth", "click", "outbound_click", "download", "contact_link"] },
      })
        .select("type path sessionId value label target at")
        .lean(),
      Comment.find({}).select("post name email content isApproved createdAt").lean(),
    ]);

    const postViews = viewRows.filter((v) => BLOG_POST_PATH.test(v.path));
    const prevViewMap = new Map(prevViewRows.map((r) => [slugOf(r._id), r.views]));

    /* ---------- reader sessions (sources, devices, countries, new vs returning) ---------- */

    const sessionIds = [...new Set(blogEvents.filter((e) => e.type === "page_view").map((e) => e.sessionId))];
    const sessions = await VisitorSession.find({ sessionId: { $in: sessionIds }, isBot: { $ne: true } })
      .select("sessionId visitorId referrer utm device location entryPage startedAt")
      .lean();
    const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

    const firstSeen = sessions.length
      ? await VisitorSession.aggregate([
          { $match: { visitorId: { $in: [...new Set(sessions.map((s) => s.visitorId))] } } },
          { $group: { _id: "$visitorId", first: { $min: "$startedAt" } } },
        ])
      : [];
    const firstMap = new Map(firstSeen.map((r) => [r._id, new Date(r.first).getTime()]));

    /* ---------- per-post engagement ---------- */

    const perPost = new Map();
    const bucket = (slug) => {
      if (!perPost.has(slug)) {
        perPost.set(slug, { sessions: new Set(), visitors: new Set(), times: [], scrollBySession: new Map(), clicks: 0 });
      }
      return perPost.get(slug);
    };

    blogEvents.forEach((e) => {
      if (!BLOG_POST_PATH.test(e.path)) return;
      const b = bucket(slugOf(e.path));
      if (e.type === "page_view") {
        b.sessions.add(e.sessionId);
        const s = sessionMap.get(e.sessionId);
        if (s) b.visitors.add(s.visitorId);
      } else if (e.type === "page_leave" && e.value > 0) b.times.push(e.value);
      else if (e.type === "scroll_depth") b.scrollBySession.set(e.sessionId, Math.max(b.scrollBySession.get(e.sessionId) || 0, e.value || 0));
      else b.clicks += 1;
    });

    const commentsByPost = new Map();
    comments.forEach((c) => {
      const key = String(c.post);
      if (!commentsByPost.has(key)) commentsByPost.set(key, []);
      commentsByPost.get(key).push(c);
    });

    const viewsBySlug = new Map();
    postViews.forEach((v) => {
      const slug = slugOf(v.path);
      viewsBySlug.set(slug, (viewsBySlug.get(slug) || 0) + 1);
    });

    const postRows = posts
      .map((p) => {
        const b = perPost.get(p.slug);
        const views = viewsBySlug.get(p.slug) || 0;
        const scrolls = b ? [...b.scrollBySession.values()] : [];
        const avgTimeMs = b ? Math.round(avg(b.times)) : 0;
        const postComments = commentsByPost.get(String(p._id)) || [];
        const commentsInRange = postComments.filter((c) => new Date(c.createdAt) >= since).length;
        const words = wordsOf(p.content);
        return {
          _id: p._id,
          title: p.title,
          slug: p.slug,
          status: p.isVisible ? "published" : "draft",
          publishedAt: p.publishedAt,
          tags: p.tags || [],
          words,
          readingTime: p.readingTime || 1,
          views,
          viewsChange: change(views, prevViewMap.get(p.slug) || 0),
          readers: b ? b.visitors.size : 0,
          avgTimeMs,
          // How much of the expected reading time people actually spend.
          readRatio: avgTimeMs ? Math.min(200, Math.round((avgTimeMs / ((p.readingTime || 1) * 60000)) * 100)) : 0,
          avgScroll: Math.round(avg(scrolls)),
          completionRate: pct(scrolls.filter((s) => s >= 90).length, b ? b.sessions.size : 0),
          clicks: b ? b.clicks : 0,
          comments: postComments.length,
          commentsInRange,
          pendingComments: postComments.filter((c) => !c.isApproved).length,
          engagementRate: pct(commentsInRange, views),
        };
      })
      .sort((a, b) => b.views - a.views);

    /* ---------- daily, weekday × hour ---------- */

    const days = [];
    for (let i = rangeDays - 1; i >= 0; i -= 1) {
      const k = toDay.format(new Date(now - i * DAY_MS));
      if (!days.includes(k)) days.push(k);
    }
    const daily = new Map(days.map((d) => [d, { date: d, views: 0, readers: new Set(), comments: 0 }]));
    viewRows.forEach((v) => {
      const row = daily.get(toDay.format(v.createdAt));
      if (row) {
        row.views += 1;
        row.readers.add(v.visitorId);
      }
    });
    comments.forEach((c) => {
      const row = daily.get(toDay.format(c.createdAt));
      if (row) row.comments += 1;
    });

    const heat = new Map();
    postViews.forEach((v) => {
      const parts = Object.fromEntries(toParts.formatToParts(v.createdAt).map((p) => [p.type, p.value]));
      const key = `${WEEKDAYS.indexOf(parts.weekday)}-${Number(parts.hour) % 24}`;
      heat.set(key, (heat.get(key) || 0) + 1);
    });

    /* ---------- sources, audience ---------- */

    const sourceCounts = new Map();
    const hostCounts = new Map();
    sessions.forEach((s) => {
      const { source, hostname } = s.utm?.medium === "card" ? { source: "Card" } : categorizeReferrer(s.referrer);
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
      if (hostname) hostCounts.set(hostname, (hostCounts.get(hostname) || 0) + 1);
    });
    const countBy = (list, fn) => {
      const m = new Map();
      list.forEach((x) => {
        const k = fn(x);
        if (k) m.set(k, (m.get(k) || 0) + 1);
      });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const readerTotal = sessions.length;
    const newReaders = sessions.filter((s) => firstMap.get(s.visitorId) === new Date(s.startedAt).getTime()).length;

    /* ---------- tags ---------- */

    const tagStats = new Map();
    postRows.forEach((p) =>
      p.tags.forEach((t) => {
        const cur = tagStats.get(t) || { tag: t, posts: 0, views: 0, comments: 0 };
        cur.posts += 1;
        cur.views += p.views;
        cur.comments += p.comments;
        tagStats.set(t, cur);
      }),
    );

    /* ---------- comments ---------- */

    const commentsInRange = comments.filter((c) => new Date(c.createdAt) >= since);
    const commentsPrev = comments.filter((c) => new Date(c.createdAt) >= prevSince && new Date(c.createdAt) < since);
    const commenters = new Map();
    comments.forEach((c) => {
      const key = (c.email || c.name || "").toLowerCase();
      const cur = commenters.get(key) || { name: c.name, email: c.email, count: 0, approved: 0, last: c.createdAt };
      cur.count += 1;
      if (c.isApproved) cur.approved += 1;
      if (new Date(c.createdAt) > new Date(cur.last)) cur.last = c.createdAt;
      commenters.set(key, cur);
    });
    const postTitle = new Map(posts.map((p) => [String(p._id), p.title]));
    const lengths = comments.map((c) => wordsOf(c.content));
    const lengthBuckets = [
      ["1–10 words", (n) => n <= 10],
      ["11–30", (n) => n > 10 && n <= 30],
      ["31–80", (n) => n > 30 && n <= 80],
      ["80+", (n) => n > 80],
    ].map(([label, test]) => ({ label, count: lengths.filter(test).length }));

    /* ---------- publishing cadence (12 months) ---------- */

    const monthFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" });
    const months = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - i);
      months.push(monthFmt.format(d));
    }
    const cadence = months.map((m) => ({
      month: m,
      published: posts.filter((p) => p.publishedAt && monthFmt.format(p.publishedAt) === m).length,
      comments: comments.filter((c) => monthFmt.format(c.createdAt) === m).length,
    }));

    /* ---------- outbound clicks from posts ---------- */

    const clickTargets = countBy(
      blogEvents.filter((e) => ["outbound_click", "download", "contact_link", "click"].includes(e.type) && BLOG_POST_PATH.test(e.path)),
      (e) => e.label || e.target,
    ).slice(0, 10);

    const published = posts.filter((p) => p.isVisible);
    const totalViews = postViews.length;
    const prevTotal = prevViewRows.reduce((t, r) => t + r.views, 0);
    const allTimes = [...perPost.values()].flatMap((b) => b.times);
    const allScroll = [...perPost.values()].flatMap((b) => [...b.scrollBySession.values()]);
    const totalSessionsOnPosts = [...perPost.values()].reduce((t, b) => t + b.sessions.size, 0);

    return {
      range: rangeDays,
      timezone: tz,
      totals: {
        posts: posts.length,
        published: published.length,
        drafts: posts.length - published.length,
        totalWords: posts.reduce((t, p) => t + wordsOf(p.content), 0),
        avgWords: Math.round(avg(posts.map((p) => wordsOf(p.content)))),
        avgReadingTime: round1(avg(posts.map((p) => p.readingTime || 1))),
        views: totalViews,
        viewsChange: change(totalViews, prevTotal),
        indexViews: viewRows.length - totalViews,
        readers: new Set(postViews.map((v) => v.visitorId)).size,
        avgTimeMs: Math.round(avg(allTimes)),
        avgScroll: Math.round(avg(allScroll)),
        completionRate: pct(allScroll.filter((s) => s >= 90).length, totalSessionsOnPosts),
        comments: comments.length,
        commentsInRange: commentsInRange.length,
        commentsChange: change(commentsInRange.length, commentsPrev.length),
        approved: comments.filter((c) => c.isApproved).length,
        pending: comments.filter((c) => !c.isApproved).length,
        approvalRate: pct(comments.filter((c) => c.isApproved).length, comments.length),
        commenters: commenters.size,
        commentsPer100Views: totalViews ? round1((commentsInRange.length / totalViews) * 100) : 0,
        avgCommentWords: Math.round(avg(lengths)),
        newReaderShare: pct(newReaders, readerTotal),
      },
      posts: postRows,
      daily: [...daily.values()].map((d) => ({ date: d.date, views: d.views, readers: d.readers.size, comments: d.comments })),
      heatmap: [...heat.entries()].map(([k, count]) => {
        const [day, hour] = k.split("-").map(Number);
        return { day, hour, count };
      }),
      sources: ["Direct", "Search", "Social", "Referral", "Card"]
        .map((label) => ({ label, count: sourceCounts.get(label) || 0 }))
        .filter((s) => s.count)
        .map((s) => ({ ...s, percent: pct(s.count, readerTotal) })),
      referrers: [...hostCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([host, count]) => ({ host, count })),
      devices: countBy(sessions, (s) => s.device).map(([device, count]) => ({ device, count, percent: pct(count, readerTotal) })),
      countries: countBy(sessions, (s) => s.location?.country).slice(0, 8).map(([country, count]) => ({ country, count })),
      newVsReturning: { new: newReaders, returning: readerTotal - newReaders },
      tags: [...tagStats.values()].sort((a, b) => b.views - a.views).slice(0, 12),
      cadence,
      clicks: clickTargets.map(([label, count]) => ({ label, count })),
      comments: {
        status: [
          { label: "Approved", count: comments.filter((c) => c.isApproved).length },
          { label: "Pending", count: comments.filter((c) => !c.isApproved).length },
        ],
        lengthBuckets,
        topCommenters: [...commenters.values()].sort((a, b) => b.count - a.count).slice(0, 8),
        byPost: postRows.filter((p) => p.comments).map((p) => ({ title: p.title, comments: p.comments, pending: p.pendingComments })).sort((a, b) => b.comments - a.comments).slice(0, 10),
        recent: comments
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 10)
          .map((c) => ({ _id: c._id, name: c.name, content: c.content.slice(0, 220), isApproved: c.isApproved, createdAt: c.createdAt, post: postTitle.get(String(c.post)) || "Deleted post" })),
      },
    };
  });
