import { EventEmitter } from "events";
import { ICommand, IVeExecuteMessage } from "./types.mjs";
import fs from "node:fs";
import { IVEContext, IVMContext } from "./backend-types.mjs";
import { StorageContext, VMContext } from "./storagecontext.mjs";
import { VariableResolver } from "./variable-resolver.mts";
import { OutputProcessor, IOutput } from "./output-processor.mts";
import { spawnAsync } from "./spawn-utils.mjs";
import { JsonError } from "./jsonvalidator.mjs";

export interface IProxmoxRunResult {
  lastSuccessIndex: number;
}

// Re-export IOutput for backward compatibility
export type { IOutput };

export interface IRestartInfo {
  vm_id?: string | number | undefined;
  lastSuccessfull: number;
  inputs: { name: string; value: string | number | boolean }[];
  outputs: { name: string; value: string | number | boolean }[];
  defaults: { name: string; value: string | number | boolean }[];
}

let index = 0;

/**
 * ProxmoxExecution: Executes a list of ICommand objects with variable substitution and remote/container execution.
 */
export class VeExecution extends EventEmitter {
  private commands!: ICommand[];
  private inputs!: Record<string, string | number | boolean>;
  public outputs: Map<string, string | number | boolean> = new Map();
  private outputsRaw?: { name: string; value: string | number | boolean }[];
  private scriptTimeoutMs: number;
  private variableResolver: VariableResolver;
  private outputProcessor: OutputProcessor;
  
  constructor(
    commands: ICommand[],
    inputs: { id: string; value: string | number | boolean }[],
    private veContext: IVEContext | null,
    private defaults: Map<string, string | number | boolean> = new Map(),
    protected sshCommand: string = "ssh",
  ) {
    super();
    this.commands = commands;
    this.inputs = {};
    for (const inp of inputs) {
      this.inputs[inp.id] = inp.value;
    }
    
    // Get timeout from environment variable, default to 2 minutes (120000 ms)
    const envTimeout = process.env.LXC_MANAGER_SCRIPT_TIMEOUT;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.scriptTimeoutMs = parsed * 1000; // Convert seconds to milliseconds
      } else {
        this.scriptTimeoutMs = 120000; // Default 2 minutes
      }
    } else {
      this.scriptTimeoutMs = 120000; // Default 2 minutes
    }

    // Initialize helper classes
    this.variableResolver = new VariableResolver(
      () => this.outputs,
      () => this.inputs,
      () => this.defaults,
    );
    this.outputProcessor = new OutputProcessor(
      this.outputs,
      this.outputsRaw,
      this.defaults,
      this.sshCommand,
    );
  }

  /**
   * Executes a command on the Proxmox host via SSH, with timeout. Parses stdout as JSON and updates outputs.
   * @param input The command to execute
   * @param tmplCommand The template command
   * @param timeoutMs Timeout in milliseconds (defaults to scriptTimeoutMs if not provided)
   * @param remoteCommand Optional remote command to prepend
   */
  protected async runOnVeHost(
    input: string,
    tmplCommand: ICommand,
    timeoutMs?: number,
    remoteCommand?: string[],
  ): Promise<IVeExecuteMessage> {
    // Use provided timeout or fall back to scriptTimeoutMs
    const actualTimeout = timeoutMs !== undefined ? timeoutMs : this.scriptTimeoutMs;
    const sshCommand = this.sshCommand;
    let sshArgs: string[] = [];
    if (sshCommand === "ssh") {
      if (!this.veContext) throw new Error("SSH parameters not set");
      let host = this.veContext.host;
      // Ensure root user is used when no user is specified
      if (typeof host === "string" && !host.includes("@")) {
        host = `root@${host}`;
      }
      const port = this.veContext.port || 22;
      sshArgs = [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "BatchMode=yes", // non-interactive: fail if auth requires password
        "-o",
        "PasswordAuthentication=no", // prevent password prompt
        "-o",
        "PreferredAuthentications=publickey", // try keys only
        "-o",
        "LogLevel=ERROR", // suppress login banners and info
        "-o",
        "ServerAliveInterval=30", // send keepalive every 30s
        "-o",
        "ServerAliveCountMax=3", // fail after 3 missed keepalives
        "-T", // disable pseudo-tty to avoid MOTD banners
        "-q", // Suppress SSH diagnostic output
        "-p",
        String(port),
        `${host}`,
      ];
    }
    if (remoteCommand) {
      sshArgs = sshArgs.concat(remoteCommand);
    }
    // Retry logic for SSH/lxc-attach connection errors (exit 255)
    const maxRetries = 3;
    let proc;
    let retryCount = 0;

    // Prepend a unique marker before the input to easily identify where the actual output starts
    // This helps strip SSH banners and MOTD messages that appear before command output
    const UNIQUE_MARKER =
      "LXC_MANAGER_JSON_START_MARKER_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2);
    const inputWithMarker = `echo "${UNIQUE_MARKER}"\n${input}`;

    while (retryCount < maxRetries) {
      proc = await spawnAsync(sshCommand, sshArgs, {
        timeout: actualTimeout,
        input: inputWithMarker,
        onStdout: (chunk: string) => {
          // Emit partial message for real-time output (especially useful for hanging scripts)
          this.emit("message", {
            command: tmplCommand.name || "streaming",
            commandtext: input,
            stderr: "",
            result: chunk,
            exitCode: -1, // Not finished yet
            execute_on: tmplCommand.execute_on,
            partial: true,
          } as IVeExecuteMessage);
        },
        onStderr: (chunk: string) => {
          // Emit partial message for real-time error output
          this.emit("message", {
            command: tmplCommand.name || "streaming",
            commandtext: input,
            stderr: chunk,
            result: null,
            exitCode: -1, // Not finished yet
            execute_on: tmplCommand.execute_on,
            partial: true,
          } as IVeExecuteMessage);
        },
      });

      // Exit 255 = SSH or lxc-attach connection issue, always retry
      if (proc.exitCode === 255) {
        retryCount++;
        if (retryCount < maxRetries) {
          console.error(
            `Connection failed with exit 255 (attempt ${retryCount}/${maxRetries}), retrying in 3s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 3000)); // wait 3s before retry
          continue;
        }
      }
      break;
    }

    const stdout = proc!.stdout || "";
    const stderr = proc!.stderr || "";
    const exitCode = proc!.exitCode;
    // Try to parse stdout as JSON and update outputs
    const msg: IVeExecuteMessage = {
      stderr: structuredClone(stderr),
      commandtext: structuredClone(input),
      result: structuredClone(stdout),
      exitCode,
      command: structuredClone(tmplCommand.name),
      execute_on: structuredClone(tmplCommand.execute_on!),
    };
    try {
      if (stdout.trim().length === 0) {
        // output is empty but exit code 0
        // no outputs to parse
        msg.command = tmplCommand.name;
        msg.result = "OK";
        msg.exitCode = exitCode;
        if (exitCode === 0) {
          msg.result = "OK";
          msg.index = index++;
          msg.partial = false;
          this.emit("message", msg);
          return msg;
        } else {
          msg.result = "ERROR";
          msg.index = index;
          msg.stderr = stderr;
          msg.error = new JsonError(
            `Command "${tmplCommand.name}" failed with exit code ${exitCode}: ${stderr}`,
          );
          msg.exitCode = exitCode;
          msg.command = tmplCommand.name;
          msg.commandtext = input;
          msg.partial = false;
          this.emit("message", msg);
        }
      } else {
        // Parse and update outputs
        this.outputProcessor.parseAndUpdateOutputs(stdout, tmplCommand, UNIQUE_MARKER);
        // Check if outputsRaw was updated
        const outputsRawResult = this.outputProcessor.getOutputsRawResult();
        if (outputsRawResult) {
          this.outputsRaw = outputsRawResult;
        }
      }
    } catch (e: any) {
      msg.index = index;
      msg.error = new JsonError(e.message);
      msg.exitCode = -1;
      msg.partial = false;
      this.emit("message", msg);
      throw new Error("An error occurred during command execution.");
    }
    if (exitCode !== 0) {
      throw new Error(
        `Command "${tmplCommand.name}" failed with exit code ${exitCode}: ${stderr}`,
      );
    } else msg.index = index++;
    msg.partial = false;
    this.emit("message", msg);
    return msg;
  }

  /**
   * Executes a command inside an LXC container via lxc-attach on the Proxmox host.
   * @param vm_id Container ID
   * @param command Command to execute
   * @param tmplCommand The template command
   * @param timeoutMs Timeout in ms (defaults to scriptTimeoutMs if not provided)
   */
  protected async runOnLxc(
    vm_id: string | number,
    command: string,
    tmplCommand: ICommand,
    timeoutMs?: number,
  ): Promise<IVeExecuteMessage> {
    // Pass command and arguments as array
    let lxcCmd: string[] | undefined = ["lxc-attach", "-n", String(vm_id)];
    // For testing: just pass through when using another sshCommand, like /bin/sh
    if (this.sshCommand !== "ssh") lxcCmd = undefined;
    return await this.runOnVeHost(command, tmplCommand, timeoutMs, lxcCmd);
  }

  /**
   * Executes host discovery flow: calls write-vmids-json.sh on VE host, parses used_vm_ids,
   * resolves VMContext by hostname, validates pve and vmid, then runs the provided command inside LXC.
   */
  protected async executeOnHost(
    hostname: string,
    command: string,
    tmplCommand: ICommand,
  ): Promise<void> {
    const { join, dirname } = require("node:path");
    const { fileURLToPath } = require("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const scriptPath = join(
      here,
      "..",
      "json",
      "shared",
      "scripts",
      "write-vmids-json.sh",
    );
    const probeMsg = await this.runOnVeHost(
      "",
      { ...tmplCommand, name: "write-vmids" } as any,
      10000,
      [scriptPath],
    );
    // Prefer parsed outputsRaw (name/value) if available
    let usedStr: string | undefined = undefined;
    if (this.outputs.has("used_vm_ids"))
      usedStr = String(this.outputs.get("used_vm_ids"));
    if (!usedStr && typeof probeMsg.result === "string")
      usedStr = probeMsg.result as string;
    if (!usedStr)
      throw new Error("No used_vm_ids result received from host probe");
    let arr: any;
    try {
      arr = JSON.parse(usedStr);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      throw new Error("Invalid used_vm_ids JSON");
    }
    if (!Array.isArray(arr)) throw new Error("used_vm_ids is not an array");
    const found = arr.find(
      (x: any) => typeof x?.hostname === "string" && x.hostname === hostname,
    );
    if (!found)
      throw new Error(`Hostname ${hostname} not found in used_vm_ids`);
    const storage = StorageContext.getInstance();
    const vmctx = storage.getVMContextByHostname(hostname);
    if (!vmctx) throw new Error(`VMContext for ${hostname} not found`);
    const pveOk =
      (vmctx as any)?.data?.pve !== undefined &&
      (vmctx as any).data.pve === found.pve;
    const vmidOk = Number(vmctx.vmid) === Number(found.vmid);
    if (!pveOk || !vmidOk)
      throw new Error("PVE or VMID mismatch between host data and VMContext");
    // Replace variables with vmctx.data for host execution
    let execCmd = this.variableResolver.replaceVarsWithContext(
      command,
      (vmctx as any).data || {},
    );
    execCmd = this.variableResolver.replaceVarsWithContext(
      execCmd,
      Object.fromEntries(this.outputs) || {},
    );
    await this.runOnLxc(vmctx.vmid, execCmd, tmplCommand);
  }

  /**
   * Runs all commands, replacing variables from inputs/outputs, and executes them on the correct target.
   * Returns the index of the last successfully executed command.
   */
  async run(
    restartInfo: IRestartInfo | null = null,
  ): Promise<IRestartInfo | undefined> {
    let rcRestartInfo: IRestartInfo | undefined = undefined;
    let msgIndex = 0;
    let startIdx = 0;
    if (restartInfo) {
      // Load previous state
      this.outputs.clear();
      this.inputs = {};
      this.defaults.clear();
      restartInfo.lastSuccessfull !== undefined &&
        (startIdx = restartInfo.lastSuccessfull + 1);
      for (const inp of restartInfo.inputs) {
        this.inputs[inp.name] = inp.value;
      }
      for (const outp of restartInfo.outputs) {
        this.outputs.set(outp.name, outp.value);
      }
      for (const def of restartInfo.defaults) {
        this.defaults.set(def.name, def.value);
      }
      // Re-initialize variable resolver with updated state
      this.variableResolver = new VariableResolver(
        () => this.outputs,
        () => this.inputs,
        () => this.defaults,
      );
    }
    outerloop: for (let i = startIdx; i < this.commands.length; ++i) {
      const cmd = this.commands[i];
      if (!cmd || typeof cmd !== "object") continue;
      
      // Check if this is a skipped command (has "(skipped)" in name)
      // Skipped commands should be immediately emitted with exitCode 0
      if (cmd.name && cmd.name.includes("(skipped)")) {
        this.emit("message", {
          stderr: cmd.description || "Skipped: all required parameters missing",
          result: null,
          exitCode: 0,
          command: cmd.name,
          execute_on: cmd.execute_on,
          index: msgIndex++,
          partial: false,
        } as IVeExecuteMessage);
        continue; // Skip execution, already handled
      }
      
      // Reset raw outputs for this command iteration
      let rawStr = "";
      try {
        if (cmd.properties !== undefined) {
          // Handle properties: replace variables in values, set as outputs
          try {
            if (Array.isArray(cmd.properties)) {
              // Array of {id, value} objects
              for (const entry of cmd.properties) {
                if (entry && typeof entry === "object" && entry.id && entry.value !== undefined) {
                  let value = entry.value;
                  // Replace variables in value if it's a string
                  if (typeof value === "string") {
                    value = this.variableResolver.replaceVars(value);
                    // Skip property if value is "NOT_DEFINED" (optional parameter not set)
                    if (value === "NOT_DEFINED") {
                      continue; // Skip this property
                    }
                  }
                  // Only set if value is a primitive type (not array)
                  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                    this.outputs.set(entry.id, value);
                  }
                }
              }
            } else if (cmd.properties && typeof cmd.properties === "object") {
              // Single object with id and value
              if (cmd.properties.id && cmd.properties.value !== undefined) {
                let value = cmd.properties.value;
                // Replace variables in value if it's a string
                if (typeof value === "string") {
                  value = this.variableResolver.replaceVars(value);
                  // Skip property if value is "NOT_DEFINED" (optional parameter not set)
                  if (value === "NOT_DEFINED") {
                    continue; // Skip this property, don't set it in outputs
                  }
                }
                // Only set if value is a primitive type (not array)
                if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                  this.outputs.set(cmd.properties.id, value);
                }
              }
            }
            // Emit success message
            this.emit("message", {
              stderr: "",
              result: JSON.stringify(cmd.properties),
              exitCode: 0,
              command: cmd.name || "properties",
              execute_on: cmd.execute_on,
              index: msgIndex++,
              partial: false,
            } as IVeExecuteMessage);
            continue; // Skip execution, only set properties
          } catch (err: any) {
            const msg = `Failed to process properties: ${err?.message || err}`;
            this.emit("message", {
              stderr: msg,
              result: null,
              exitCode: -1,
              command: cmd.name || "properties",
              execute_on: cmd.execute_on,
              index: msgIndex++,
              partial: false,
            } as IVeExecuteMessage);
            continue;
          }
        } else if (cmd.script !== undefined) {
          // Read script file, replace variables, then execute
          rawStr = fs.readFileSync(cmd.script, "utf-8");
        } else if (cmd.command !== undefined) {
          rawStr = cmd.command;
        } else {
          continue; // Skip unknown command type
        }
        let lastMsg: IVeExecuteMessage | undefined;
        switch (cmd.execute_on) {
          case "lxc":
            // For lxc path, perform default variable replacement
            const execStrLxc = this.variableResolver.replaceVars(rawStr);
            let vm_id: string | number | undefined = undefined;
            if (
              typeof this.inputs["vm_id"] === "string" ||
              typeof this.inputs["vm_id"] === "number"
            ) {
              vm_id = this.inputs["vm_id"];
            } else if (this.outputs.has("vm_id")) {
              const v = this.outputs.get("vm_id");
              if (typeof v === "string" || typeof v === "number") {
                vm_id = v;
              }
            }
            if (!vm_id) {
              const msg =
                "vm_id is required for LXC execution but was not found in inputs or outputs.";
              this.emit("message", {
                stderr: msg,
                result: null,
                exitCode: -1,
                command: cmd.name,
                execute_on: cmd.execute_on,
                index: msgIndex++,
                partial: false,
              } as IVeExecuteMessage);
              break outerloop;
            }
            await this.runOnLxc(vm_id, execStrLxc, cmd);
            break;
          case "ve":
            // Default replacement for direct ve execution
            const execStrVe = this.variableResolver.replaceVars(rawStr);
            lastMsg = await this.runOnVeHost(execStrVe, cmd);
            break;
          default:
            if (
              typeof cmd.execute_on === "string" &&
              /^host:.*/.test(cmd.execute_on)
            ) {
              const hostname = (cmd.execute_on as string).split(":")[1] ?? "";
              try {
                // Pass raw (unreplaced) string; executeOnHost will replace with vmctx.data
                await this.executeOnHost(hostname, rawStr, cmd);
              } catch (err: any) {
                const msg = String(err?.message ?? err);
                this.emit("message", {
                  stderr: msg,
                  result: null,
                  exitCode: -1,
                  command: cmd.name,
                  execute_on: cmd.execute_on,
                  host: hostname,
                  index: msgIndex++,
                  partial: false,
                } as unknown as IVeExecuteMessage);
                break outerloop;
              }
              break;
            } else {
              const msg = cmd.name + " is missing the execute_on property";
              this.emit("message", {
                stderr: msg,
                result: null,
                exitCode: -1,
                command: cmd.name,
                execute_on: cmd.execute_on!,
                index: msgIndex++,
                partial: false,
              } as IVeExecuteMessage);
              break outerloop;
            }
        }

        // Fallback: if no outputs were produced by runOnProxmoxHost override, try to parse echo JSON
        if (
          this.outputs.size === 0 &&
          lastMsg &&
          typeof lastMsg.result === "string"
        ) {
          const m = String(lastMsg.result)
            .replace(/^echo\s+/, "")
            .replace(/^"/, "")
            .replace(/"$/, "");
          try {
            const obj = JSON.parse(m);
            this.outputsRaw = [];
            for (const [name, value] of Object.entries(obj)) {
              const v = value as string | number | boolean;
              this.outputs.set(name, v);
              this.outputsRaw.push({ name, value: v });
            }
          } catch {}
        }

        const vm_id = this.outputs.get("vm_id");
        rcRestartInfo = {
          vm_id:
            vm_id !== undefined
              ? Number.parseInt(vm_id as string, 10)
              : undefined,
          lastSuccessfull: i,
          inputs: Object.entries(this.inputs).map(([name, value]) => ({
            name,
            value,
          })),
          outputs:
            this.outputsRaw && Array.isArray(this.outputsRaw)
              ? this.outputsRaw.map(({ name, value }) => ({ name, value }))
              : Array.from(this.outputs.entries()).map(([name, value]) => ({
                  name,
                  value,
                })),
          defaults: Array.from(this.defaults.entries()).map(
            ([name, value]) => ({ name, value }),
          ),
        };
      } catch (e) {
        this.emit("message", {
          stderr: (e as any).message,
          result: null,
          exitCode: -1,
          command: cmd.name,
          execute_on: cmd.execute_on,
          index: msgIndex++,
          partial: false,
        } as IVeExecuteMessage);
        // Set restartInfo even on error so restart is possible
        const vm_id = this.outputs.get("vm_id");
        rcRestartInfo = {
          vm_id:
            vm_id !== undefined
              ? Number.parseInt(vm_id as string, 10)
              : undefined,
          lastSuccessfull: i - 1,
          inputs: Object.entries(this.inputs).map(([name, value]) => ({
            name,
            value,
          })),
          outputs:
            this.outputsRaw && Array.isArray(this.outputsRaw)
              ? this.outputsRaw.map(({ name, value }) => ({ name, value }))
              : Array.from(this.outputs.entries()).map(([name, value]) => ({
                  name,
                  value,
                })),
          defaults: Array.from(this.defaults.entries()).map(
            ([name, value]) => ({ name, value }),
          ),
        };
        break outerloop;
      }
    }
    // Check if all commands completed successfully
    const allSuccessful =
      rcRestartInfo !== undefined &&
      rcRestartInfo.lastSuccessfull === this.commands.length - 1;

    if (allSuccessful) {
      // Send a final success message
      this.emit("message", {
        command: "Completed",
        execute_on: "ve",
        exitCode: 0,
        result: "All commands completed successfully",
        stderr: "",
        finished: true,
        partial: false,
      } as IVeExecuteMessage);

      if (restartInfo == undefined) {
        this.emit("finished", this.buildVmContext());
      }
    }
    return rcRestartInfo;
  }

  buildVmContext(): IVMContext {
    if (!this.veContext) {
      throw new Error("VE context not set");
    }
    var data: any = {};
    data.vmid = this.outputs.get("vm_id");
    const hostVal = (this.veContext as any)?.host;
    const veKey =
      typeof (this.veContext as any)?.getKey === "function"
        ? (this.veContext as any).getKey()
        : typeof hostVal === "string"
          ? `ve_${hostVal}`
          : undefined;
    data.vekey = veKey;
    data.data = {};

    this.outputs.forEach((value, key) => {
      data.data[key] = value;
    });
    return new VMContext(data);
  }

  /**
   * Replaces {{var}} in a string with values from inputs or outputs.
   * @internal For backward compatibility and testing
   */
  private replaceVars(str: string): string {
    return this.variableResolver.replaceVars(str);
  }

  /**
   * Replace variables using a provided context map first (e.g., vmctx.data),
   * then fall back to outputs, inputs, and defaults.
   * @internal For backward compatibility
   */
  protected replaceVarsWithContext(
    str: string,
    ctx: Record<string, any>,
  ): string {
    return this.variableResolver.replaceVarsWithContext(str, ctx);
  }
}
