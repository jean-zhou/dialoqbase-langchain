import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false });

export function validateJson(schema: any, payload: any): { ok: boolean; errors?: string[] } {
  try {
    const validate = ajv.compile(schema);
    const ok = validate(payload) as boolean;
    if (!ok) {
      const errors = (validate.errors || []).map((e) => `${e.instancePath} ${e.message}`);
      return { ok: false, errors };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, errors: [String(e)] };
  }
}


