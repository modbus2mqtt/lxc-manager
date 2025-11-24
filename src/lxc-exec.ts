#!/usr/bin/env node
import { ProxmoxConfiguration } from './proxmoxconfiguration.js';
import { ProxmoxExecution } from './proxmox-execution.js';
import type { TaskType } from './types.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function printUsageAndExit() {
  console.error('Usage: lxc-exec <application> <task> <parameters.json>');
}


function printUnresolvedParameters(application: string, task: TaskType, config: ProxmoxConfiguration) {
  printUsageAndExit();
  // The following code will not be reached, but kept for clarity if refactored
  try {
    config.loadApplication(application, task);
    const unresolved = config.getUnresolvedParameters();
    const requiredNames = unresolved.filter((param: any) => param.default === undefined).map((param: any) => param.name);
    console.error('Required Parameters:');
    requiredNames.forEach((name: string) => console.error(name));
    process.exit(0);
  } catch (err) {
    if (err instanceof Error) {
      console.error('Error:', err.message);
    } else {
      console.error('Error:', err);
    }
    process.exit(2);
  }
}

async function main() {
  const [,, applicationArg, taskArg, paramsFileArg] = process.argv;
  if (!applicationArg || !taskArg) {
    printUsageAndExit();
    process.exit(1);
  }
  const application = String(applicationArg);
  const task = String(taskArg) as TaskType;
  const paramsFile = paramsFileArg ? String(paramsFileArg) : undefined;

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const projectRoot = path.resolve(__dirname, '..');
    const schemaPath = path.join(projectRoot, 'schemas');
    const jsonPath = path.join(projectRoot, 'json');
    const localPath = path.join(projectRoot, 'local/json');
    // Hole alle Apps (Name -> Pfad)
    const allApps = ProxmoxConfiguration.getAllApps(jsonPath, localPath);
    const appPath = allApps.get(application);
    if (!appPath) {
      console.error(`Application '${application}' not found. Available: ${Array.from(allApps.keys()).join(', ')}`);
      process.exit(2);
    }

    const config = new ProxmoxConfiguration(schemaPath, jsonPath, localPath);

    if (!paramsFile) {
      config.loadApplication(application, task);
      const unresolved = config.getUnresolvedParameters();
      const requiredNames = unresolved.filter((param: any) => param.default === undefined).map((param: any) => param.name);
      printUsageAndExit();
      console.error('Fill the value fields and paste the following as your parameters.json:');
      const paramTemplate = requiredNames.map((name: string) => ({ name, value: "" }));
      console.error(JSON.stringify(paramTemplate, null, 2));
      process.exit(0);
    }

    config.loadApplication(application, task);
    const params = JSON.parse(readFileSync(paramsFile!, 'utf-8'));
    if (!Array.isArray(params)) {
      throw new Error('Parameters file must be a JSON array of {name, value} objects');
    }
    const defaults = new Map();
    config.parameters.forEach(param => {
      if (param.default !== undefined) {
        defaults.set(param.name, param.default);
      }
    });
    const exec = new ProxmoxExecution(config.commands, params, defaults);
    exec.on('message', msg => {
        console.error(`[${msg.command}] ${msg.stderr}`);
        if (msg.exitCode !== 0) {
          console.log('=================== ERROR ==================');
          console.log('=================== Command: ==================');
            console.error(`[${msg.commandtext}] ${msg.stderr}`);
        }
    });
    exec.run();
  } catch (err) {
    if (err instanceof Error) {
      console.error('Error:', err.message);
    } else {
      console.error('Error:', err);
    }
    process.exit(2);
  }
}

main();
