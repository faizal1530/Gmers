import { id } from "../i18n/id";
import { h } from "../dom";

export function notFoundView(kind: "page" | "link", onHome: () => void): HTMLElement {
  return h(
    "section",
    { class: "panel center" },
    h("h1", {}, id.notFound.title),
    h("p", {}, kind === "link" ? id.notFound.linkBody : id.notFound.body),
    h("button", { class: "btn primary", type: "button", onclick: onHome }, id.notFound.home),
  );
}

export function errorView(message: string, onRetry: (() => void) | null, onHome: () => void): HTMLElement {
  return h(
    "section",
    { class: "panel center", role: "alert" },
    h("h1", {}, id.errors.generic),
    h("p", {}, message),
    onRetry ? h("button", { class: "btn primary", type: "button", onclick: onRetry }, id.errors.retry) : null,
    h("button", { class: "btn", type: "button", onclick: onHome }, id.notFound.home),
  );
}

export function privacyView(onBack: () => void): HTMLElement {
  const p = id.privacy;
  return h(
    "section",
    { class: "panel prose" },
    h("h1", {}, p.title),
    h("p", { class: "draft", role: "note" }, p.draft),
    p.sections.map((s) => h("div", {}, h("h2", {}, s.heading), h("ul", {}, s.items.map((i) => h("li", {}, i))))),
    h("button", { class: "btn", type: "button", onclick: onBack }, p.back),
  );
}
