import type { StaticArtifacts } from "@lp-agent/artifacts";

export function createPreviewSrcDoc(artifacts: StaticArtifacts): string {
  return artifacts.indexHtml
    .replace(
      /<link\s+rel=["']stylesheet["']\s+href=["']styles\.css["']\s*\/?>/i,
      `<style>\n${artifacts.stylesCss}\n</style>`
    )
    .replace(
      /<script\s+src=["']script\.js["']\s*><\/script>/i,
      `<script>\n${artifacts.scriptJs}\n</script>`
    );
}

export function createPreviewHtmlDocument({
  artifacts,
  inspectMode = false
}: {
  artifacts: StaticArtifacts;
  inspectMode?: boolean;
}): string {
  const srcDoc = createPreviewSrcDoc(artifacts);
  return inspectMode ? injectPreviewInspectorBridge(srcDoc) : srcDoc;
}

export function appendPreviewInspectorQuery(previewUrl: string): string {
  const url = new URL(previewUrl, "http://localhost");
  url.searchParams.set("inspect", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function injectPreviewInspectorBridge(srcDoc: string): string {
  const bridge = `
<script data-lp-preview-inspector="true">
(() => {
  const selectedClass = "lp-preview-inspector-selected";
  const hoverClass = "lp-preview-inspector-hover";
  const style = document.createElement("style");
  style.textContent = "." + hoverClass + "{outline:2px solid #0b7a75!important;outline-offset:2px!important;cursor:crosshair!important;}." + selectedClass + "{outline:3px solid #2864d8!important;outline-offset:3px!important;}";
  document.head.appendChild(style);
  let hovered;
  let selected;
  const clearHover = () => {
    if (hovered) {
      hovered.classList.remove(hoverClass);
      hovered = undefined;
    }
  };
  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  };
  const selectorFor = (element) => {
    if (element.id) {
      return "#" + cssEscape(element.id);
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      const className = String(current.className || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (className.length > 0) {
        part += "." + className.map(cssEscape).join(".");
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ") || element.tagName.toLowerCase();
  };
  document.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target === document.documentElement || target === document.body) {
      return;
    }
    clearHover();
    hovered = target;
    hovered.classList.add(hoverClass);
  }, true);
  document.addEventListener("mouseout", clearHover, true);
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target === document.documentElement || target === document.body) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (selected) {
      selected.classList.remove(selectedClass);
    }
    selected = target;
    selected.classList.add(selectedClass);
    window.parent.postMessage({
      type: "lp-preview-element-selected",
      selector: selectorFor(target).slice(0, 240),
      tagName: target.tagName.toLowerCase().slice(0, 32),
      text: String(target.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 320),
      outerHTML: String(target.outerHTML || "").replace(/\\s+/g, " ").trim().slice(0, 900)
    }, "*");
  }, true);
})();
</script>`;

  if (srcDoc.includes("</body>")) {
    return srcDoc.replace("</body>", `${bridge}</body>`);
  }
  return `${srcDoc}${bridge}`;
}
