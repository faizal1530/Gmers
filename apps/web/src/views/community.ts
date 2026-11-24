import type { FeedItem, FeedTab, PersonRow, ReplyItem } from "../api";
import { h } from "../dom";
import { id } from "../i18n/id";
import { avatar } from "./avatar";

export interface CommunityOptions {
  tab: FeedTab;
  comm: string | null;
  items: FeedItem[] | null;
  next: number | null;
  suggestions: PersonRow[];
  failed: boolean;
  posting: boolean;
  draft: string;
  thread: { post: FeedItem; replies: ReplyItem[] } | null;
  replyDraft: string;
  now: number;
  communities: { id: string; name: string }[];
  onDraft: (v: string) => void;
  onReplyDraft: (v: string) => void;
  onPost: (text: string) => void;
  onTab: (t: FeedTab) => void;
  onComm: (c: string | null) => void;
  onMore: () => void;
  onRetry: () => void;
  onLike: (p: FeedItem) => void;
  onSave: (p: FeedItem) => void;
  onOpen: (p: FeedItem) => void;
  onCloseThread: () => void;
  onReply: (postId: string, text: string) => void;
  onShare: (p: FeedItem) => void;
  onHide: (p: FeedItem) => void;
  onReport: (p: FeedItem, reason: string) => void;
  onRemove: (id: string) => void;
  onFollow: (u: PersonRow) => void;
}

const TABS: FeedTab[] = ["untukmu", "mengikuti", "tersimpan"];

function postCard(p: FeedItem, o: CommunityOptions, detail: boolean): HTMLElement {
  const c = id.community;
  const age = c.ago(Math.max(0, Math.floor((o.now - p.ts) / 60_000)));
  const reasonBox = h("input", { class: "input", type: "text", maxlength: 200, placeholder: c.reportAsk, "aria-label": c.reportAsk, "data-testid": "post-report-reason", hidden: true });
  const act = (label: string, testid: string, fn: () => void, on = false): HTMLElement => h("button", { type: "button", class: `btn small${on ? " on" : ""}`, "data-testid": testid, "aria-pressed": on ? "true" : null, onclick: fn }, label);
  return h(
    "article",
    { class: "post panel", "data-testid": "post", "data-id": p.id },
    h(
      "div",
      { class: "post-head" },
      avatar(p.author.name, 0, "md"),
      h("span", { class: "frow-mid" }, h("b", {}, p.author.name), h("span", { class: "hint" }, `@${p.author.username} · ${age}${p.comm ? ` · ${c.communities[p.comm] ?? p.comm}` : ""}`)),
    ),
    h("p", { class: "post-text" }, p.text),
    h(
      "div",
      { class: "frow-actions wrap" },
      act(`${p.liked ? c.unlike : c.like} ${p.likes}`, "post-like", () => o.onLike(p), p.liked),
      detail ? null : act(`${c.reply} ${p.replies}`, "post-open", () => o.onOpen(p)),
      act(p.saved ? c.unsave : c.save, "post-save", () => o.onSave(p), p.saved),
      act(c.share, "post-share", () => o.onShare(p)),
      p.mine
        ? act(c.remove, "post-remove", () => o.onRemove(p.id))
        : [
            act(c.hide, "post-hide", () => o.onHide(p)),
            act(c.report, "post-report", () => {
              if (reasonBox.hidden) {
                reasonBox.hidden = false;
                reasonBox.focus();
              } else if (reasonBox.value.trim()) {
                o.onReport(p, reasonBox.value.trim());
                reasonBox.value = "";
                reasonBox.hidden = true;
              }
            }),
          ],
    ),
    reasonBox,
  );
}

export function communityView(o: CommunityOptions): HTMLElement {
  const c = id.community;
  if (o.thread) {
    const t = o.thread;
    const input = h("input", { class: "input", type: "text", maxlength: 200, value: o.replyDraft, placeholder: c.replyPlaceholder, "aria-label": c.replyPlaceholder, "data-testid": "reply-input", oninput: (e: Event) => o.onReplyDraft((e.target as HTMLInputElement).value) });
    return h(
      "section",
      { class: "stack" },
      h("div", { class: "row-head" }, h("button", { type: "button", class: "btn small", "data-testid": "thread-back", onclick: o.onCloseThread }, c.back), h("h2", {}, c.repliesTitle)),
      postCard(t.post, o, true),
      h(
        "div",
        { class: "panel" },
        t.replies.length
          ? h("ul", { class: "flist", "data-testid": "reply-list" }, t.replies.map((r) => h("li", { class: "reply" }, h("b", {}, r.author.name), h("span", { class: "hint" }, ` @${r.author.username}`), h("p", {}, r.text), r.mine ? h("button", { type: "button", class: "btn small", onclick: () => o.onRemove(r.id) }, c.remove) : null)))
          : h("p", { class: "hint" }, c.noReplies),
        h("form", { class: "form", onsubmit: (e: Event) => { e.preventDefault(); if (input.value.trim()) o.onReply(t.post.id, input.value.trim()); } }, input, h("button", { type: "submit", class: "btn primary", "data-testid": "reply-send" }, c.reply)),
      ),
    );
  }
  const area = h("textarea", { class: "input", rows: 3, maxlength: 280, placeholder: c.composePlaceholder, "aria-label": c.composeLabel, "data-testid": "compose", oninput: (e: Event) => o.onDraft((e.target as HTMLTextAreaElement).value) });
  area.value = o.draft;
  const emptyText = o.tab === "mengikuti" ? c.emptyFollowing : o.tab === "tersimpan" ? c.emptySaved : c.empty;
  return h(
    "section",
    { class: "stack" },
    h("p", { class: "hint" }, c.rules),
    h("form", { class: "panel form", onsubmit: (e: Event) => { e.preventDefault(); if (area.value.trim() && !o.posting) o.onPost(area.value); } }, area, h("button", { type: "submit", class: "btn primary", disabled: o.posting, "data-testid": "compose-send" }, o.posting ? c.posting : c.post)),
    h("div", { class: "seg", role: "tablist", "aria-label": c.title }, TABS.map((t) => h("button", { type: "button", role: "tab", class: `seg-btn${o.tab === t ? " on" : ""}`, "aria-selected": String(o.tab === t), "data-feed-tab": t, onclick: () => o.onTab(t) }, c.tabs[t]))),
    h(
      "div",
      { class: "chips", role: "group", "aria-label": c.title },
      [{ id: "", name: c.allCommunities }, ...o.communities].map((x) => h("button", { type: "button", class: `btn small${(o.comm ?? "") === x.id ? " primary" : ""}`, "data-comm": x.id, onclick: () => o.onComm(x.id || null) }, x.id ? (c.communities[x.id] ?? x.name) : x.name)),
    ),
    o.suggestions.length
      ? h("div", { class: "panel", "data-testid": "suggestions" }, h("h2", {}, c.meetTitle), h("p", { class: "hint" }, c.meetNote), h("ul", { class: "flist" }, o.suggestions.map((u) => h("li", { class: "frow" }, avatar(u.name, 0, "md"), h("span", { class: "frow-mid" }, h("b", {}, u.name), h("span", { class: "hint" }, `@${u.username}`)), h("button", { type: "button", class: "btn small", "data-testid": "meet-follow", onclick: () => o.onFollow(u) }, c.follow)))))
      : null,
    o.items === null
      ? h("div", { class: "panel" }, h("p", { class: o.failed ? "hint bad" : "hint" }, o.failed ? c.error : "…"), o.failed ? h("button", { type: "button", class: "btn", "data-testid": "feed-retry", onclick: o.onRetry }, c.retry) : null)
      : o.items.length === 0
        ? h("p", { class: "hint center", "data-testid": "feed-empty" }, emptyText)
        : h("div", { class: "stack", "data-testid": "feed" }, o.items.map((p) => postCard(p, o, false))),
    o.next ? h("button", { type: "button", class: "btn", "data-testid": "feed-more", onclick: o.onMore }, c.loadMore) : null,
  );
}
