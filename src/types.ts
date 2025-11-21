export interface ISsh {
    host: string;
    port: number;
}
export interface IApplicationBase {
    name: string;
    description: string;
    icon?: string | undefined;
    errors?: string[];
 }
export interface IApplicationWeb {
    name: string;
    description: string;
    icon?: string | undefined;
    iconContent?: string | undefined;
    id: string;
    errors?: string[];
}
export type TaskType = "installation" | "backup" | "restore" | "uninstall" | "update" | "upgrade";
// Generated from template.schema.json
export interface ICommand {
    type: 'command' | 'script' | 'template';
    name: string;
    execute: string;
    description?: string;
    execute_on?: 'proxmox' | 'lxc';
}
export interface IProxmoxExecuteMessage {
    command: string;
    stderr: string;
    result: string | null;
    exitCode: number;
    execute_on?: 'proxmox' | 'lxc';
    index: number;
}
export interface IParameter {
    name: string;
    type: 'enum' | 'string' | 'number' | 'boolean';
    enumValues?: string[];
    secure?: boolean;
    description?: string;
    default?: string | number | boolean;
    required?: boolean;
    value?: string | number | boolean;
    template?: string;
}

export interface ITemplate {
    execute_on: 'proxmox' | 'lxc';
    name: string;
    description?: string;
    parameters?: IParameter[];
    outputs?: string[];
    commands: ICommand[];
}
export interface IError {   

    message: string;    
    errors?: string[];
}