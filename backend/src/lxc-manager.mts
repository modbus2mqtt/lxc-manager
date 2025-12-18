#!/usr/bin/env node
import path from "node:path";
import { StorageContext } from "./storagecontext.mjs";
import { VEWebApp } from "./webapp.mjs";
import { exec as execCommand } from "./lxc-exec.mjs";
import type { TaskType } from "./types.mjs";

interface ParsedArgs {
  command?: string;
  localPath?: string;
  secretsFilePath?: string;
  parametersFile?: string;
  restartInfoFile?: string;
  application?: string;
  task?: string;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {};
  const argv = process.argv.slice(2);
  
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (!arg) {
      i += 1;
      continue;
    }
    
    if (arg === "--local") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        args.localPath = path.isAbsolute(value)
          ? value
          : path.join(process.cwd(), value);
        i += 2;
      } else {
        // --local ohne Wert bedeutet "local"
        args.localPath = path.join(process.cwd(), "local");
        i += 1;
      }
    } else if (arg === "--secretsFilePath") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error("--secretsFilePath requires a value");
        process.exit(1);
      }
      args.secretsFilePath = path.isAbsolute(value)
        ? value
        : path.join(process.cwd(), value);
      i += 2;
    } else if (arg === "--restartInfoFile") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        console.error("--restartInfoFile requires a value");
        process.exit(1);
      }
      args.restartInfoFile = path.isAbsolute(value)
        ? value
        : path.join(process.cwd(), value);
      i += 2;
    } else if (!args.command && !arg.startsWith("--")) {
      // First non-option argument is the command
      args.command = arg;
      i += 1;
    } else if (args.command === "exec") {
      // For exec command, the remaining non-option arguments are application, task, parametersFile
      if (!args.application) {
        args.application = arg;
        i += 1;
      } else if (!args.task) {
        args.task = arg;
        i += 1;
      } else if (!args.parametersFile && !arg.startsWith("--")) {
        const paramFile = path.isAbsolute(arg)
          ? arg
          : path.join(process.cwd(), arg);
        args.parametersFile = paramFile;
        i += 1;
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  
  return args;
}

const VALID_TASK_TYPES: TaskType[] = [
  "installation",
  "backup",
  "restore",
  "uninstall",
  "update",
  "upgrade",
  "webui",
];

function isValidTaskType(task: string): task is TaskType {
  return VALID_TASK_TYPES.includes(task as TaskType);
}

async function startWebApp(localPath: string, secretsFilePath?: string) {
  StorageContext.setInstance(localPath, secretsFilePath);
  const webApp = new VEWebApp(StorageContext.getInstance());
  const port = process.env.PORT || 3000;
  webApp.httpServer.listen(port, () => {
    console.log(`VEWebApp listening on port ${port}`);
  });
}

async function runExecCommand(
  application: string,
  task: TaskType,
  parametersFile: string,
  localPath?: string,
  secretsFilePath?: string,
  restartInfoFile?: string,
) {
  await execCommand(
    application,
    task,
    parametersFile,
    restartInfoFile,
    localPath,
    secretsFilePath,
  );
}

async function main() {
  const args = parseArgs();
  
  // If no command, start webapp
  if (!args.command) {
    const localPath = args.localPath || path.join(process.cwd(), "examples");
    await startWebApp(localPath, args.secretsFilePath);
    return;
  }
  
  // Handle commands
  if (args.command === "exec") {
    if (!args.application || !args.task || !args.parametersFile) {
      console.error(
        "Usage: lxc-manager exec <application> <task> <parameters file> [--local <path>] [--secretsFilePath <path>] [--restartInfoFile <path>]",
      );
      process.exit(1);
    }
    if (!isValidTaskType(args.task)) {
      console.error(
        `Invalid task type: ${args.task}. Valid values are: ${VALID_TASK_TYPES.join(", ")}`,
      );
      process.exit(1);
    }
    await runExecCommand(
      args.application,
      args.task,
      args.parametersFile,
      args.localPath,
      args.secretsFilePath,
      args.restartInfoFile,
    );
  } else {
    console.error(`Unknown command: ${args.command}`);
    console.error("Available commands: exec");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
