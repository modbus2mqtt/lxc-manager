import {
  IApplication,
  IConfiguredPathes,
  VEConfigurationError,
} from "@src/backend-types.mjs";
import path from "path";
import fs from "fs";
import { StorageContext } from "./storagecontext.mjs";
import { ITemplateReference } from "./templateprocessor.mjs";
export interface IReadApplicationOptions {
  applicationHierarchy: string[];
  application?: IApplication;
  appPath?: string;
  error: VEConfigurationError;
  taskTemplates: {
    task: string;
    templates: (ITemplateReference | string)[];
  }[];
  inheritedIcon?: string;
  inheritedIconContent?: string;
  inheritedIconType?: string;
}
export class ApplicationLoader {
  constructor(
    private pathes: IConfiguredPathes,
    private storage: StorageContext = StorageContext.getInstance(),
  ) {}
  /**
   * Reads the application.json for an application, supports inheritance and template list manipulation.
   * @param application Name of the application (optionally with json: prefix)
   * @param opts Options with applicationHierarchy and templates
   */
  public readApplicationJson(
    application: string,
    opts: IReadApplicationOptions,
  ): IApplication {
    let appPath: string | undefined;
    let appFile: string | undefined;
    let appName = application;

    if (application.startsWith("json:")) {
      appName = application.replace(/^json:/, "");
      appPath = path.join(this.pathes.jsonPath, "applications", appName);
      appFile = path.join(appPath, "application.json");
      if (!fs.existsSync(appFile))
        throw new Error(`application.json not found for ${application}`);
    } else {
      // First check local, then json
      let localPath = path.join(
        this.pathes.localPath,
        "applications",
        application,
        "application.json",
      );
      let jsonPath = path.join(
        this.pathes.jsonPath,
        "applications",
        application,
        "application.json",
      );
      if (fs.existsSync(localPath)) {
        appFile = localPath;
        appPath = path.dirname(localPath);
      } else if (fs.existsSync(this.pathes.jsonPath)) {
        appFile = jsonPath;
        appPath = path.dirname(jsonPath);
      } else {
        throw new Error(`application.json not found for ${application}`);
      }
    }
    if (opts.applicationHierarchy.includes(appPath)) {
      throw new Error(
        `Cyclic inheritance detected for application: ${appName}`,
      );
    }
    // Read and validate file
    const validator = this.storage.getJsonValidator();
    let appData: IApplication;
    try {
      appData = validator.serializeJsonFileWithSchema<IApplication>(
        appFile,
        "application",
      );
      appData.id = appName;

      // Save the first application in the hierarchy
      if (!opts.application) {
        opts.application = appData;
        opts.appPath = appPath;
      }
      // First application is first in hierarchy
      opts.applicationHierarchy.push(appPath);

      // Recursive inheritance - load parent first to get icon data
      if (appData.extends) {
        try {
          this.readApplicationJson(appData.extends, opts);
        } catch (e: Error | any) {
          if (opts.error && Array.isArray(opts.error.details)) {
            opts.error.details.push(e);
          }
        }
      }

      // Check for icon in the application directory (supports .png and .svg)
      let icon = appData?.icon ? appData.icon : "icon.png";
      let iconFound = false;
      if (appPath) {
        const iconPath = path.join(appPath, icon);
        if (fs.existsSync(iconPath)) {
          appData.icon = icon;
          appData.iconContent = fs.readFileSync(iconPath, {
            encoding: "base64",
          });
          // Determine MIME type based on file extension
          const ext = path.extname(icon).toLowerCase();
          appData.iconType = ext === ".svg" ? "image/svg+xml" : "image/png";
          iconFound = true;
          // Store icon data for inheritance
          opts.inheritedIcon = icon;
          opts.inheritedIconContent = appData.iconContent;
          opts.inheritedIconType = appData.iconType;
        }
      }

      // If no icon found and we have inherited icon data from parent, use it
      if (!iconFound && opts.inheritedIconContent) {
        appData.icon = opts.inheritedIcon || "icon.png";
        appData.iconContent = opts.inheritedIconContent;
        appData.iconType = opts.inheritedIconType;
      }
      this.processTemplates(appData, opts);
      return appData;
    } catch (e: Error | any) {
      if (opts.error.details === undefined) {
        opts.error.details = [];
      }
      opts.error.details.push(e);
    }
    throw opts.error;
  }

  private processTemplates(
    appData: IApplication,
    opts: IReadApplicationOptions,
  ) {
    const taskKeys = [
      "installation",
      "backup",
      "restore",
      "uninstall",
      "update",
      "upgrade",
      "webui",
    ];
    for (const key of taskKeys) {
      const list = (appData as any)[key];
      let taskEntry = opts.taskTemplates.find((t) => t.task === key);
      if (!taskEntry) {
        taskEntry = { task: key, templates: [] };
        opts.taskTemplates.push(taskEntry);
      }
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (typeof entry === "string") {
            if (!taskEntry.templates.includes(entry)) {
              taskEntry.templates.push(entry);
            }
          } else if (typeof entry === "object" && entry !== null) {
            const name = entry.name;
            if (!name) continue;
            if (entry.before) {
              const idx = taskEntry.templates.indexOf(entry.before);
              if (idx !== -1) {
                taskEntry.templates.splice(idx, 0, name);
              } else if (!taskEntry.templates.includes(name)) {
                taskEntry.templates.push(name);
              }
            } else if (entry.after) {
              const idx = taskEntry.templates.indexOf(entry.after);
              if (idx !== -1) {
                taskEntry.templates.splice(idx + 1, 0, name);
              } else if (!taskEntry.templates.includes(name)) {
                taskEntry.templates.push(name);
              }
            } else if (!taskEntry.templates.includes(name)) {
              taskEntry.templates.push(name);
            }
          }
        }
      }
    }
  }
}
