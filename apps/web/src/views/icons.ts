const NS = "http://www.w3.org/2000/svg";

const PATHS: Record<string, string[]> = {
  games: ['<rect x="3" y="6" width="18" height="12" rx="3"/>', '<line x1="12" y1="6" x2="12" y2="18"/>', '<circle cx="7.5" cy="12" r="1.2"/>', '<circle cx="16.5" cy="12" r="1.2"/>'],
  room: ['<rect x="4" y="4" width="16" height="16" rx="4"/>', '<circle cx="8.6" cy="8.6" r="1.1"/>', '<circle cx="12" cy="12" r="1.1"/>', '<circle cx="15.4" cy="15.4" r="1.1"/>'],
  people: ['<circle cx="9" cy="9" r="3"/>', '<circle cx="17" cy="10" r="2.4"/>', '<path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5"/>', '<path d="M15.5 14.4c2.9-.4 5.5 1 5.5 4.1"/>'],
  send: ['<path d="M21 3 3 10.5l7 3 3 7z"/>', '<path d="M10 13.5 21 3"/>'],
  plus: ['<path d="M12 5v14"/>', '<path d="M5 12h14"/>'],
  back: ['<path d="M15 5l-7 7 7 7"/>'],
  smile: ['<circle cx="12" cy="12" r="9"/>', '<path d="M8 14c1 1.5 2.5 2.2 4 2.2s3-.7 4-2.2"/>', '<circle cx="9" cy="9.8" r=".6"/>', '<circle cx="15" cy="9.8" r=".6"/>'],
  chat: ['<path d="M4 5h16v11H9l-5 4z"/>'],
  profile: ['<circle cx="12" cy="8" r="4"/>', '<path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>'],
};

/** Ikon garis sederhana; dibuat lewat parser SVG dari konstanta di atas (bukan dari masukan pengguna). */
export function icon(name: keyof typeof PATHS): SVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const tpl = document.createElementNS(NS, "g");
  const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}">${(PATHS[name] ?? []).join("")}</svg>`, "image/svg+xml");
  for (const child of Array.from(doc.documentElement.children)) tpl.appendChild(document.importNode(child, true));
  svg.appendChild(tpl);
  return svg;
}
