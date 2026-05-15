import type {
  ToolCommandRunner,
  ToolCommandRunInput,
  ToolCommandRunResult
} from "@lp-agent/api";

export class SimulatedToolCommandRunner implements ToolCommandRunner {
  async run(input: ToolCommandRunInput): Promise<ToolCommandRunResult> {
    if (input.commandId.includes("fail")) {
      return {
        state: "failed",
        exitCode: 1,
        stdout: "",
        stderr: "Simulated command failure.",
        errorName: "simulated_command_failed"
      };
    }

    return {
      state: "completed",
      exitCode: 0,
      stdout: `Simulated ${input.commandId} for project ${input.projectId}.`,
      stderr: ""
    };
  }
}
