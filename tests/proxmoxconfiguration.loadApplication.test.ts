import * as path from 'path';
import { expect, describe, it, beforeEach, afterEach } from 'vitest';
import { ProxmoxConfiguration,ProxmoxConfigurationError } from "@src/proxmoxconfiguration.js";
import { ProxmoxTestHelper } from "@tests/proxmoxTestHelper.js";

declare module '@tests/proxmoxTestHelper.js' {
  interface ProxmoxTestHelper {
    createProxmoxConfiguration(): ProxmoxConfiguration;
  }
}
ProxmoxTestHelper.prototype.createProxmoxConfiguration = function() {
  const schemaPath = path.join(__dirname, '../schemas');
  const jsonPath = this.jsonDir;
  const localPath = path.join(__dirname, '../local/json');
  return new ProxmoxConfiguration(schemaPath, jsonPath, localPath);
};

describe('ProxmoxConfiguration.loadApplication', () => {
  let helper: ProxmoxTestHelper;

  beforeEach(async () => {
    helper = new ProxmoxTestHelper();
    await helper.setup();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('should load parameters and commands for modbus2mqtt installation', () => {
    const config = helper.createProxmoxConfiguration();

    config.loadApplication('modbus2mqtt', 'installation');

    expect(config.parameters.length).toBeGreaterThan(0);
    expect(config.commands.length).toBeGreaterThan(0);
    const paramNames = config.parameters.map(p => p.name);
    expect(paramNames).toContain('packagerpubkey');
    expect(paramNames).toContain('packageurl');
    expect(paramNames).toContain('vm_id');

    config.getUnresolvedParameters().forEach(param => {
      expect(param.name).not.toBe('vm_id');
    });
  });

  it('should throw error if a template file is missing and provide all errors and application object', () => {
    const config = helper.createProxmoxConfiguration();

    try {
      let application = helper.readApplication('modbus2mqtt');
      application.installation = ["nonexistent-template.json"];
      config.loadApplication('modbus2mqtt', 'installation');
    } catch (err) {
      expect(err).toBeInstanceOf(ProxmoxConfigurationError);
      const errorObj = err as ProxmoxConfigurationError;
      expect(Array.isArray(errorObj.errors)).toBe(true);
      expect(errorObj.errors.length).toBeGreaterThan(0);
      expect(errorObj.message).toMatch(/Multiple errors|Template file not found/);
      // NEU: application-Objekt mit errors-Property
      expect((err as any).application).toBeDefined();
      expect((err as any).application.name).toBeDefined();
      expect(Array.isArray((err as any).application.errors)).toBe(true);
      expect((err as any).application.errors.length).toBeGreaterThan(0);
    }
  });

  it('should throw recursion error for endless nested templates and provide application object', () => {
    const config = helper.createProxmoxConfiguration();
    // Manipuliere die Testdaten, sodass ein Template sich selbst referenziert
    const appName = 'modbus2mqtt';
    const templateName = 'recursive-template.json';
    // Schreibe ein Template, das sich selbst als nested template referenziert
    helper.writeTemplate(appName, templateName, {
      execute_on: 'lxc',
      name: 'Recursive Template',
      commands: [
        { type: 'template', execute: templateName }
      ]
    });
    // Setze dieses Template als einziges in installation
    const app = helper.readApplication(appName);
    app.installation = [templateName];
    helper.writeApplication(appName, app);
    try {
      config.loadApplication(appName, 'installation');
    } catch (err) {
      expect((err as any).message).toMatch(/Endless recursion detected/);
      expect((err as any).application).toBeDefined();
      expect((err as any).application.name).toBeDefined();
      expect(Array.isArray((err as any).application.errors)).toBe(true);
      expect((err as any).application.errors.length).toBeGreaterThan(0);
    }
  });

  it('should throw error if a script file is missing and provide application object', () => {
    const config = helper.createProxmoxConfiguration();
    // Write a template that references a non-existent script
    const appName = 'modbus2mqtt';
    const templateName = 'missing-script-template.json';
    helper.writeTemplate(appName, templateName, {
      execute_on: 'proxmox',
      name: 'Missing Script Template',
      commands: [
        { type: 'script', execute: 'nonexistent-script.sh' }
      ]
    });
    // Set this template as the only one in installation
    const app = helper.readApplication(appName);
    app.installation = [templateName];
    helper.writeApplication(appName, app);
    try {
      config.loadApplication(appName, 'installation');
    } catch (err) {
      expect(err).toBeInstanceOf(ProxmoxConfigurationError);
      const errorObj = err as ProxmoxConfigurationError;
      expect(Array.isArray(errorObj.errors)).toBe(true);
      expect(errorObj.errors.length).toBeGreaterThan(0);
      expect(errorObj.errors[0]).toMatch(/Script file not found/);
      expect((err as any).application).toBeDefined();
      expect((err as any).application.name).toBeDefined();
      expect(Array.isArray((err as any).application.errors)).toBe(true);
      expect((err as any).application.errors.length).toBeGreaterThan(0);
    }
  });

  it('should throw error if a script uses an undefined parameter and provide application object', () => {
    const config = helper.createProxmoxConfiguration();
    // Write a template that references a script using an undefined variable
    const appName = 'modbus2mqtt';
    const templateName = 'missing-param-script-template.json';
    const scriptName = 'uses-missing-param.sh';
    // Write the script file with a variable that is not defined as a parameter
    helper.writeScript(appName, scriptName, '#!/bin/sh\necho "Value: {{ missing_param }}"\n');
    helper.writeTemplate(appName, templateName, {
      execute_on: 'proxmox',
      name: 'Missing Param Script Template',
      commands: [
        { type: 'script', execute: scriptName }
      ]
    });
    // Set this template as the only one in installation
    const app = helper.readApplication(appName);
    app.installation = [templateName];
    helper.writeApplication(appName, app);
    try {
      config.loadApplication(appName, 'installation');
    } catch (err) {
      expect(err).toBeInstanceOf(ProxmoxConfigurationError);
      const errorObj = err as ProxmoxConfigurationError;
      expect(Array.isArray(errorObj.errors)).toBe(true);
      expect(errorObj.errors.length).toBeGreaterThan(0);
      expect(errorObj.errors[0]).toMatch(/no such parameter is defined/);
      expect((err as any).application).toBeDefined();
      expect((err as any).application.name).toBeDefined();
      expect(Array.isArray((err as any).application.errors)).toBe(true);
      expect((err as any).application.errors.length).toBeGreaterThan(0);
    }
  });

  it('should throw error if a command uses an undefined parameter and provide application object', () => {
    const config = helper.createProxmoxConfiguration();
    // Write a template that references a command using an undefined variable
    const appName = 'modbus2mqtt';
    const templateName = 'missing-param-command-template.json';
    helper.writeTemplate(appName, templateName, {
      execute_on: 'proxmox',
      name: 'Missing Param Command Template',
      commands: [
        { type: 'command', execute: 'echo {{ missing_param }}' }
      ]
    });
    // Set this template as the only one in installation
    const app = helper.readApplication(appName);
    app.installation = [templateName];
    helper.writeApplication(appName, app);
    try {
      config.loadApplication(appName, 'installation');
    } catch (err) {
      expect(err).toBeInstanceOf(ProxmoxConfigurationError);
      const errorObj = err as ProxmoxConfigurationError;
      expect(Array.isArray(errorObj.errors)).toBe(true);
      expect(errorObj.errors.length).toBeGreaterThan(0);
      expect(errorObj.errors[0]).toMatch(/no such parameter is defined/);
      expect((err as any).application).toBeDefined();
      expect((err as any).application.name).toBeDefined();
      expect(Array.isArray((err as any).application.errors)).toBe(true);
      expect((err as any).application.errors.length).toBeGreaterThan(0);
    }
  })
});
