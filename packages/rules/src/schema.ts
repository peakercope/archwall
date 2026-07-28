import type { StandardSchemaIssue, StandardSchemaV1 } from "@archwall/core";

/**
 * A dependency-free Standard Schema builder, just big enough for rule options.
 *
 * Every rule populates `optionsSchema`, so the first thing a user gets wrong produces a
 * sentence naming the mistake rather than an opaque `rule-failed` from inside the rule.
 *
 * Deliberately not zod/valibot: `@archwall/rules` is on the dependency path of every
 * install, and validating a handful of option bags does not justify a runtime dependency.
 * Third-party rules can use whatever Standard Schema library they like — that is exactly
 * what the vendored interface is for.
 */

/** Returns the problems found, empty when the value is acceptable. */
export type Validator = (value: unknown, path: string) => string[];

const at = (path: string): string => (path === "" ? "options" : `"${path}"`);

export const anyValue: Validator = () => [];

export const str: Validator = (v, p) =>
  typeof v === "string" ? [] : [`${at(p)} must be a string`];

export const bool: Validator = (v, p) =>
  typeof v === "boolean" ? [] : [`${at(p)} must be a boolean`];

export const num: Validator = (v, p) =>
  typeof v === "number" && Number.isFinite(v) ? [] : [`${at(p)} must be a number`];

export function arrayOf(item: Validator): Validator {
  return (v, p) => {
    if (!Array.isArray(v)) return [`${at(p)} must be an array`];
    return v.flatMap((entry, i) => item(entry, `${p}[${i}]`));
  };
}

/** An object with arbitrary keys, all values validated the same way. */
export function recordOf(value: Validator): Validator {
  return (v, p) => {
    if (typeof v !== "object" || v === null || Array.isArray(v))
      return [`${at(p)} must be an object`];
    return Object.entries(v).flatMap(([k, entry]) => value(entry, p === "" ? k : `${p}.${k}`));
  };
}

/** Accepts whichever alternative matches; reports only when none does. */
export function either(...alternatives: Validator[]): Validator {
  return (v, p) => {
    const all = alternatives.map((a) => a(v, p));
    return all.some((issues) => issues.length === 0) ? [] : (all[0] ?? []);
  };
}

export interface Field {
  validate: Validator;
  required?: boolean;
}

export const required = (validate: Validator): Field => ({
  validate,
  required: true,
});
export const optional = (validate: Validator): Field => ({ validate });

/**
 * Rejects unknown keys. A typo'd option name is the most common configuration mistake
 * there is, and silently ignoring it means the rule runs with a default the user believes
 * they overrode — the tool's worst failure mode (looking like it worked) in miniature.
 */
export function object(shape: Record<string, Field>): Validator {
  return (v, p) => {
    if (typeof v !== "object" || v === null || Array.isArray(v))
      return [`${at(p)} must be an object`];
    const value = v as Record<string, unknown>;
    const issues: string[] = [];
    for (const [key, field] of Object.entries(shape)) {
      const child = p === "" ? key : `${p}.${key}`;
      if (value[key] === undefined) {
        if (field.required === true) issues.push(`${at(child)} is required`);
        continue;
      }
      issues.push(...field.validate(value[key], child));
    }
    const known = new Set(Object.keys(shape));
    for (const key of Object.keys(value)) {
      if (!known.has(key)) {
        issues.push(
          `${at(p === "" ? key : `${p}.${key}`)} is not a recognised option (expected one of: ${[...known].sort().join(", ")})`,
        );
      }
    }
    return issues;
  };
}

/** Wraps a validator as a Standard Schema, which is what `RuleMeta.optionsSchema` takes. */
export function ruleOptions<T>(validate: Validator): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "archwall",
      validate: (value) => {
        const issues = validate(value ?? {}, "");
        if (issues.length > 0) {
          return {
            issues: issues.map((message): StandardSchemaIssue => ({ message })),
          };
        }
        return { value: (value ?? {}) as T };
      },
    },
  };
}
