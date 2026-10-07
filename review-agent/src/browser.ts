// Ported from ~/dev/restaurant-review-agent/src/browser.js — that
// version has already posted a real reply to a real Google review for
// Thrasher's. The DOM-scrape/reply logic below (extractReviewAt,
// submitReply) is kept as close to verbatim as the JS->TS port allows;
// only the surrounding structure changed: cookies/businessId/searchQuery
// now arrive as parameters instead of process.env/cookies.json, and the
// old single run(generateReply) that branched dry-run-draft-all vs.
// live-post-first-N-in-a-loop is split into two functions because v1
// has no automatic live-posting loop — every post is one human-approved
// review at a time, arriving well after the scan that found it.

import { chromium, type Page, type FrameLocator, type Cookie } from "playwright";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type GoogleCookie = Cookie;

export type ExtractedReview = {
  reviewerName: string;
  starRating: number;
  comment: string;
  writtenAt: string | null;
};

export type GenerateReplyFn = (
  reviewerName: string,
  starRating: number,
  comment: string,
) => Promise<string>;

async function withGoogleReviewsPanel<T>(
  cookies: GoogleCookie[],
  businessProfileId: string,
  searchQuery: string,
  fn: (page: Page, frame: () => FrameLocator) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });

  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=en`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await SLEEP(3000);

    await page
      .locator('a:has-text("Read reviews"), button:has-text("Read reviews")')
      .first()
      .click();
    await page.waitForSelector(`iframe[src*="${businessProfileId}"]`, { timeout: 15000 });
    await SLEEP(2000);

    // Re-resolve the frame each time it's used — the iframe URL changes
    // on tab clicks.
    const frame = () => page.frameLocator(`iframe[src*="${businessProfileId}"]`).first();

    await frame().getByText("Unreplied", { exact: true }).first().click();
    await SLEEP(3000);

    return await fn(page, frame);
  } finally {
    await browser.close();
  }
}

// Google's review panel lazy-loads more reviews as you scroll — a
// plain .count() right after opening the Unreplied tab only sees the
// first rendered batch. Repeatedly scrolls the last known review into
// view (the standard way to trigger more loading in this kind of
// infinite-scroll list) until the count stops growing across two
// consecutive checks, so a full backlog import doesn't silently
// under-count past the first screenful.
async function loadAllUnrepliedReviews(frame: () => FrameLocator): Promise<number> {
  const MAX_ROUNDS = 25;
  let currentCount = await frame().getByText("Reply", { exact: true }).count();
  let stableRounds = 0;

  for (let round = 0; round < MAX_ROUNDS && stableRounds < 2; round++) {
    if (currentCount > 0) {
      await frame()
        .getByText("Reply", { exact: true })
        .last()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
    }
    await SLEEP(1200);
    const previousCount = currentCount;
    currentCount = await frame().getByText("Reply", { exact: true }).count();
    stableRounds = currentCount === previousCount ? stableRounds + 1 : 0;
  }

  return currentCount;
}

// Re-locates a specific review among the currently-unreplied list by
// reviewer name + comment text, then posts the given reply to it.
// Deliberately NOT "click the first Reply button" — posting a reply
// can remove that review from the Unreplied list Google shows, which
// would shift every later index. Re-matching by content each time is
// what keeps a loop over several posts safe. Throws a descriptive
// error if the target is no longer found, rather than posting to the
// wrong review or silently no-op'ing. Shared by the explicit
// human-approved /post flow and the inline 5-star auto-send pass
// below — same safety property applies to both.
async function findAndSubmitReply(
  frame: () => FrameLocator,
  targetReviewerName: string,
  targetComment: string,
  replyText: string,
): Promise<void> {
  const found = await frame().getByText("Reply", { exact: true }).count();

  let matchedIndex = -1;
  for (let i = 0; i < found; i++) {
    const review = await extractReviewAt(frame(), i);
    if (review.reviewerName === targetReviewerName && review.comment === targetComment) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex === -1) {
    throw new Error(
      `Review by "${targetReviewerName}" is no longer in the Unreplied list — it may already have a reply, or the review may be gone.`,
    );
  }

  await submitReplyAt(frame(), matchedIndex, replyText);
}

export type ScannedReview = ExtractedReview & {
  replyText: string;
  // Only meaningful when auto-send was requested for this review
  // (5-star, opt-in setting). autoPosted stays false and autoPostError
  // stays undefined for every review scanned with auto-send off.
  autoPosted: boolean;
  autoPostError?: string;
};

// Detects a real, confirmed Google-side bug: the reviews panel
// sometimes stops rendering its review list entirely (both
// "Unreplied" and "All" tabs show "You have no reviews yet") while
// the header star-rating stat right above it still shows the real,
// correct, nonzero review count — a direct contradiction within
// Google's own UI. This is NOT "zero unreplied reviews" (a normal,
// healthy, all-caught-up state) — only the "All" tab also coming up
// empty despite a nonzero total count means the panel itself is
// broken, so that's the tab this checks, not Unreplied.
async function checkPanelHealth(
  frame: () => FrameLocator,
): Promise<{ googleReviewCount: number | null; panelHealthy: boolean }> {
  const overviewText = await frame().locator("body").innerText();
  // Google renders the parenthesis, number, and the word "reviews" as
  // separate lines in innerText (confirmed by direct inspection:
  // "(\n818 reviews\n)") — \s tolerates that instead of assuming
  // everything sits on one line.
  const countMatch = overviewText.match(/\(\s*([\d,]+)\s*reviews?\s*\)/);
  const googleReviewCount = countMatch ? parseInt(countMatch[1].replace(/,/g, ""), 10) : null;

  if (googleReviewCount === null || googleReviewCount === 0) {
    return { googleReviewCount, panelHealthy: true };
  }

  await frame()
    .getByText("All", { exact: true })
    .first()
    .click()
    .catch(() => {});
  await SLEEP(2500);
  const allTabText = await frame()
    .locator("body")
    .innerText()
    .catch(() => "");

  return { googleReviewCount, panelHealthy: !allTabText.includes("You have no reviews yet") };
}

// Reads the currently-unreplied reviews, up to `cap`, and generates a
// Claude draft for each. Read-only by default — the on-demand "Check
// now" button and the periodic background sweep both call this. When
// autoSend5Star is true, any 5-star review is additionally posted
// immediately in a second pass (after every draft has been generated,
// re-matching each one by content right before submitting) — every
// other rating always stays draft-only regardless of this flag.
export async function scanUnrepliedReviews(
  cookies: GoogleCookie[],
  businessProfileId: string,
  searchQuery: string,
  generateReply: GenerateReplyFn,
  isAlreadySaved: (review: ExtractedReview) => Promise<boolean>,
  cap: number,
  autoSend5Star: boolean,
): Promise<{
  found: number;
  extracted: ScannedReview[];
  googleReviewCount: number | null;
  panelHealthy: boolean;
}> {
  return withGoogleReviewsPanel(cookies, businessProfileId, searchQuery, async (_page, frame) => {
    const found = await loadAllUnrepliedReviews(frame);

    // Reviews nobody has replied to on Google stay in the Unreplied tab
    // on every sweep. Checking the DB before drafting (not after) keeps
    // Claude from re-drafting the same saved reviews every 15 minutes,
    // and `cap` limits new drafts rather than how far down the list we
    // look, so newer reviews below already-saved ones still get drafted.
    const drafted: (ExtractedReview & { replyText: string })[] = [];
    for (let i = 0; i < found && drafted.length < cap; i++) {
      const review = await extractReviewAt(frame(), i);
      if (await isAlreadySaved(review)) continue;
      // One failed draft (a Claude API hiccup, a rate limit, an out-of-
      // credits account) used to throw here and lose every review in
      // this batch, including ones already drafted successfully —
      // skip just this one and keep going instead.
      let replyText: string;
      try {
        replyText = await generateReply(review.reviewerName, review.starRating, review.comment);
      } catch (e) {
        console.error(`[scan] failed to draft a reply for "${review.reviewerName}":`, e);
        continue;
      }
      drafted.push({ ...review, replyText });
    }

    const extracted: ScannedReview[] = [];
    for (const review of drafted) {
      if (autoSend5Star && review.starRating === 5) {
        try {
          await findAndSubmitReply(frame, review.reviewerName, review.comment, review.replyText);
          extracted.push({ ...review, autoPosted: true });
        } catch (e) {
          extracted.push({
            ...review,
            autoPosted: false,
            autoPostError: e instanceof Error ? e.message : String(e),
          });
        }
      } else {
        extracted.push({ ...review, autoPosted: false });
      }
    }

    const { googleReviewCount, panelHealthy } = await checkPanelHealth(frame);

    return { found, extracted, googleReviewCount, panelHealthy };
  });
}

export async function postReplyToReview(
  cookies: GoogleCookie[],
  businessProfileId: string,
  searchQuery: string,
  targetReviewerName: string,
  targetComment: string,
  replyText: string,
): Promise<void> {
  await withGoogleReviewsPanel(cookies, businessProfileId, searchQuery, async (_page, frame) =>
    findAndSubmitReply(frame, targetReviewerName, targetComment, replyText),
  );
}

// ─── Extraction ────────────────────────────────────────────────────────

async function extractReviewAt(frame: FrameLocator, index: number): Promise<ExtractedReview> {
  const replyBtn = frame.getByText("Reply", { exact: true }).nth(index);
  await replyBtn.waitFor({ state: "visible", timeout: 8000 });

  // Run the DOM walk in the page context with the Reply button as input.
  return replyBtn.evaluate((replyEl) => {
    let container = replyEl.parentElement;
    for (let depth = 0; depth < 25; depth++) {
      if (!container) break;

      const starEl =
        container.querySelector('[aria-label*="star" i]') ||
        container.querySelector('[aria-label*="out of 5"]');

      if (starEl) {
        const ariaLabel = starEl.getAttribute("aria-label") || "";
        const starMatch = ariaLabel.match(/(\d)/);
        const starRating = starMatch ? parseInt(starMatch[1], 10) : 3;

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const texts: string[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const t = (node.textContent ?? "").trim();
          // A single-digit review age ("3", "5") is only 1 char — must
          // not be filtered out here, or the lookback below never sees
          // it (confirmed via direct DOM inspection: single digits do
          // appear as their own text node, same as multi-digit ones).
          if (t.length > 0) texts.push(t);
        }

        const IGNORE =
          /^(star|Star|review|photo|ago|week|month|year|Local Guide|Translate|Reply|More|Like|Share|View full review|Posted|Edited|NEW)$|^\d/i;
        // Google renders the review's age as TWO separate text nodes —
        // a bare count, then a following "hours ago"/"days ago"/"weeks
        // ago" node — never combined into one "3 hours ago" string like
        // a naive regex would expect (confirmed via direct DOM
        // inspection). Match the unit+"ago" half on its own, then look
        // one node back for the count; "a/an X ago" (no preceding
        // number) defaults to 1.
        const DATE_UNIT_AGO = /^(day|week|month|year|hour|minute)s?\s+ago$/i;
        const BARE_NUMBER = /^\d+$/;
        let reviewerName = "Anonymous";
        let comment = "";
        let writtenRelative: string | null = null;

        for (let idx = 0; idx < texts.length; idx++) {
          const t = texts[idx];
          if (writtenRelative === null && DATE_UNIT_AGO.test(t)) {
            const prev = idx > 0 ? texts[idx - 1] : null;
            const amount = prev && BARE_NUMBER.test(prev) ? prev : "1";
            writtenRelative = `${amount} ${t}`;
          }
          if (
            reviewerName === "Anonymous" &&
            t.length >= 2 &&
            t.length <= 60 &&
            !IGNORE.test(t) &&
            !/star|review|ago|Local Guide/i.test(t)
          ) {
            reviewerName = t;
          } else if (comment === "" && t.length > 20 && t !== reviewerName && !IGNORE.test(t)) {
            comment = t;
          }
          if (reviewerName !== "Anonymous" && comment !== "" && writtenRelative !== null) break;
        }

        let writtenAt: string | null = null;
        if (writtenRelative) {
          const m = writtenRelative.match(/^(\d+)\s+(day|week|month|year|hour|minute)s?\s+ago$/i);
          if (m) {
            const amount = parseInt(m[1], 10);
            const unit = m[2].toLowerCase();
            const msPerUnit: Record<string, number> = {
              minute: 60_000,
              hour: 3_600_000,
              day: 86_400_000,
              week: 7 * 86_400_000,
              month: 30 * 86_400_000, // approximate — Google doesn't give exact dates
              year: 365 * 86_400_000,
            };
            writtenAt = new Date(Date.now() - amount * msPerUnit[unit]).toISOString();
          }
        }

        return { reviewerName, starRating, comment, writtenAt };
      }

      container = container.parentElement;
    }

    throw new Error("Could not find review container with star rating");
  });
}

// ─── Reply posting ─────────────────────────────────────────────────────

async function submitReplyAt(frame: FrameLocator, index: number, replyText: string): Promise<void> {
  const replyLink = frame.getByText("Reply", { exact: true }).nth(index);
  await replyLink.waitFor({ state: "visible", timeout: 8000 });
  await replyLink.click();
  await SLEEP(2000);

  const textarea = frame.locator("textarea").last();
  await textarea.waitFor({ state: "visible", timeout: 8000 });
  await textarea.fill(replyText);
  await SLEEP(800);

  // The submit button is also labeled "Reply" — find it via the Cancel
  // button's shared container, then click the sibling Reply button.
  const cancelBtn = frame.getByText("Cancel", { exact: true }).first();
  await cancelBtn.waitFor({ state: "visible", timeout: 5000 });

  await cancelBtn.evaluate((cancelEl) => {
    let container = cancelEl.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      const submitReply = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Reply" && b !== cancelEl,
      );
      if (submitReply) {
        (submitReply as HTMLButtonElement).click();
        return;
      }
      container = container.parentElement;
    }
    throw new Error("Could not find submit Reply button next to Cancel");
  });
  await SLEEP(3000);
}
