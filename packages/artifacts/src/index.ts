import type { LPBrief, LPSection } from "@lp-agent/lp-schema";

export interface StaticArtifacts {
  indexHtml: string;
  stylesCss: string;
  scriptJs: string;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const safeUrl = (value: string | undefined): string => {
  if (!value) {
    return "#";
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("//")) {
    return "#";
  }

  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:") {
      return trimmed;
    }
  } catch {
    return "#";
  }

  return "#";
};

const safeCssColor = (value: string | undefined, fallback: string): string => {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  const isHex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed);
  const isFunctionalColor = /^(?:rgb|rgba|hsl|hsla)\(\s*[-+.\d%]+(?:\s*,\s*[-+.\d%]+){2,3}\s*\)$/.test(trimmed);
  const namedColors = new Set(["black", "white", "transparent", "currentColor"]);

  return isHex || isFunctionalColor || namedColors.has(trimmed) ? trimmed : fallback;
};

const safeFontFamily = (value: string | undefined): string => {
  if (!value) {
    return "system-ui";
  }

  const trimmed = value.trim();
  return /^[\w\s"',-]+$/.test(trimmed) ? trimmed : "system-ui";
};

const escapeStyleContent = (value: string): string =>
  value.replace(/<\/style/gi, "<\\/style");

const escapeScriptContent = (value: string): string =>
  value.replace(/<\/script/gi, "<\\/script");

const toSectionHtml = (section: LPSection): string => {
  const cta = section.cta
    ? `<a class="button" href="${escapeHtml(safeUrl(section.cta.href))}" data-track="cta:${escapeHtml(section.id)}">${escapeHtml(section.cta.label)}</a>`
    : "";

  return [
    `<section class="lp-section lp-section-${escapeHtml(section.type)}" id="${escapeHtml(section.id)}">`,
    `  <div class="section-copy">`,
    `    <p class="eyebrow">${escapeHtml(section.purpose)}</p>`,
    `    <h2>${escapeHtml(section.headline)}</h2>`,
    `    <p>${escapeHtml(section.body)}</p>`,
    cta ? `    ${cta}` : "",
    `  </div>`,
    `</section>`
  ].filter(Boolean).join("\n");
};

const productGridHtml = (brief: LPBrief): string => {
  if (brief.productData.length === 0) {
    return "";
  }

  const cards = brief.productData.map((product) => [
    `<article class="product-card" data-track="product:${escapeHtml(product.id)}">`,
    product.imageUrl ? `  <img src="${escapeHtml(safeUrl(product.imageUrl))}" alt="${escapeHtml(product.name)}">` : "",
    `  <h3>${escapeHtml(product.name)}</h3>`,
    `  <p>${escapeHtml(product.description)}</p>`,
    product.price ? `  <strong>${escapeHtml(product.price)}</strong>` : "",
    `</article>`
  ].filter(Boolean).join("\n")).join("\n");

  return `<section class="lp-section product-grid" id="products">\n<h2>Featured products</h2>\n<div class="products">\n${cards}\n</div>\n</section>`;
};

export const generateStaticArtifacts = (brief: LPBrief): StaticArtifacts => {
  const primaryColor = safeCssColor(brief.brandProfile.colors[0], "#0f766e");
  const accentColor = safeCssColor(brief.brandProfile.colors[1], "#f59e0b");
  const textColor = safeCssColor(brief.brandProfile.colors[2], "#111827");
  const fontFamily = safeFontFamily(brief.brandProfile.typography);
  const sectionHtml = brief.sections.map(toSectionHtml).join("\n\n");
  const products = productGridHtml(brief);

  const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(brief.seo.title)}</title>
  <meta name="description" content="${escapeHtml(brief.seo.description)}">
  ${brief.seo.socialImage ? `<meta property="og:image" content="${escapeHtml(safeUrl(brief.seo.socialImage))}">` : ""}
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <strong>${escapeHtml(brief.brandProfile.name)}</strong>
    <a href="${escapeHtml(safeUrl(brief.cta.href))}" data-track="cta:header">${escapeHtml(brief.cta.label)}</a>
  </header>
  <main data-page-title="${escapeHtml(brief.title)}">
${sectionHtml}
${products}
  </main>
  <script src="script.js"></script>
</body>
</html>`;

  const stylesCss = `:root {
  --color-primary: ${primaryColor};
  --color-accent: ${accentColor};
  --color-text: ${textColor};
  --color-bg: #ffffff;
  --font-body: ${fontFamily};
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-body), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--color-text);
  background: var(--color-bg);
}
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px clamp(20px, 5vw, 64px);
  background: rgba(255, 255, 255, 0.94);
  border-bottom: 1px solid #e5e7eb;
}
.site-header a,
.button {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 6px;
  color: white;
  background: var(--color-primary);
  text-decoration: none;
  font-weight: 700;
}
.lp-section {
  padding: clamp(48px, 8vw, 96px) clamp(20px, 5vw, 72px);
  border-bottom: 1px solid #eef2f7;
}
.lp-section-hero {
  min-height: 72vh;
  display: grid;
  align-items: center;
  background: linear-gradient(135deg, #f8fafc, #ecfeff);
}
.section-copy {
  max-width: 760px;
}
.eyebrow {
  color: var(--color-primary);
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.78rem;
  letter-spacing: 0;
}
h2 {
  margin: 0 0 18px;
  font-size: clamp(2rem, 5vw, 4.5rem);
  line-height: 1;
}
p {
  max-width: 68ch;
  font-size: 1.08rem;
  line-height: 1.7;
}
.products {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.product-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 18px;
  background: #ffffff;
}
.product-card img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 6px;
}
@media (max-width: 760px) {
  .site-header {
    gap: 12px;
    align-items: flex-start;
    flex-direction: column;
  }
  .products {
    grid-template-columns: 1fr;
  }
}`;

  const scriptJs = `document.querySelectorAll("[data-track]").forEach((element) => {
  element.addEventListener("click", () => {
    const eventName = element.getAttribute("data-track");
    window.dispatchEvent(new CustomEvent("lp-agent-track", { detail: { eventName } }));
  });
});`;

  return { indexHtml, stylesCss, scriptJs };
};

export const bundleSingleFileHtml = (artifact: StaticArtifacts): string => {
  const stylesheetMarker = '<link rel="stylesheet" href="styles.css">';
  const scriptMarker = '  <script src="script.js"></script>';

  if (!artifact.indexHtml.includes(stylesheetMarker)) {
    throw new Error("Cannot bundle HTML without expected stylesheet marker.");
  }

  if (!artifact.indexHtml.includes(scriptMarker)) {
    throw new Error("Cannot bundle HTML without expected script marker.");
  }

  return artifact.indexHtml
    .replace(stylesheetMarker, `<style>\n${escapeStyleContent(artifact.stylesCss)}\n</style>`)
    .replace(scriptMarker, `  <script>\n${escapeScriptContent(artifact.scriptJs)}\n  </script>`);
};
