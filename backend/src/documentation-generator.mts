#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StorageContext } from "./storagecontext.mjs";
import { ApplicationLoader, IReadApplicationOptions } from "./apploader.mjs";
import { VEConfigurationError, IApplication, IVEContext } from "./backend-types.mjs";
import { ITemplateReference, TemplateProcessor } from "./templateprocessor.mjs";
import type { IParameter, ITemplate, ICommand, TaskType } from "./types.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface IConfiguredPathes {
  jsonPath: string;
  localPath: string;
  schemaPath: string;
}

/**
 * Generates documentation for applications and templates.
 */
export class DocumentationGenerator {
  private jsonPath: string;
  private localPath: string;
  private schemaPath: string;
  private htmlPath: string;

  constructor(jsonPath: string, localPath: string, schemaPath: string, htmlPath?: string) {
    this.jsonPath = jsonPath;
    this.localPath = localPath;
    this.schemaPath = schemaPath;
    // Default htmlPath is html/ in project root
    const projectRoot = path.resolve(path.dirname(jsonPath));
    this.htmlPath = htmlPath || path.join(projectRoot, "html");
  }

  /**
   * Generates documentation for a specific application or all applications.
   */
  async generateDocumentation(applicationName?: string): Promise<void> {
    // Create html directory structure
    if (!fs.existsSync(this.htmlPath)) {
      fs.mkdirSync(this.htmlPath, { recursive: true });
    }
    // Note: Application-specific directories will be created in generateApplicationDocumentation

    const storageContext = StorageContext.getInstance();
    const allApps = storageContext.getAllAppNames();

    if (applicationName) {
      const appPath = allApps.get(applicationName);
      if (!appPath) {
        throw new Error(
          `Application '${applicationName}' not found. Available: ${Array.from(allApps.keys()).join(", ")}`,
        );
      }
      await this.generateApplicationDocumentation(applicationName, appPath);
    } else {
      // Generate documentation for all applications
      for (const [appName, appPath] of allApps) {
        await this.generateApplicationDocumentation(appName, appPath);
      }
    }

    // Check for missing .md files (non-generated parts)
    this.checkMissingMarkdownFiles(applicationName);
  }

  /**
   * Checks for missing .md files that are not generated (mandatory non-generated parts).
   */
  private checkMissingMarkdownFiles(applicationName?: string): void {
    const missingFiles: string[] = [];
    const storageContext = StorageContext.getInstance();
    const allApps = storageContext.getAllAppNames();

    const appsToCheck = applicationName 
      ? [[applicationName, allApps.get(applicationName)!].filter(([_, path]) => path)]
      : Array.from(allApps.entries());

    for (const [appName, appPath] of appsToCheck) {
      if (!appPath || !appName) continue;

      // Check if application README.md exists in html directory
      const htmlReadmePath = path.join(this.htmlPath, `${appName}.md`);
      if (!fs.existsSync(htmlReadmePath)) {
        missingFiles.push(`Application README: ${appName}.md`);
      }

      // Check for template .md files in html/json/applications/<app-name>/templates
      const templatesDir = path.join(appPath, "templates");
      if (fs.existsSync(templatesDir)) {
        const templateFiles = fs.readdirSync(templatesDir)
          .filter(f => f.endsWith(".json"));
        
        for (const templateFile of templateFiles) {
          const templateName = templateFile.replace(/\.json$/, "");
          const htmlTemplatePath = path.join(this.htmlPath, "json", "applications", appName, "templates", `${templateName}.md`);
          if (!fs.existsSync(htmlTemplatePath)) {
            missingFiles.push(`Template: json/applications/${appName}/templates/${templateName}.md`);
          }
        }
      }

      // Check shared templates in html/json/shared/templates
      const sharedTemplatesDir = path.join(this.jsonPath, "shared", "templates");
      if (fs.existsSync(sharedTemplatesDir)) {
        const sharedTemplateFiles = fs.readdirSync(sharedTemplatesDir)
          .filter(f => f.endsWith(".json"));
        
        for (const templateFile of sharedTemplateFiles) {
          const templateName = templateFile.replace(/\.json$/, "");
          const htmlTemplatePath = path.join(this.htmlPath, "json", "shared", "templates", `${templateName}.md`);
          if (!fs.existsSync(htmlTemplatePath)) {
            missingFiles.push(`Shared Template: json/shared/templates/${templateName}.md`);
          }
        }
      }
    }

    if (missingFiles.length > 0) {
      console.log("\n⚠ Missing .md files (non-generated parts, must be created manually):");
      for (const file of missingFiles) {
        console.log(`  - ${file}`);
      }
    }
  }

  /**
   * Generates documentation for a single application.
   */
  private async generateApplicationDocumentation(
    applicationName: string,
    appPath: string,
  ): Promise<void> {
    console.log(`Generating documentation for application: ${applicationName}`);

    // Read application.json
    const appJsonPath = path.join(appPath, "application.json");
    if (!fs.existsSync(appJsonPath)) {
      throw new Error(`application.json not found at ${appJsonPath}`);
    }

    const appData: IApplication = JSON.parse(
      fs.readFileSync(appJsonPath, "utf-8"),
    );

    // Get parent application if exists
    const parentApp = appData.extends
      ? await this.getParentApplication(appData.extends)
      : null;

    // Load application commands using TemplateProcessor
    let commands: ICommand[] = [];
    try {
      // Ensure StorageContext is initialized with correct paths
      StorageContext.setInstance(
        this.localPath,
        path.join(this.localPath, "storagecontext.json"),
        path.join(this.localPath, "secret.txt"),
      );
      
      const templateProcessor = new TemplateProcessor({
        jsonPath: this.jsonPath,
        localPath: this.localPath,
        schemaPath: this.schemaPath,
      });
      
      // Create a dummy VEContext for loading
      const dummyVeContext: IVEContext = {
        host: "dummy",
        port: 22,
        getStorageContext: () => StorageContext.getInstance(),
        getKey: () => "ve_dummy",
      };
      
      // Try to load installation task
      const loaded = await templateProcessor.loadApplication(
        applicationName,
        "installation" as TaskType,
        dummyVeContext,
        "sh", // Use sh for documentation generation
      );
      commands = loaded.commands || [];
    } catch (err) {
      // If loading fails, continue without commands
      console.warn(`  ⚠ Could not load commands for ${applicationName}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Analyze which templates are fully skipped
    const skippedTemplates = new Set<string>();
    
    // Helper function to check if a template is fully skipped
    const checkTemplateSkipped = (templateName: string, appPath: string): boolean => {
      // Try to find template file to get its commands
      const templatePath = path.join(appPath, "templates", templateName);
      const isShared = !fs.existsSync(templatePath);
      const fullPath = isShared
        ? path.join(this.jsonPath, "shared", "templates", templateName)
        : templatePath;
      
      if (!fs.existsSync(fullPath)) {
        return false; // Template not found, can't determine skip status
      }
      
      try {
        const templateData: ITemplate = JSON.parse(
          fs.readFileSync(fullPath, "utf-8"),
        );
        
        // Get command names from template
        const templateCommandNames = new Set<string>();
        if (templateData.commands && Array.isArray(templateData.commands)) {
          for (const cmd of templateData.commands) {
            if (cmd && cmd.name) {
              templateCommandNames.add(cmd.name);
            }
          }
        }
        
        // If template has no commands, it can't be skipped
        if (templateCommandNames.size === 0) {
          return false;
        }
        
        // Find matching commands in loaded commands
        const matchingCommands: ICommand[] = [];
        for (const cmd of commands) {
          if (!cmd || !cmd.name) continue;
          
          // Check if command name matches (with or without "(skipped)" suffix)
          const cmdBaseName = cmd.name.replace(/\s*\(skipped\)$/, "");
          if (templateCommandNames.has(cmdBaseName)) {
            matchingCommands.push(cmd);
          }
        }
        
        // If we found commands for this template, check if all are skipped
        // Important: Only mark as skipped if we found ALL commands and ALL are skipped
        if (matchingCommands.length > 0 && matchingCommands.length === templateCommandNames.size) {
          const allSkipped = matchingCommands.every(cmd => 
            cmd.name?.includes("(skipped)")
          );
          return allSkipped;
        }
        
        // If we didn't find all commands, the template might not have been executed
        // or some commands might be missing - don't mark as skipped
        return false;
      } catch {
        // Ignore errors
        return false;
      }
    };
    
    if (commands.length > 0 && appData.installation) {
      // For each template in installation, check if all its commands are skipped
      for (const templateRef of appData.installation) {
        const templateName = typeof templateRef === "string"
          ? templateRef
          : (templateRef as ITemplateReference).name;
        
        if (checkTemplateSkipped(templateName, appPath)) {
          skippedTemplates.add(templateName);
        }
        
        // Also check referenced templates (templates that are called from this template)
        const templatePath = path.join(appPath, "templates", templateName);
        const isShared = !fs.existsSync(templatePath);
        const fullPath = isShared
          ? path.join(this.jsonPath, "shared", "templates", templateName)
          : templatePath;
        
        if (fs.existsSync(fullPath)) {
          try {
            const templateData: ITemplate = JSON.parse(
              fs.readFileSync(fullPath, "utf-8"),
            );
            
            // Check referenced templates (templates called via cmd.template)
            if (templateData.commands && Array.isArray(templateData.commands)) {
              for (const cmd of templateData.commands) {
                if (cmd && cmd.template) {
                  const refTemplateName = cmd.template;
                  if (checkTemplateSkipped(refTemplateName, appPath)) {
                    skippedTemplates.add(refTemplateName);
                  }
                }
              }
            }
          } catch {
            // Ignore errors
          }
        }
      }
    }

    // Create directory structure for application-specific templates
    const appTemplatesDir = path.join(this.htmlPath, "json", "applications", applicationName, "templates");
    if (!fs.existsSync(appTemplatesDir)) {
      fs.mkdirSync(appTemplatesDir, { recursive: true });
    }
    
    // Create directory structure for shared templates
    const sharedTemplatesDir = path.join(this.htmlPath, "json", "shared", "templates");
    if (!fs.existsSync(sharedTemplatesDir)) {
      fs.mkdirSync(sharedTemplatesDir, { recursive: true });
    }

    // Generate README.md for application in html directory
    const htmlReadmePath = path.join(this.htmlPath, `${applicationName}.md`);
    const readmeContent = this.generateApplicationReadme(
      applicationName,
      appData,
      parentApp,
      appPath,
      commands,
      skippedTemplates,
    );
    fs.writeFileSync(htmlReadmePath, readmeContent, "utf-8");
    console.log(`  ✓ Generated ${htmlReadmePath}`);

    // Generate documentation for each template
    const templatesDir = path.join(appPath, "templates");
    if (fs.existsSync(templatesDir)) {
      const templateFiles = fs
        .readdirSync(templatesDir)
        .filter((f) => f.endsWith(".json"));

      for (const templateFile of templateFiles) {
        const templatePath = path.join(templatesDir, templateFile);
        await this.generateTemplateDocumentation(
          templatePath,
          applicationName,
          appPath,
        );
      }
    }

    // Also check shared templates referenced in installation
    // And recursively find all referenced templates
    const processedTemplates = new Set<string>();
    
    const processTemplateRecursively = async (templateName: string) => {
      if (processedTemplates.has(templateName)) {
        return; // Already processed
      }
      processedTemplates.add(templateName);
      
      // Check if it's a shared template
      const sharedTemplatePath = path.join(
        this.jsonPath,
        "shared",
        "templates",
        templateName,
      );
      const appTemplatePath = path.join(appPath, "templates", templateName);
      
      let templatePath: string | null = null;
      let isShared = false;
      
      if (fs.existsSync(sharedTemplatePath)) {
        templatePath = sharedTemplatePath;
        isShared = true;
      } else if (fs.existsSync(appTemplatePath)) {
        templatePath = appTemplatePath;
        isShared = false;
      }
      
      if (templatePath) {
        await this.generateTemplateDocumentation(
          templatePath,
          applicationName,
          appPath,
          isShared,
        );
        
        // Read template to find referenced templates
        try {
          const templateData: ITemplate = JSON.parse(
            fs.readFileSync(templatePath, "utf-8"),
          );
          
          // Find all referenced templates in commands
          if (templateData.commands && Array.isArray(templateData.commands)) {
            for (const cmd of templateData.commands) {
              if (cmd && cmd.template) {
                await processTemplateRecursively(cmd.template);
              }
            }
          }
        } catch {
          // Ignore errors
        }
      }
    };
    
    if (appData.installation) {
      for (const templateRef of appData.installation) {
        const templateName = typeof templateRef === "string"
          ? templateRef
          : (templateRef as ITemplateReference).name;
        
        await processTemplateRecursively(templateName);
      }
    }
  }

  /**
   * Generates documentation for a template.
   */
  private async generateTemplateDocumentation(
    templatePath: string,
    applicationName: string,
    appPath: string,
    isShared: boolean = false,
  ): Promise<void> {
    if (!fs.existsSync(templatePath)) {
      console.warn(`  ⚠ Template not found: ${templatePath}`);
      return;
    }

    const templateData: ITemplate = JSON.parse(
      fs.readFileSync(templatePath, "utf-8"),
    );

    const templateName = path.basename(templatePath, ".json");
    const docName = `${templateName}.md`;
    
    // Determine if template is application-specific or shared
    // Check if template exists in application's templates directory
    const appTemplatePath = path.join(appPath, "templates", path.basename(templatePath));
    const isLocal = fs.existsSync(appTemplatePath) && path.resolve(templatePath) === path.resolve(appTemplatePath);
    
    // Write to appropriate directory structure
    let htmlTemplatesPath: string;
    if (isLocal) {
      // Application-specific template: html/json/applications/<app-name>/templates/
      htmlTemplatesPath = path.join(this.htmlPath, "json", "applications", applicationName, "templates");
    } else {
      // Shared template: html/json/shared/templates/
      htmlTemplatesPath = path.join(this.htmlPath, "json", "shared", "templates");
    }
    
    // Ensure directory exists
    if (!fs.existsSync(htmlTemplatesPath)) {
      fs.mkdirSync(htmlTemplatesPath, { recursive: true });
    }
    
    const docPath = path.join(htmlTemplatesPath, docName);

    const docContent = this.generateTemplateDoc(
      templateName,
      templateData,
      applicationName,
      isShared,
      appPath,
    );

    fs.writeFileSync(docPath, docContent, "utf-8");
    console.log(`  ✓ Generated ${docPath}`);
  }

  /**
   * Generates README.md content for an application.
   */
  private generateApplicationReadme(
    applicationName: string,
    appData: IApplication,
    parentApp: IApplication | null,
    appPath: string,
    commands: ICommand[] = [],
    skippedTemplates: Set<string> = new Set(),
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(`# ${appData.name || applicationName}`);
    lines.push("");

    // Description
    if (appData.description) {
      lines.push(appData.description);
      lines.push("");
    }

    // Parent Application
    if (parentApp) {
      lines.push(`## Parent Application`);
      lines.push("");
      lines.push(
        `This application extends [${parentApp.name || appData.extends}](../${appData.extends}/README.md).`,
      );
      lines.push("");
    }

    // Installation Templates
    if (appData.installation && appData.installation.length > 0) {
      lines.push("## Installation Templates");
      lines.push("");
      lines.push(
        "The following templates are executed in order during installation:",
      );
      lines.push("");
      lines.push("| Template | Description | Status |");
      lines.push("|----------|-------------|--------|");

      for (const templateRef of appData.installation) {
        const templateName = typeof templateRef === "string"
          ? templateRef
          : (templateRef as ITemplateReference).name;
        
        const templatePath = path.join(appPath, "templates", templateName);
        const isShared = !fs.existsSync(templatePath);
        const isLocal = !isShared;
        
        const templateDocName = templateName.endsWith(".json")
          ? templateName.slice(0, -5) + ".md"
          : templateName + ".md";
        // Templates are in html/json/applications/<app-name>/templates/ or html/json/shared/templates/
        const templateDocPath = isLocal
          ? `json/applications/${applicationName}/templates/${templateDocName}`
          : `json/shared/templates/${templateDocName}`;
        
        // Try to read template for description
        let description = "";
        let referencedTemplates: string[] = [];
        try {
          const fullPath = isShared
            ? path.join(this.jsonPath, "shared", "templates", templateName)
            : templatePath;
          if (fs.existsSync(fullPath)) {
            const templateData: ITemplate = JSON.parse(
              fs.readFileSync(fullPath, "utf-8"),
            );
            description = templateData.description || "";
            // Take only the first sentence (before first period or newline) for table readability
            const firstSentenceMatch = description.match(/^([^.\n]+)/);
            if (firstSentenceMatch && firstSentenceMatch[1]) {
              description = firstSentenceMatch[1].trim();
            }
            // Replace pipes in description to avoid breaking the table
            description = description.replace(/\|/g, "&#124;");
            // Limit description length to avoid very long table cells
            if (description.length > 80) {
              description = description.substring(0, 77) + "...";
            }
            
            // Extract referenced templates from commands
            if (templateData.commands && Array.isArray(templateData.commands)) {
              for (const cmd of templateData.commands) {
                if (cmd && cmd.template) {
                  referencedTemplates.push(cmd.template);
                }
              }
            }
          }
        } catch {
          // Ignore errors
        }

        // Check if template is fully skipped
        const isFullySkipped = skippedTemplates.has(templateName);
        
        // Check if template is conditionally executed (optional)
        // Mark as conditional if it has skip_if_all_missing or optional flag
        let isConditionallyExecuted = false;
        try {
          const fullPath = isShared
            ? path.join(this.jsonPath, "shared", "templates", templateName)
            : templatePath;
          if (fs.existsSync(fullPath)) {
            const templateData: ITemplate = JSON.parse(
              fs.readFileSync(fullPath, "utf-8"),
            );
            // Template is conditionally executed if:
            // 1. It has skip_if_all_missing (explicitly optional)
            // 2. It has optional: true flag (explicitly marked as optional)
            if ((templateData.skip_if_all_missing && templateData.skip_if_all_missing.length > 0) ||
                templateData.optional === true) {
              isConditionallyExecuted = true;
            }
          }
        } catch {
          // Ignore errors
        }
        
        // Format status with color highlighting
        let status: string;
        if (isFullySkipped) {
          status = '<span style="color: #ff6b6b; font-weight: bold;">⏭️ All Commands Skipped</span>';
        } else if (isConditionallyExecuted) {
          status = '<span style="color: #ffa500; font-weight: bold;">⚙️ Conditional (requires parameters)</span>';
        } else {
          status = '✓ Executed';
        }

        lines.push(
          `| [${templateName}](${templateDocPath}) | ${description} | ${status} |`,
        );
        
        // Add referenced templates as indented rows
        for (const refTemplateName of referencedTemplates) {
          const refTemplatePath = path.join(appPath, "templates", refTemplateName);
          const refIsShared = !fs.existsSync(refTemplatePath);
          
          const refFullPath = refIsShared
            ? path.join(this.jsonPath, "shared", "templates", refTemplateName)
            : refTemplatePath;
          
          let refDescription = "";
          try {
            if (fs.existsSync(refFullPath)) {
              const refTemplateData: ITemplate = JSON.parse(
                fs.readFileSync(refFullPath, "utf-8"),
              );
              refDescription = refTemplateData?.description || "";
              const firstSentenceMatch = refDescription.match(/^([^.\n]+)/);
              if (firstSentenceMatch && firstSentenceMatch[1]) {
                refDescription = firstSentenceMatch[1].trim();
              }
              refDescription = refDescription.replace(/\|/g, "&#124;");
              if (refDescription.length > 70) {
                refDescription = refDescription.substring(0, 67) + "...";
              }
            }
          } catch {
            // Ignore errors
          }
          
          const refTemplateDocName = refTemplateName.endsWith(".json")
            ? refTemplateName.slice(0, -5) + ".md"
            : refTemplateName + ".md";
          // Templates are in html/json/applications/<app-name>/templates/ or html/json/shared/templates/
          const refTemplateDocPath = refIsShared
            ? `json/shared/templates/${refTemplateDocName}`
            : `json/applications/${applicationName}/templates/${refTemplateDocName}`;
          
          // Check if referenced template is fully skipped or conditionally executed
          const refIsFullySkipped = skippedTemplates.has(refTemplateName);
          
          // Check if referenced template is conditionally executed
          let refIsConditionallyExecuted = false;
          try {
            if (fs.existsSync(refFullPath)) {
              const refTemplateData: ITemplate = JSON.parse(
                fs.readFileSync(refFullPath, "utf-8"),
              );
              // Template is conditionally executed if it has skip_if_all_missing or optional flag
              if ((refTemplateData.skip_if_all_missing && refTemplateData.skip_if_all_missing.length > 0) ||
                  refTemplateData.optional === true) {
                refIsConditionallyExecuted = true;
              }
            }
          } catch {
            // Ignore errors
          }
          
          let refStatus: string;
          if (refIsFullySkipped) {
            refStatus = '<span style="color: #ff6b6b; font-weight: bold;">⏭️ All Commands Skipped</span>';
          } else if (refIsConditionallyExecuted) {
            refStatus = '<span style="color: #ffa500; font-weight: bold;">⚙️ Conditional (requires parameters)</span>';
          } else {
            refStatus = '✓ Executed';
          }
          
          lines.push(
            `| └─ [${refTemplateName}](${refTemplateDocPath}) | ${refDescription} | ${refStatus} |`,
          );
        }
      }
      lines.push("");
    }

    // Generated Parameters Section
    lines.push("<!-- GENERATED_START:PARAMETERS -->");
    lines.push("## Parameters");
    lines.push("");
    lines.push(
      "The following parameters can be configured for this application:",
    );
    lines.push("");

    // Get parameters from set-parameters.json if it exists
    const setParamsPath = path.join(appPath, "templates", "set-parameters.json");
    if (fs.existsSync(setParamsPath)) {
      const setParamsData: ITemplate = JSON.parse(
        fs.readFileSync(setParamsPath, "utf-8"),
      );
      if (setParamsData.parameters) {
        lines.push(this.generateParametersTable(setParamsData.parameters));
        lines.push("");
      }
    }

    lines.push("<!-- GENERATED_END:PARAMETERS -->");
    lines.push("");

    // Installation Commands
    if (commands.length > 0) {
      lines.push("<!-- GENERATED_START:COMMANDS -->");
      lines.push("## Installation Commands");
      lines.push("");
      lines.push(
        "The following commands are executed during installation (in order):",
      );
      lines.push("");
      lines.push("| # | Command | Description | Status |");
      lines.push("|---|---------|-------------|--------|");

      let commandIndex = 1;
      for (const cmd of commands) {
        if (!cmd) continue;
        
        const isSkipped = cmd.name?.includes("(skipped)") || false;
        const commandName = cmd.name || "Unnamed command";
        const description = cmd.description || "-";
        const status = isSkipped ? "⏭️ Skipped" : "✓ Executed";
        
        lines.push(
          `| ${commandIndex} | \`${commandName}\` | ${description} | ${status} |`,
        );
        commandIndex++;
      }
      lines.push("");
      lines.push("<!-- GENERATED_END:COMMANDS -->");
      lines.push("");
    }

    // Features
    lines.push("## Features");
    lines.push("");
    lines.push(
      "This application provides the following features (documented in individual template files):",
    );
    lines.push("");
    
    // List features from templates
    if (appData.installation) {
      for (const templateRef of appData.installation) {
        const templateName = typeof templateRef === "string"
          ? templateRef
          : (templateRef as ITemplateReference).name;
        
        const templatePath = path.join(appPath, "templates", templateName);
        const isShared = !fs.existsSync(templatePath);
        const fullPath = isShared
          ? path.join(this.jsonPath, "shared", "templates", templateName)
          : templatePath;
        
        if (fs.existsSync(fullPath)) {
          // Templates are in html/json/applications/<app-name>/templates/ or html/json/shared/templates/
          const templateDocName = templateName.endsWith(".json")
            ? templateName.slice(0, -5) + ".md"
            : templateName + ".md";
          const templateDocPath = isShared
            ? `json/shared/templates/${templateDocName}`
            : `json/applications/${applicationName}/templates/${templateDocName}`;
          lines.push(`- See [${templateName}](${templateDocPath}) for details`);
        }
      }
    }
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Extracts template variables from a string (e.g., "{{ var }}").
   */
  private extractTemplateVariables(str: string): string[] {
    const regex = /{{ *([^}\ ]+) *}}/g;
    const vars = new Set<string>();
    let match;
    while ((match = regex.exec(str)) !== null) {
      if (match[1]) {
        vars.add(match[1]);
      }
    }
    return Array.from(vars);
  }

  /**
   * Checks if a property value is only a template variable that matches a parameter.
   */
  private isPropertyOnlyTemplateVariable(
    value: string | number | boolean,
    templateParameters: IParameter[],
  ): boolean {
    if (typeof value !== "string") {
      return false;
    }
    
    // Check if the value is exactly a template variable (e.g., "{{ param_name }}" or "{{param_name}}")
    const trimmed = value.trim();
    const vars = this.extractTemplateVariables(trimmed);
    
    // If there's exactly one variable, check if the entire value is just that variable
    if (vars.length === 1) {
      const varName = vars[0];
      
      // Normalize the value: remove all whitespace
      const normalizedValue = trimmed.replace(/\s+/g, "");
      const expectedPattern = `{{${varName}}}`;
      
      // Check if the normalized value matches exactly the template variable pattern
      if (normalizedValue === expectedPattern) {
        // Check if this variable is already defined as a parameter
        return templateParameters.some((p) => p.id === varName);
      }
    }
    
    return false;
  }

  /**
   * Generates template documentation content.
   */
  private generateTemplateDoc(
    templateName: string,
    templateData: ITemplate,
    applicationName: string,
    isShared: boolean,
    appPath: string,
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(`# ${templateData.name || templateName}`);
    lines.push("");

    // Description
    if (templateData.description) {
      lines.push(templateData.description);
      lines.push("");
    }

    // Execution Target
    if (templateData.execute_on) {
      lines.push(`**Execution Target:** ${templateData.execute_on}`);
      lines.push("");
    }

    // Generated Parameters Section
    if (templateData.parameters && templateData.parameters.length > 0) {
      lines.push("<!-- GENERATED_START:PARAMETERS -->");
      lines.push("## Parameters");
      lines.push("");
      lines.push(this.generateParametersTable(templateData.parameters));
      lines.push("");
      lines.push("<!-- GENERATED_END:PARAMETERS -->");
      lines.push("");
    }

    // Generated Outputs Section
    if (templateData.outputs && templateData.outputs.length > 0) {
      lines.push("<!-- GENERATED_START:OUTPUTS -->");
      lines.push("## Outputs");
      lines.push("");
      lines.push("| Output ID | Default | Description |");
      lines.push("|-----------|---------|-------------|");
      for (const output of templateData.outputs) {
        const defaultVal = output.default !== undefined
          ? String(output.default)
          : "-";
        lines.push(`| \`${output.id}\` | ${defaultVal} | - |`);
      }
      lines.push("");
      lines.push("<!-- GENERATED_END:OUTPUTS -->");
      lines.push("");
    }

    // Commands
    if (templateData.commands && templateData.commands.length > 0) {
      // Check if there's only one command with properties (common case)
      const firstCmd = templateData.commands[0];
      const hasOnlyPropertiesCommand = templateData.commands.length === 1 && 
        firstCmd &&
        firstCmd.properties &&
        !firstCmd.script &&
        !firstCmd.command &&
        !firstCmd.template;
      
      if (hasOnlyPropertiesCommand && firstCmd) {
        // Special case: Only properties command - show as a properties table
        lines.push("<!-- GENERATED_START:COMMANDS -->");
        lines.push("## Properties");
        lines.push("");
        lines.push("This template sets the following properties:");
        lines.push("");
        lines.push("| Property ID | Value |");
        lines.push("|-------------|-------|");
        
        const props = Array.isArray(firstCmd.properties) ? firstCmd.properties : [firstCmd.properties];
        
        // Get parameter IDs to filter out properties that are just template variables
        const parameterIds = new Set(
          (templateData.parameters || []).map((p) => p.id)
        );
        
        // Filter out properties that are only template variables matching parameters
        const filteredProps = props.filter((p: any) => {
          if (typeof p !== "object" || p === null || !p.id) {
            return true; // Keep non-object properties
          }
          
          // Skip if value is only a template variable that matches a parameter
          if (p.value !== undefined && this.isPropertyOnlyTemplateVariable(p.value, templateData.parameters || [])) {
            return false;
          }
          
          return true;
        });
        
        for (const p of filteredProps) {
          if (typeof p === "object" && p !== null && p.id) {
            let valueStr = "";
            if (p.value !== undefined) {
              // Format value for display
              if (typeof p.value === "string") {
                // Replace newlines with <br> for multi-line values
                valueStr = p.value.replace(/\n/g, "<br>");
                // Escape pipe characters
                valueStr = valueStr.replace(/\|/g, "&#124;");
              } else {
                valueStr = String(p.value);
              }
            } else {
              valueStr = "-";
            }
            lines.push(`| \`${p.id}\` | ${valueStr} |`);
          }
        }
        lines.push("");
        lines.push("<!-- GENERATED_END:COMMANDS -->");
        lines.push("");
      } else {
        // Normal case: Multiple commands or non-properties commands
        lines.push("<!-- GENERATED_START:COMMANDS -->");
        lines.push("## Commands");
        lines.push("");
        lines.push("This template executes the following commands in order:");
        lines.push("");
        lines.push("| # | Command | Type | Details | Description |");
        lines.push("|---|---------|------|---------|-------------|");
        
        for (let i = 0; i < templateData.commands.length; i++) {
          const cmd = templateData.commands[i];
          if (!cmd) continue;
          
          const commandName = cmd.name || "Unnamed Command";
          let commandType = "";
          let commandDetails = "";
          
          if (cmd.script) {
            commandType = "Script";
            commandDetails = `\`${cmd.script}\``;
            if (cmd.library) {
              commandDetails += ` (library: \`${cmd.library}\`)`;
            }
          } else if (cmd.command) {
            commandType = "Command";
            // Truncate long commands for table display
            const cmdPreview = cmd.command.length > 50 
              ? cmd.command.substring(0, 47) + "..."
              : cmd.command;
            commandDetails = `\`${cmdPreview}\``;
          } else if (cmd.template) {
            commandType = "Template";
            const templateDocName = cmd.template.endsWith(".json")
              ? cmd.template.slice(0, -5) + ".md"
              : cmd.template + ".md";
            commandDetails = `[${cmd.template}](templates/${templateDocName})`;
          } else if (cmd.properties) {
            commandType = "Properties";
            const props = Array.isArray(cmd.properties) ? cmd.properties : [cmd.properties];
            const propList = props.map((p: any) => {
              if (typeof p === "object" && p !== null && p.id) {
                let valueStr = "";
                if (p.value !== undefined) {
                  if (typeof p.value === "string" && p.value.length > 30) {
                    valueStr = p.value.substring(0, 27) + "...";
                  } else {
                    valueStr = String(p.value);
                  }
                } else {
                  valueStr = "-";
                }
                return `\`${p.id}\` = \`${valueStr}\``;
              }
              return String(p);
            }).join(", ");
            commandDetails = propList.length > 80 ? propList.substring(0, 77) + "..." : propList;
          } else {
            commandType = "Unknown";
            commandDetails = "-";
          }
          
          let description = cmd.description || "-";
          // Format description for markdown table
          description = description.replace(/\n/g, " ");
          description = description.replace(/\|/g, "&#124;");
          if (description.length > 100) {
            description = description.substring(0, 97) + "...";
          }
          lines.push(`| ${i + 1} | ${commandName} | ${commandType} | ${commandDetails} | ${description} |`);
        }
        lines.push("");
        lines.push("<!-- GENERATED_END:COMMANDS -->");
        lines.push("");
      }
    }

    // Capabilities (extracted from script headers and template commands)
    lines.push("## Capabilities");
    lines.push("");
    lines.push("This template provides the following capabilities:");
    lines.push("");
    
    // Extract capabilities from script headers and template commands
    const capabilities = this.extractCapabilities(templateData, templateName, appPath);
    if (capabilities.length > 0) {
      for (const capability of capabilities) {
        lines.push(`- ${capability}`);
      }
    } else {
      lines.push("- See template implementation for details");
    }
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generates a markdown table for parameters.
   */
  private generateParametersTable(parameters: IParameter[]): string {
    const lines: string[] = [];
    lines.push("| Parameter | Type | Required | Default | Description |");
    lines.push("|-----------|------|----------|---------|-------------|");

    for (const param of parameters) {
      const name = param.name || param.id;
      const type = param.type || "string";
      const required = param.required ? "Yes" : "No";
      const defaultVal = param.default !== undefined
        ? String(param.default)
        : "-";
      const description = param.description || "";

      // Add flags
      const flags: string[] = [];
      if (param.secure) flags.push("🔒 Secure");
      if (param.advanced) flags.push("⚙️ Advanced");
      if (param.upload) flags.push("📤 Upload");
      const flagsStr = flags.length > 0 ? ` ${flags.join(" ")}` : "";

      lines.push(
        `| \`${param.id}\` | ${type} | ${required} | ${defaultVal} | ${description}${flagsStr} |`,
      );
    }

    return lines.join("\n");
  }

  /**
   * Extracts capabilities from script headers and template commands.
   */
  private extractCapabilities(
    templateData: ITemplate,
    templateName: string,
    appPath: string,
  ): string[] {
    const capabilities: string[] = [];

    if (!templateData.commands) {
      return capabilities;
    }

    for (const cmd of templateData.commands) {
      if (!cmd) continue;
      
      // Check for script execution - read script header for capabilities
      if (cmd.script) {
        const scriptCapabilities = this.extractCapabilitiesFromScriptHeader(
          cmd.script,
          appPath,
        );
        if (scriptCapabilities.length > 0) {
          capabilities.push(...scriptCapabilities);
        } else {
          // Fallback: Try to infer capability from script name
          const scriptName = cmd.script;
          if (scriptName.includes("configure")) {
            capabilities.push("Configuration management");
          } else if (scriptName.includes("install")) {
            capabilities.push("Package installation");
          } else if (scriptName.includes("start") || scriptName.includes("enable")) {
            capabilities.push("Service management");
          } else if (scriptName.includes("create")) {
            capabilities.push("Resource creation");
          } else if (scriptName.includes("setup")) {
            capabilities.push("System setup");
          }
        }
      }

      // Check for command execution
      if (cmd.command) {
        capabilities.push(`Executes command: \`${cmd.command}\``);
      }

      // Check for template reference
      if (cmd.template) {
        capabilities.push(`References template: \`${cmd.template}\``);
      }

      // Check for properties (parameter setting)
      if (cmd.properties) {
        const props = Array.isArray(cmd.properties)
          ? cmd.properties
          : Object.entries(cmd.properties).map(([id, value]) => ({ id, value }));
        
        // Analyze properties to determine capabilities
        const propIds = props.map((p: any) => p.id || Object.keys(p)[0]).join(" ").toLowerCase();
        
        if (propIds.includes("username") || propIds.includes("user")) {
          capabilities.push("User management");
        }
        if (propIds.includes("package") || propIds.includes("packages")) {
          capabilities.push("Package configuration");
        }
        if (propIds.includes("volume") || propIds.includes("volumes")) {
          capabilities.push("Volume management");
        }
        if (propIds.includes("command") && propIds.includes("command_args")) {
          capabilities.push("Service configuration");
        }
        if (propIds.includes("port") || propIds.includes("bind")) {
          capabilities.push("Network configuration");
        }
      }
    }

    // Remove duplicates
    return [...new Set(capabilities)];
  }

  /**
   * Extracts capabilities from script header comments.
   */
  private extractCapabilitiesFromScriptHeader(
    scriptName: string,
    appPath: string,
  ): string[] {
    const capabilities: string[] = [];
    
    // Try to find script in application or shared scripts
    const scriptPaths = [
      path.join(appPath, "scripts", scriptName),
      path.join(this.jsonPath, "shared", "scripts", scriptName),
      path.join(this.localPath, "shared", "scripts", scriptName),
    ];
    
    let scriptPath: string | null = null;
    for (const candidatePath of scriptPaths) {
      if (fs.existsSync(candidatePath)) {
        scriptPath = candidatePath;
        break;
      }
    }
    
    if (!scriptPath) {
      return capabilities;
    }
    
    try {
      const scriptContent = fs.readFileSync(scriptPath, "utf-8");
      const lines = scriptContent.split("\n");
      
      // Look for "This script" section in header comments
      let inHeader = false;
      let foundThisScript = false;
      
      for (let i = 0; i < lines.length && i < 50; i++) {
        const line = lines[i]?.trim() || "";
        
        // Start of header (after shebang)
        if (line.startsWith("#") && !line.startsWith("#!/")) {
          inHeader = true;
        }
        
        // Look for "This script" or "This library" line
        if (inHeader && (line.includes("This script") || line.includes("This library"))) {
          foundThisScript = true;
          // Extract the description after "This script" - but don't add it as a capability
          // The numbered list below will contain the actual capabilities
          // const match = line.match(/This (?:script|library)[^:]*:?\s*(.+)/i);
          // if (match && match[1] && match[1].trim().length > 0) {
          //   capabilities.push(match[1].trim());
          // }
        }
        
        // Look for numbered list of capabilities (e.g., "# 1. Validates...", "2. Creates...")
        if (foundThisScript && inHeader) {
          // Match lines like "# 1. Validates..." or "1. Validates..."
          const numberedMatch = line.match(/^#*\s*\d+\.\s+(.+)/);
          if (numberedMatch && numberedMatch[1]) {
            let capability = numberedMatch[1].trim();
            // Remove leading # if present
            capability = capability.replace(/^#+\s*/, "").trim();
            if (capability.length > 0) {
              capabilities.push(capability);
            }
          }
        }
        
        // Stop at first non-comment line after header
        if (inHeader && !line.startsWith("#") && line.length > 0 && !line.startsWith("exec >&2")) {
          break;
        }
      }
    } catch (err) {
      // Ignore errors reading script
    }
    
    return capabilities;
  }

  /**
   * Gets parent application data.
   */
  private async getParentApplication(
    parentName: string,
  ): Promise<IApplication | null> {
    try {
      const appLoader = new ApplicationLoader({
        jsonPath: this.jsonPath,
        localPath: this.localPath,
        schemaPath: this.schemaPath,
      });

      const readOpts: IReadApplicationOptions = {
        applicationHierarchy: [],
        error: new VEConfigurationError("", parentName),
        taskTemplates: [],
      };

      return appLoader.readApplicationJson(parentName, readOpts);
    } catch {
      return null;
    }
  }
}

