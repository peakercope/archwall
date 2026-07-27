/**
 * Vendored Standard Schema v1 interface (standardschema.dev) so zod/valibot/arktype
 * schemas type-check as rule option schemas without core taking a dependency.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  };
}

export type StandardSchemaResult<Output> =
  | { value: Output; issues?: undefined }
  | { issues: ReadonlyArray<StandardSchemaIssue> };

export interface StandardSchemaIssue {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}
