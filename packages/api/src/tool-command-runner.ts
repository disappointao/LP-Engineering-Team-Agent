export interface ToolCommandRunner {
  run(input: ToolCommandRunInput): Promise<ToolCommandRunResult>;
}

export interface ToolCommandRunInput {
  runId: string;
  projectId: string;
  skillId: string;
  skillVersionId: string;
  commandId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory?: string;
  timeoutMs: number;
}

export interface ToolCommandRunResult {
  state: "completed" | "failed" | "cancelled";
  exitCode?: number;
  stdout: string;
  stderr: string;
  errorName?: string;
}

export class RejectingToolCommandRunner implements ToolCommandRunner {
  async run(): Promise<ToolCommandRunResult> {
    return {
      state: "failed",
      exitCode: undefined,
      stdout: "",
      stderr: "",
      errorName: "tool_command_runner_not_configured"
    };
  }
}
