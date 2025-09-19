import fs from "fs";
import path from "path";
import yaml from "yaml";

export type PromptDef = {
  id: string;
  version: string;
  metadata?: any;
  system_template: string;
  human_template: string;
  output_schema?: any;
};

export function loadPrompt(id: string, version: string): PromptDef | null {
  const file = path.join(__dirname, "registry", `${id}.${version}.yaml`);
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf-8");
  const doc = yaml.parse(content);
  return doc as PromptDef;
}


