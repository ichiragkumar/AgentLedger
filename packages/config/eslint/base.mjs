// Shared eslint preset — owner: ledger-web-system.
// Adoption (coordinator/sibling call, NOT wired yet — app eslint.config.mjs
// files stay untouched until siblings agree):
//   import base from "@agentledger/config/eslint/base.mjs";
//   export default defineConfig([...base, ...nextVitals, ...nextTs, ...]);
//
// Rules below encode spec-18 design-system law: no raw hex in components.

export default [
  {
    name: "agentledger/design-system",
    rules: {
      // Catch raw hex colors in tsx (tokens only: bg-primary, text-savings…).
      // Scoped to component files so specs/docs are unaffected.
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            'Literal[value=/(#[0-9a-fA-F]{3,8})/][parent.type="JSXExpressionContainer"], JSXAttribute[value.value=/(#[0-9a-fA-F]{3,8})/]',
          message:
            "No raw hex in components — use spec-18 tokens (bg-primary, text-muted-foreground, var(--savings)…).",
        },
      ],
    },
  },
];
