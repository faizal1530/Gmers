// Static builder: data/articles.json -> dist/index.html (no dependencies).
// Cloudflare Pages: build command `node build.mjs`, output directory `dist`.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";

const d = JSON.parse(readFileSync("data/articles.json", "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (iso) => iso ? new Date(iso + "T00:00:00+07:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }) : "";
const url = (a) => a.url || "#";
const pic = (a, cat, cls = "") => {
  const style = a.img ? ` style="background-image:url('${esc(d.imgBase + a.img)}')"` : "";
  return `<span class="pic ${cls}${a.img ? "" : " nopic"}"${style} aria-hidden="true">${a.img ? "" : `<i>${esc(cat || "")}</i>`}</span>`;
};
const item = (a, cat) => `<a class="row" href="${url(a)}">${pic(a, cat)}<span class="rt"><b>${esc(a.title)}</b>${a.date ? `<time>${fmt(a.date)}</time>` : ""}</span></a>`;
const card = (a, cat) => `<a class="card" href="${url(a)}">${pic(a, cat, "wide")}<b>${esc(a.title)}</b><time>${fmt(a.date)}</time></a>`;
const head = (t, id, more) => `<header class="sh"><h2 id="${id}">${t}</h2>${more ? `<a href="#">Lihat semua &rarr;</a>` : ""}</header>`;

const [hero, ...side] = d.featured;
const html = readFileSync("template.html", "utf8")
  .replace("{{HERO}}", `<a class="hero" href="${url(hero)}">${pic(hero, hero.cat, "hero-pic")}<span class="hero-t"><em>${esc(hero.cat)}</em><b>${esc(hero.title)}</b>${hero.excerpt ? `<p>${esc(hero.excerpt)}</p>` : ""}<time>${fmt(hero.date)}</time></span></a>`)
  .replace("{{SIDE}}", side.map((a) => `<a class="side" href="${url(a)}"><em>${esc(a.cat)}</em><b>${esc(a.title)}</b></a>`).join(""))
  .replace("{{NEWS}}", d.news.map((a) => item(a, "News")).join(""))
  .replace("{{KOLOM}}", d.kolom.map((a) => `<a class="kol" href="${url(a)}"><b>${esc(a.title)}</b><time>${fmt(a.date)}</time></a>`).join(""))
  .replace("{{GADGET}}", d.gadget.map((a) => card(a, "Gadget")).join(""))
  .replace("{{APPS}}", d.apps.map((a) => item(a, "Apps")).join(""))
  .replace("{{TIPS}}", d.tips.map((a) => item(a, "Tips")).join(""))
  .replace("{{REVIEW}}", d.review.map((a) => `<a class="rv" href="${url(a)}">${pic(a, "Review", "tall")}<b>${esc(a.title)}</b></a>`).join(""))
  .replace("{{YEAR}}", String(new Date().getFullYear()));

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
copyFileSync("_headers", "dist/_headers");
console.log("dist/index.html written,", html.length, "bytes");
