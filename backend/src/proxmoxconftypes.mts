import { JsonError } from "./jsonvalidator.mjs";
import { IJsonError, TaskType } from "./types.mjs";

export class ProxmoxConfigurationError extends JsonError {
  constructor(application: string, details?: IJsonError[]) {
    super(application, details);
    this.name = "ProxmoxConfigurationError";
    this.filename = application;
  }
}
export interface IApplicationBase {
  name: string;
  extends?: string;
  description?: string;
  icon?: string;
}
// Interface generated from application.schema.json
export type IApplicationSchema = IApplicationBase & {
  [key in TaskType]?: string[];
};

export interface IApplication extends IApplicationSchema {
  id: string;
}
export interface IConfiguredPathes {
  schemaPath: string;
  jsonPath: string;
  localPath: string;
}
