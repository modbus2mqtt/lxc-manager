import fs from "node:fs";
import path from "node:path";
import { JsonValidator } from "./jsonvalidator.mjs";
import { StorageContext } from "./storagecontext.mjs";
import { ICommand } from "./types.mjs";

// IOutput interface moved here to avoid circular dependency
export interface IOutput {
  id: string;
  value?: string;
  default?: string;
}

/**
 * Processes script outputs, including JSON parsing, validation, and local file handling.
 */
export class OutputProcessor {
  private validator: JsonValidator;

  constructor(
    private outputs: Map<string, string | number | boolean>,
    private outputsRaw: { name: string; value: string | number | boolean }[] | undefined,
    private defaults: Map<string, string | number | boolean>,
    private sshCommand: string,
  ) {
    this.validator = StorageContext.getInstance().getJsonValidator();
  }

  /**
   * Processes a value: if it's a string starting with "local:", reads the file and returns base64 encoded content.
   * Only processes files when executing locally (sshCommand !== "ssh"). When executing on VE host,
   * the "local:" prefix is preserved so the file can be read on the VE host.
   */
  processLocalFileValue(
    value: string | number | boolean,
  ): string | number | boolean {
    if (typeof value === "string" && value.startsWith("local:")) {
      // Only process local files when executing locally (e.g., in tests)
      // When executing on VE host, preserve the "local:" prefix so the file can be read on the VE host
      if (this.sshCommand !== "ssh") {
        const filePath = value.substring(6); // Remove "local:" prefix
        const storageContext = StorageContext.getInstance();
        const localPath = storageContext.getLocalPath();
        const fullPath = path.join(localPath, filePath);
        try {
          const fileContent = fs.readFileSync(fullPath);
          return fileContent.toString("base64");
        } catch (err: any) {
          throw new Error(`Failed to read file ${fullPath}: ${err.message}`);
        }
      }
      // When executing on VE host, return the value as-is (with "local:" prefix)
      // The file will be read on the VE host, not locally
    }
    return value;
  }

  /**
   * Parses JSON output from stdout, validates it, and updates outputs map.
   * Handles multiple output formats: IOutput, IOutput[], or Array<{name, value}>.
   */
  parseAndUpdateOutputs(
    stdout: string,
    tmplCommand: ICommand,
    uniqueMarker?: string,
  ): void {
    if (stdout.trim().length === 0) {
      return; // No outputs to parse
    }

    try {
      // Strip banner text by finding the unique marker we prepended
      // Everything before the marker is banner text (SSH MOTD, etc.)
      let cleaned = stdout.trim();
      if (uniqueMarker) {
        const markerIndex = cleaned.indexOf(uniqueMarker);
        if (markerIndex >= 0) {
          // Remove everything up to and including the marker and the newline after it
          cleaned = cleaned.slice(markerIndex + uniqueMarker.length).trim();
        }
      }

      if (cleaned.length === 0) {
        return; // Nothing left after cleaning
      }

      const parsed = JSON.parse(cleaned);
      // Validate against schema; may be one of:
      // - IOutput
      // - IOutput[]
      // - Array<{name, value}>
      const outputsJson = this.validator.serializeJsonWithSchema<any>(
        parsed,
        "outputs",
        "Outputs " + tmplCommand.name,
      );

      if (Array.isArray(outputsJson)) {
        const first = outputsJson[0];
        if (
          first &&
          typeof first === "object" &&
          "name" in first &&
          !("id" in first)
        ) {
          // name/value array: pass through 1:1 to outputsRaw and also map for substitutions
          // Note: outputsRaw is managed by the caller, so we need to return this
          const raw: { name: string; value: string | number | boolean }[] = [];
          for (const nv of outputsJson as {
            name: string;
            value: string | number | boolean;
          }[]) {
            const processedValue = this.processLocalFileValue(nv.value);
            raw.push({ name: nv.name, value: processedValue });
            this.outputs.set(nv.name, processedValue);
          }
          // Store in a way that the caller can access it
          (this as any).outputsRawResult = raw;
        } else {
          // Array of outputObject {id, value}
          for (const entry of outputsJson as IOutput[]) {
            if (entry.value !== undefined) {
              const processedValue = this.processLocalFileValue(entry.value);
              this.outputs.set(entry.id, processedValue);
            }
            if ((entry as any).default !== undefined)
              this.defaults.set(entry.id, (entry as any).default as any);
          }
        }
      } else if (typeof outputsJson === "object" && outputsJson !== null) {
        const obj = outputsJson as IOutput;
        if (obj.value !== undefined) {
          const processedValue = this.processLocalFileValue(obj.value);
          this.outputs.set(obj.id, processedValue);
        }
        if ((obj as any).default !== undefined)
          this.defaults.set(obj.id, (obj as any).default as any);
      }
    } catch (e) {
      // Re-throw with context
      throw e;
    }
  }

  /**
   * Gets the outputsRaw result from the last parse operation (for name/value arrays).
   */
  getOutputsRawResult(): { name: string; value: string | number | boolean }[] | undefined {
    return (this as any).outputsRawResult;
  }
}

