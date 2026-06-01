export interface SelectedPreviewElement {
  selector: string;
  tagName: string;
  text: string;
  outerHTML: string;
}

export const selectedPreviewElementChangeEvent = "lp-preview-selected-element-change";

const selectorMaxLength = 240;
const tagMaxLength = 32;
const textMaxLength = 320;
const htmlMaxLength = 900;

export function sanitizeSelectedPreviewElement(
  value: unknown
): SelectedPreviewElement | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const selector = sanitizeField(value.selector, selectorMaxLength);
  const tagName = sanitizeField(value.tagName, tagMaxLength).toLowerCase();
  const text = sanitizeField(value.text, textMaxLength);
  const outerHTML = sanitizeField(value.outerHTML, htmlMaxLength);

  if (!selector || !tagName) {
    return undefined;
  }

  return {
    selector,
    tagName,
    text,
    outerHTML
  };
}

export function parseSelectedPreviewElementJson(
  value: FormDataEntryValue | string | null | undefined
): SelectedPreviewElement | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  try {
    return sanitizeSelectedPreviewElement(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function appendSelectedPreviewElementContext(input: {
  prompt: string;
  selectedElement?: SelectedPreviewElement;
}): string {
  if (!input.selectedElement) {
    return input.prompt;
  }

  const context = [
    "",
    "",
    "[LP selected element context]",
    "用户当前选中的 LP 元素：",
    `selector=${input.selectedElement.selector}`,
    `tag=${input.selectedElement.tagName}`,
    input.selectedElement.text ? `text=${input.selectedElement.text}` : undefined,
    input.selectedElement.outerHTML ? `html=${input.selectedElement.outerHTML}` : undefined,
    "[/LP selected element context]"
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  return `${input.prompt}${context}`;
}

function sanitizeField(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
