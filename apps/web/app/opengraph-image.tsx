import { ImageResponse } from "next/og";

/**
 * Static OG image (F5 ship plumbing, owner: ledger-finish-proof).
 * Inline SVG-styled divs only — no new deps. Palette = spec-18 tokens:
 * warm-dark bg hsl(240 10% 4%), deep-indigo primary hsl(243 75% 66%),
 * mint accent hsl(162 63% 50%).
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "96px",
          backgroundColor: "hsl(240, 10%, 4%)",
          color: "hsl(0, 0%, 98%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "12px",
              backgroundColor: "hsl(243, 75%, 66%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "32px",
              fontWeight: 700,
            }}
          >
            A
          </div>
          <div style={{ fontSize: "32px", fontWeight: 600 }}>AgentLedger</div>
        </div>
        <div style={{ fontSize: "72px", fontWeight: 700, lineHeight: 1.1 }}>
          AI spend, explained.
        </div>
        <div
          style={{
            marginTop: "24px",
            fontSize: "32px",
            color: "hsl(162, 63%, 50%)",
          }}
        >
          One proxy. Full visibility. 40–70% less spend.
        </div>
      </div>
    ),
    { ...size },
  );
}
