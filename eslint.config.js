import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "design/**", "pemasaran/**", "strategi/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // game-engine harus deterministik: RNG hanya lewat injeksi (createRng / parameter rng).
    files: ["packages/game-engine/src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Pakai RNG yang diinjeksi (rng.ts)." },
        { object: "Date", property: "now", message: "Mesin game tidak boleh membaca waktu." },
      ],
      "no-restricted-globals": ["error", "process", "console", "fetch", "require"],
    },
  },
);
