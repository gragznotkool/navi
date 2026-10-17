import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WebsiteTheme } from "@opshub/contracts";
import { buttonRadius, onColor } from "./themes";

const W = 320;
const H = 200;

/**
 * A miniature of the deployed website, drawn from the theme alone: navigation placement, header
 * style, card, table and button variants, fonts and palette. Rendered at a fixed design size and
 * scaled to fit, so a gallery thumbnail and the large preview are the same drawing.
 */
export function WebsitePreview({ theme, siteName, pages = ["Dashboard", "Inventory", "Requests", "Reports"], className = "" }: { theme: WebsiteTheme; siteName?: string; pages?: string[]; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setScale(e.contentRect.width / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const p = theme.palette;
  const r = parseInt(theme.borderRadius, 10);
  const rad = `${Math.max(0, Math.round(r * 0.5))}px`;
  const btn = theme.buttonStyle === "pill" ? "999px" : theme.buttonStyle === "sharp" ? "0px" : `${Math.round(parseInt(buttonRadius(theme), 10) * 0.5)}px`;
  const font: CSSProperties = { fontFamily: `"${theme.fontFamily}", system-ui, sans-serif` };
  const heading: CSSProperties = { fontFamily: `"${theme.headingFont}", system-ui, sans-serif` };
  const onPrimary = onColor(p.primary, p.text);
  const name = siteName || theme.name;
  const nav = pages.slice(0, 4);
  const glass = theme.cardStyle === "glassmorphic";
  const bar: CSSProperties = { background: glass ? "rgba(255,255,255,0.7)" : p.surface, borderColor: p.border };

  const card: CSSProperties = {
    background: glass ? "rgba(255,255,255,0.6)" : p.surface,
    borderRadius: rad,
    border: theme.cardStyle === "bordered" ? `1.5px solid ${p.border}` : glass ? "1px solid rgba(255,255,255,0.8)" : "1px solid transparent",
    boxShadow: theme.cardStyle === "elevated" ? "0 4px 12px -4px rgba(15,23,42,0.18)" : glass ? "0 4px 14px -6px rgba(46,16,101,0.2)" : "none",
  };

  const header = (() => {
    if (theme.headerStyle === "hero")
      return (
        <div style={{ background: p.primary, color: onPrimary, borderRadius: rad, padding: "10px 12px", position: "relative", overflow: "hidden" }}>
          <span style={{ position: "absolute", right: -14, top: -20, width: 60, height: 60, borderRadius: 99, background: onPrimary, opacity: 0.14 }} />
          <div style={{ fontSize: 7, opacity: 0.85 }}>Welcome back</div>
          <div style={{ ...heading, fontSize: 13, fontWeight: 700 }}>{nav[0]}</div>
        </div>
      );
    if (theme.headerStyle === "centered")
      return (
        <div style={{ textAlign: "center", padding: "2px 0 4px" }}>
          <div style={{ fontSize: 6, color: p.primary, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{name}</div>
          <div style={{ ...heading, fontSize: 12, fontWeight: 700, color: p.text }}>{nav[0]}</div>
          <div style={{ width: 18, height: 2, borderRadius: 2, background: p.primary, margin: "3px auto 0" }} />
        </div>
      );
    if (theme.headerStyle === "split")
      return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${p.border}`, paddingBottom: 5 }}>
          <div>
            <div style={{ fontSize: 6, color: p.muted }}>{name}</div>
            <div style={{ ...heading, fontSize: 12, fontWeight: 700, color: p.text }}>{nav[0]}</div>
          </div>
          <span style={{ fontSize: 6, padding: "2px 6px", borderRadius: btn, background: `${p.primary}22`, color: p.secondary, fontWeight: 600 }}>Admin</span>
        </div>
      );
    return <div style={{ fontSize: 7, color: p.muted }}>{name} / <span style={{ color: p.text }}>{nav[0]}</span></div>;
  })();

  const tableRow = (i: number): CSSProperties => ({
    display: "flex",
    gap: 6,
    padding: "3px 6px",
    fontSize: 6.5,
    color: p.text,
    background: theme.tableStyle === "striped" && i % 2 === 1 ? p.background : theme.tableStyle === "hoverable" && i === 1 ? `${p.primary}1A` : "transparent",
    borderTop: theme.tableStyle === "minimal" ? "none" : `1px solid ${p.border}`,
    borderLeft: theme.tableStyle === "bordered" ? `1px solid ${p.border}` : undefined,
    borderRight: theme.tableStyle === "bordered" ? `1px solid ${p.border}` : undefined,
  });

  const body = (
    <div style={{ flex: 1, minWidth: 0, padding: theme.contentDensity === "compact" ? 8 : theme.contentDensity === "spacious" ? 14 : 11, display: "flex", flexDirection: "column", gap: 7 }}>
      {header}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        {[p.primary, p.accent, p.secondary].map((c, i) => (
          <div key={i} style={{ ...card, padding: "5px 6px" }}>
            <div style={{ fontSize: 5.5, color: p.muted }}>{["On hand", "Pending", "Approved"][i]}</div>
            <div style={{ ...heading, fontSize: 11, fontWeight: 700, color: c }}>{[128, 14, 42][i]}</div>
          </div>
        ))}
      </div>
      <div style={{ ...card, overflow: "hidden", flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px" }}>
          <span style={{ ...heading, fontSize: 7.5, fontWeight: 700, color: p.text }}>{nav[1] ?? "Records"}</span>
          <span style={{ fontSize: 6, padding: "2px 7px", borderRadius: btn, fontWeight: 600, background: theme.buttonStyle === "soft" ? `${p.primary}26` : p.primary, color: theme.buttonStyle === "soft" ? p.secondary : onPrimary }}>New</span>
        </div>
        {["SKU-1042  Bolt kit", "SKU-2210  Sensor", "SKU-3381  Cable"].map((t, i) => (
          <div key={t} style={tableRow(i)}>
            <span style={{ flex: 1 }}>{t}</span>
            <span style={{ color: [p.success, p.warning, p.success][i] }}>●</span>
          </div>
        ))}
      </div>
    </div>
  );

  const brand = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
      <span style={{ width: 12, height: 12, flexShrink: 0, borderRadius: Math.min(r, 4), background: p.primary }} />
      {theme.navStyle !== "icons-only" && <span style={{ ...heading, fontSize: 7.5, fontWeight: 700, color: p.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>}
    </span>
  );
  const navDot = (active: boolean) => <span style={{ width: 6, height: 6, borderRadius: 2, background: active ? p.primary : p.muted, opacity: active ? 1 : 0.5 }} />;

  let frame;
  if (theme.navPosition === "left") {
    const narrow = theme.navStyle === "icons-only";
    frame = (
      <div style={{ display: "flex", height: "100%" }}>
        <div style={{ ...bar, width: narrow ? 28 : 78, borderRight: `1px solid ${p.border}`, padding: 6, display: "flex", flexDirection: "column", gap: 5, alignItems: narrow ? "center" : "stretch" }}>
          {brand}
          <div style={{ height: 4 }} />
          {nav.map((n, i) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 4, padding: narrow ? 3 : "3px 4px", borderRadius: rad, background: i === 0 ? `${p.primary}22` : "transparent", fontSize: 6.5, color: i === 0 ? p.secondary : p.muted, fontWeight: i === 0 ? 700 : 500 }}>
              {navDot(i === 0)}
              {!narrow && n}
            </div>
          ))}
        </div>
        {body}
      </div>
    );
  } else {
    const top = (
      <div style={{ ...bar, height: 24, borderBottom: `1px solid ${p.border}`, display: "flex", alignItems: "center", gap: 10, padding: "0 8px" }}>
        {brand}
        {theme.navPosition === "top" &&
          nav.map((n, i) => (
            <span key={n} style={{ fontSize: 6.5, height: "100%", display: "inline-flex", alignItems: "center", gap: 3, color: i === 0 ? p.secondary : p.muted, fontWeight: i === 0 ? 700 : 500, borderBottom: `2px solid ${i === 0 ? p.primary : "transparent"}` }}>
              {theme.navStyle === "icons-text" && navDot(i === 0)}
              {n}
            </span>
          ))}
        <span style={{ marginLeft: "auto", width: 11, height: 11, borderRadius: 99, background: `${p.primary}33` }} />
      </div>
    );
    frame = (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
        {top}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {body}
          {theme.shell === "workbench" && (
            <div style={{ ...bar, width: 54, borderLeft: `1px solid ${p.border}`, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ ...card, height: 22, padding: 3 }}>
                  <div style={{ height: 3, width: "60%", borderRadius: 2, background: p.muted, opacity: 0.4 }} />
                  <div style={{ height: 5, width: "80%", marginTop: 3, borderRadius: 2, background: p.text, opacity: 0.7 }} />
                </div>
              ))}
            </div>
          )}
        </div>
        {theme.navPosition === "bottom" && (
          <div style={{ ...bar, position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 10, padding: "3px 10px", border: `1px solid ${p.border}`, borderRadius: btn, boxShadow: "0 4px 10px -4px rgba(15,23,42,0.25)" }}>
            {nav.map((n, i) => (
              <span key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, fontSize: 5, color: i === 0 ? p.primary : p.muted, fontWeight: i === 0 ? 700 : 500 }}>
                {navDot(i === 0)}
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={box} className={`relative w-full overflow-hidden ${className}`} style={{ aspectRatio: `${W} / ${H}`, background: p.background, borderRadius: 8 }} aria-label={`Preview of the ${theme.name} theme`} role="img">
      <div style={{ ...font, position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", overflow: "hidden" }}>
        {glass && (
          <>
            <span style={{ position: "absolute", left: -30, top: 30, width: 120, height: 120, borderRadius: 999, background: p.primary, opacity: 0.25, filter: "blur(24px)" }} />
            <span style={{ position: "absolute", right: -20, bottom: -10, width: 130, height: 130, borderRadius: 999, background: p.accent, opacity: 0.22, filter: "blur(24px)" }} />
          </>
        )}
        <div style={{ position: "relative", height: "100%" }}>{frame}</div>
      </div>
    </div>
  );
}
