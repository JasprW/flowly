import { ZodError } from "zod";
import { StoreInvalidError } from "./store";
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
export function toolFailure(error: unknown) {
  if (error instanceof ToolError)
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  if (error instanceof StoreInvalidError)
    return { code: error.code, message: error.message, retryable: error.retryable };
  if (error instanceof SyntaxError)
    return {
      code: "INVALID_INPUT",
      message: "Invalid JSON request.",
      retryable: false,
    };
  if (error instanceof ZodError)
    return {
      code: error.issues.some((i) => i.path[0] === "status")
        ? "INVALID_STATUS"
        : "INVALID_INPUT",
      message: error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
      retryable: false,
    };
  return {
    code: "SERVICE_FAILURE",
    message: error instanceof Error ? error.message : "Kanban service failed.",
    retryable: false,
  };
}
