import { expect, test } from "@playwright/test";

/**
 * The product-tour frame.
 *
 * Geometry is asserted, not appearance: the frame must take the film's own shape (not a
 * 16:9 default), and must fit on screen, because a film taller than 16:9 at full width can
 * be taller than a laptop viewport and push its controls below the fold.
 *
 * Playback itself is NOT asserted here. The browsers this suite drives are Playwright's
 * bundled Chromium, which ships without the H.264 decoder, so `videoWidth` reads 0 and
 * `play()` rejects no matter how good the file is. Decoding was verified once, by hand,
 * in real Chrome and WebKit; what stays checkable in CI is the contract around the file —
 * the shape of the box, and that the server answers byte-range requests, which every
 * browser's seek bar and Safari's player both depend on.
 */

const FILM = { width: 1546, height: 1080 } as const;
const RATIO = FILM.width / FILM.height;
/** `.mkt-tour` caps the frame to the viewport height minus 9rem (144px). */
const CHROME_BUDGET = 144;

test.describe("product tour frame", () => {
  test("takes the film's shape and fits the screen", async ({ page }) => {
    await page.goto("/");
    const stage = page.getByTestId("product-tour-stage");
    await stage.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900); // reveal transition

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    const { width, height } = box ?? { width: 0, height: 0 };

    // Same shape as the film, to within a pixel of rounding.
    expect(Math.abs(width / height - RATIO) / RATIO).toBeLessThan(0.01);

    // Not the 16:9 it was before: 1.78 would be 24% wider than this at the same height.
    expect(width / height).toBeLessThan(1.6);

    // The whole frame is on screen at once, with room for the sticky header.
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(height).toBeLessThanOrEqual((viewport?.height ?? 0) - CHROME_BUDGET + 2);
  });

  test("offers a play control and loads nothing until it is used", async ({ page }) => {
    const filmRequests: string[] = [];
    page.on("request", (request) => {
      if (/tour-v\d+\.mp4/.test(request.url())) filmRequests.push(request.url());
    });

    await page.goto("/");
    const video = page.getByTestId("product-tour-video");
    await video.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);

    await expect(page.getByTestId("product-tour-play")).toBeVisible();
    await expect(video).toHaveAttribute("preload", "none");
    await expect(video).toHaveAttribute("poster", /tour-v\d+-poster\.webp$/);
    // 5.5 MB that most visitors never ask for.
    expect(filmRequests).toEqual([]);
  });

  test("does not overflow horizontally or clip the caption", async ({ page }) => {
    await page.goto("/");
    const frame = page.getByTestId("product-tour-frame");
    await frame.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);

    const report = await frame.evaluate((el) => {
      const caption = el.querySelector("figcaption");
      const doc = document.documentElement;
      return {
        pageOverflow: doc.scrollWidth - doc.clientWidth,
        captionClipped: caption ? caption.scrollWidth > caption.clientWidth + 1 : null,
        stageInsideFigure:
          (el.querySelector("[data-testid=product-tour-stage]")?.getBoundingClientRect().width ?? 0) <=
          el.getBoundingClientRect().width + 1,
      };
    });
    expect(report).toEqual({ pageOverflow: 0, captionClipped: false, stageInsideFigure: true });
  });
});

/* Video needs byte ranges: Safari will not play a file it cannot seek, and every browser's
 * scrub bar issues them. S3 behind CloudFront answers them natively; this checks the local
 * production-artifact server does too, so a green run here means something about playback. */
test.describe("film delivery", () => {
  test("is served as video/mp4 and honours byte ranges", async ({ request }) => {
    const whole = await request.head("/product/tour-v1.mp4");
    expect(whole.status()).toBe(200);
    expect(whole.headers()["content-type"]).toBe("video/mp4");
    expect(whole.headers()["accept-ranges"]).toBe("bytes");
    const size = Number(whole.headers()["content-length"]);
    expect(size).toBeGreaterThan(1_000_000);

    const head = await request.get("/product/tour-v1.mp4", { headers: { range: "bytes=0-1023" } });
    expect(head.status()).toBe(206);
    expect(head.headers()["content-range"]).toBe(`bytes 0-1023/${size}`);
    expect((await head.body()).length).toBe(1024);

    // A browser reads the tail first when the index is at the end of the file.
    const tail = await request.get("/product/tour-v1.mp4", { headers: { range: "bytes=-512" } });
    expect(tail.status()).toBe(206);
    expect((await tail.body()).length).toBe(512);

    const beyond = await request.get("/product/tour-v1.mp4", { headers: { range: `bytes=${size + 10}-` } });
    expect(beyond.status()).toBe(416);
  });

  test("keeps the index at the front so playback can start before the download ends", async ({
    request,
  }) => {
    const head = await request.get("/product/tour-v1.mp4", { headers: { range: "bytes=0-4095" } });
    const bytes = await head.body();
    const atoms: string[] = [];
    for (let pos = 0; pos + 8 <= bytes.length; ) {
      const size = bytes.readUInt32BE(pos);
      atoms.push(bytes.toString("latin1", pos + 4, pos + 8));
      if (size < 8) break;
      pos += size;
    }
    // `moov` (the index) must appear before `mdat` (the frames).
    expect(atoms).toContain("moov");
    expect(atoms.indexOf("moov")).toBeLessThan(atoms.includes("mdat") ? atoms.indexOf("mdat") : Infinity);
  });
});
