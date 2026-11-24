import { id } from "../i18n/id";
import { h } from "../dom";
import { checkName } from "../logic";

export interface NameFormOptions {
  initial: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (name: string) => void;
  /** Tombol kedua (mis. buat room Ludo) yang memakai nama yang sama. */
  secondary?: { label: string; testId: string; onSubmit: (name: string) => void };
}

/** Formulir nama panggilan (beranda dan tautan). Tidak dibangun ulang saat state berubah, supaya fokus ketikan tidak hilang. */
export function nameForm(o: NameFormOptions): HTMLElement {
  const input = h("input", {
    id: "nama",
    class: "input",
    type: "text",
    name: "nama",
    autocomplete: "nickname",
    autocapitalize: "words",
    maxlength: 40,
    placeholder: id.home.namePlaceholder,
    value: o.initial,
    "aria-describedby": "nama-bantuan",
  });
  const hint = h("p", { id: "nama-bantuan", class: "hint", role: "status", "aria-live": "polite" }, id.name.hint);
  const button = h("button", { class: "btn primary big", type: "submit", disabled: o.busy }, o.submitLabel);
  const form = h(
    "form",
    {
      class: "form",
      novalidate: true,
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        const r = checkName(input.value);
        if (!r.ok) {
          hint.textContent = id.name[r.reason];
          hint.classList.add("bad");
          input.setAttribute("aria-invalid", "true");
          input.focus();
          return;
        }
        hint.textContent = id.name.hint;
        hint.classList.remove("bad");
        input.removeAttribute("aria-invalid");
        o.onSubmit(r.name);
      },
    },
    h("label", { for: "nama", class: "label" }, id.home.nameLabel),
    input,
    hint,
    button,
    o.secondary
      ? h(
          "button",
          {
            class: "btn big",
            type: "button",
            "data-testid": o.secondary.testId,
            disabled: o.busy,
            onclick: () => {
              const r = checkName(input.value);
              if (!r.ok) {
                hint.textContent = id.name[r.reason];
                hint.classList.add("bad");
                input.setAttribute("aria-invalid", "true");
                input.focus();
                return;
              }
              o.secondary?.onSubmit(r.name);
            },
          },
          o.secondary.label,
        )
      : null,
  );
  return form;
}
