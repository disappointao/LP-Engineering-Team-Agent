import { defaultLocalWorkbenchUser, type WorkbenchUserIdentity } from "@lp-agent/api";

export function getLocalWorkbenchUser(): WorkbenchUserIdentity {
  return { ...defaultLocalWorkbenchUser };
}
