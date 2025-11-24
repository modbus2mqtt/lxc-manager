import { parse as parseWithSourceMap } from "json-source-map";

import { Ajv } from "ajv";
import ajvErrors from "ajv-errors";
import { readFileSync, readdirSync } from "fs";
import path, { resolve, extname, join } from "path";

export class JsonValidator {
  private ajv: Ajv;
  constructor(schemasDir: string = resolve("schemas")) {
    this.ajv = new Ajv({ allErrors: true });
    ajvErrors.default(this.ajv);
    // Validate and add all .schema.json files
    try {
      const files = readdirSync(schemasDir);
      files.forEach((file) => {
        if (extname(file) === ".json") {
          const schemaPath = join(schemasDir, file);
          const schemaContent = readFileSync(schemaPath, "utf-8");
          let schema;
          try {
            schema = JSON.parse(schemaContent);
          } catch (e: any) {
            throw new Error(
              `Invalid JSON in schema file: ${file}\n${e && (e.message || String(e))}`,
            );
          }
          try {
            this.ajv.compile(schema); // validate schema itself
          } catch (e: any) {
            throw new Error(
              `Invalid JSON Schema in file: ${file}\n${e && (e.message || String(e))}`,
            );
          }
          this.ajv.addSchema(schema, "./" + file);
        }
      });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      // Ignore errors when loading schemas (e.g. if directory does not exist)
    }
  }

  /**
   * Validates and serializes a JSON object against a schema. Throws on validation error.
   * Only supports synchronous schemas (no async validation).
   * @param jsonData The data to validate and serialize
   * @param schemaPath The path to the schema file
   * @returns The validated and typed object
   */
  public serializeJsonWithSchema<T>(jsonData: unknown, schemaPath: string): T {
    const schemaKey = "./" + path.basename(schemaPath);
    const validate = this.ajv.getSchema<T>(schemaKey);
    if (!validate) {
      throw new Error(
        `Schema not found: ${schemaKey} (while validating file: ${schemaPath})`,
      );
    }
    let valid: boolean = false;
    let sourceMap: any = undefined;
    let originalText: string | undefined = undefined;
    // Try to get line numbers if jsonData is a plain object from JSON.parse
    if (
      typeof jsonData === "object" &&
      jsonData !== null &&
      (jsonData as any).__sourceMapText
    ) {
      originalText = (jsonData as any).__sourceMapText;
      sourceMap = (jsonData as any).__sourceMap;
    }
    try {
      const result = validate(jsonData);
      if (result instanceof Promise) {
        throw new Error(
          "Async schemas are not supported in serializeJsonWithSchema",
        );
      } else {
        valid = result as boolean;
      }
    } catch (err: any) {
      throw new Error(
        `Validation error in file '${schemaPath}': ${err && (err.message || String(err))}`,
      );
    }
    if (!valid) {
      // Try to add line numbers to errors and collect them in an array
      let errorDetails = "";
      let errorLines: number[] = [];
      if (validate.errors && originalText && sourceMap) {
        errorDetails = validate.errors
          .map((e: any) => {
            const pointer = sourceMap.pointers[e.instancePath || ""];
            const line = pointer
              ? pointer.key
                ? pointer.key.line + 1
                : pointer.value.line + 1
              : undefined;
            if (typeof line === "number") errorLines.push(line);
            return `${e.message} at line ${line ?? "?"} (path: ${e.instancePath})`;
          })
          .join("\n");
      } else if (validate.errors) {
        errorDetails = JSON.stringify(validate.errors, null, 2);
      } else {
        errorDetails = "Unknown error";
      }
      const err = new Error(
        `Validation failed for file '${schemaPath}':\n` + errorDetails,
      );
      (err as any).errorLines = errorLines;
      throw err;
    }
    return jsonData as T;
  }

  /**
   * Reads a JSON file, parses it with source map, validates it against a schema, and returns the typed object.
   * Throws an error with line numbers if file is missing, parsing or validation fails.
   * @param filePath Path to the JSON file
   * @param schemaPath Path to the schema file
   */
  public serializeJsonFileWithSchema<T>(
    filePath: string,
    schemaPath: string,
  ): T {
    let fileText: string;
    let data: unknown;
    let pointers: any;
    try {
      fileText = readFileSync(filePath, "utf-8");
    } catch (e: any) {
      throw new Error(
        `File not found or cannot be read: ${filePath}\n${e && (e.message || String(e))}`,
      );
    }
    try {
      const parsed = parseWithSourceMap(fileText);
      data = parsed.data;
      pointers = parsed.pointers;
      (data as any).__sourceMapText = fileText;
      (data as any).__sourceMap = { pointers };
    } catch (e: any) {
      // Try to extract line/column from error if possible
      throw new Error(
        `Failed to parse JSON file: ${filePath}\n${e && (e.message || String(e))}`,
      );
    }
    try {
      return this.serializeJsonWithSchema<T>(data, schemaPath);
    } catch (e: any) {
      const err = new Error(
        `Validation failed for file: ${filePath}\n${e && (e.message || String(e))}`,
      );
      if (e && typeof e === "object" && "errorLines" in e) {
        (err as any).errorLines = (e as any).errorLines;
      }
      throw err;
    }
  }
}

