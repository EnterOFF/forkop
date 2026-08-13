import { COMMAND_TIMEOUT } from '../constants';
import { withTimeout } from './withTimeout';

interface ExecuteShellCommandParams {
  command: string;
  args: string[];
  timeout?: number | null;
}

interface ExecuteShellCommandResponse {
  stdout: string;
  stderr: string;
  code?: number;
}

export async function executeShellCommand({
  command,
  args,
  timeout = COMMAND_TIMEOUT,
}: ExecuteShellCommandParams): Promise<ExecuteShellCommandResponse> {
  try {
    const request = fs.exec(command, args);
    return timeout === null
      ? await request
      : await withTimeout(request, timeout, [command, ...args].join(' '));
  } catch (err) {
    const error = err as Error & { code?: unknown };
    const code = typeof error?.code === 'number' ? error.code : 1;

    return { stdout: '', stderr: error?.message, code };
  }
}
