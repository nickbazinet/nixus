import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/lib/test-utils";

const media = vi.hoisted(() => ({
  productTour: {
    src: "/product/film.mp4" as string | undefined,
    poster: "/product/film.webp" as string | undefined,
    width: 1546,
    height: 1080,
  },
}));
vi.mock("@/content/media", () => media);

import { ProductTour } from "./ProductTour";

const FILM = { src: "/product/film.mp4", poster: "/product/film.webp", width: 1546, height: 1080 };
const play = vi.fn(() => Promise.resolve());

beforeEach(() => {
  Object.assign(media.productTour, FILM);
  play.mockClear();
  // jsdom does not implement media playback.
  HTMLMediaElement.prototype.play = play;
});

afterEach(() => {
  Object.assign(media.productTour, FILM);
});

describe("<ProductTour /> with a film", () => {
  it("renders the film from media.ts, loaded only on demand", () => {
    renderWithProviders(<ProductTour />);
    const video = screen.getByTestId("product-tour-video");

    expect(video).toHaveAttribute("src", FILM.src);
    expect(video).toHaveAttribute("poster", FILM.poster);
    expect(video).toHaveAttribute("controls");
    // The poster is all that ships until play is pressed.
    expect(video).toHaveAttribute("preload", "none");
  });

  /* The frame is shaped by the film. A fixed 16:9 here is what made a 1.43:1 screen
   * recording sit in a frame with empty bars either side. */
  it("takes its shape from the film's own size, not from 16:9", () => {
    renderWithProviders(<ProductTour />);
    const frame = screen.getByTestId("product-tour-frame");
    const stage = screen.getByTestId("product-tour-stage");

    expect(frame.style.getPropertyValue("--mkt-tour-ratio")).toBe("1.4315");
    expect(stage.className).toContain("mkt-tour-stage");
    expect(stage.className).not.toMatch(/aspect-(video|\[16\/9\])/);
  });

  it("follows media.ts when the film changes", () => {
    media.productTour.width = 1920;
    media.productTour.height = 1080;
    renderWithProviders(<ProductTour />);

    expect(screen.getByTestId("product-tour-frame").style.getPropertyValue("--mkt-tour-ratio")).toBe(
      "1.7778",
    );
  });

  it("describes what the film shows, as its text alternative", () => {
    renderWithProviders(<ProductTour />);
    const caption = screen.getByTestId("product-tour-frame").querySelector("figcaption");

    expect(caption).toHaveTextContent(/statement import/i);
    expect(caption).toHaveTextContent(/budget/i);
  });

  it("does not claim a duration the film does not have", () => {
    renderWithProviders(<ProductTour />);
    expect(screen.getByRole("heading", { level: 2 })).not.toHaveTextContent(/minute/i);
  });

  describe("play overlay", () => {
    it("is offered before the film starts, and starts it", () => {
      renderWithProviders(<ProductTour />);
      const button = screen.getByRole("button", { name: /play the product tour/i });

      fireEvent.click(button);
      expect(play).toHaveBeenCalledTimes(1);
    });

    it("goes away once playing, however playback was started, and returns at the end", () => {
      renderWithProviders(<ProductTour />);
      const video = screen.getByTestId("product-tour-video");

      // Started from the native controls: no click on the overlay at all.
      fireEvent.play(video);
      expect(screen.queryByTestId("product-tour-play")).not.toBeInTheDocument();

      fireEvent.ended(video);
      expect(screen.getByTestId("product-tour-play")).toBeInTheDocument();
    });
  });
});

describe("<ProductTour /> before a film is configured", () => {
  beforeEach(() => {
    media.productTour.src = undefined;
    media.productTour.poster = undefined;
  });

  /* The stand-in reserves the same box the film will fill, so the page does not move
   * the day the file lands. */
  it("reserves the same shape with a stand-in", () => {
    renderWithProviders(<ProductTour />);

    expect(screen.getByTestId("product-tour-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("product-tour-video")).not.toBeInTheDocument();
    expect(screen.getByTestId("product-tour-frame").style.getPropertyValue("--mkt-tour-ratio")).toBe(
      "1.4315",
    );
  });

  it("shows no caption for a film that is not there", () => {
    renderWithProviders(<ProductTour />);
    expect(screen.getByTestId("product-tour-frame").querySelector("figcaption")).toBeNull();
  });
});
