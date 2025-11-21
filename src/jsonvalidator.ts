import { Validator } from 'jsonschema';
import * as fs from 'fs';
import * as path from 'path';

const validator = new Validator();

export function validateJsonAgainstSchema(jsonData: any, schemaPath: string): ReturnType<Validator['validate']> {
    const schemaFullPath = path.resolve(schemaPath);
    const schemaContent = fs.readFileSync(schemaFullPath, 'utf-8');
    const schema = JSON.parse(schemaContent);
    return validator.validate(jsonData, schema);
}