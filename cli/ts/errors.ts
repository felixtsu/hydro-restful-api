/**
 * HydroOJ CLI Error Handling
 */

export interface CliError {
  code: string;
  message: string;
  httpStatus?: number;
  hint?: string;
}

export function normalizeError(err: any): CliError {
  if (err && typeof err === 'object' && err.code && err.message) {
    const isNodeSystemError = typeof err.code === 'string' && err.code.startsWith('E');
    if (!isNodeSystemError) {
      return err as CliError;
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  const rawCode = err && typeof err === 'object' ? err.code : undefined;
  
  // Extract HTTP status if present in message (e.g. "HTTP 404: ...")
  const httpMatch = msg.match(/HTTP (\d{3})/);
  const httpStatus = httpMatch ? parseInt(httpMatch[1], 10) : undefined;

  let code = 'UNKNOWN_ERROR';
  let cleanMessage = msg;

  if (msg.includes('NOT_FOUND')) {
    code = 'NOT_FOUND';
  } else if (msg.includes('401') || msg.includes('403') || msg.includes('Not logged in')) {
    code = 'UNAUTHORIZED';
  } else if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('getaddrinfo') || rawCode === 'ECONNREFUSED' || rawCode === 'ENOTFOUND') {
    code = 'NETWORK_ERROR';
  } else if (msg.includes('timeout') || rawCode === 'ETIMEDOUT') {
    code = 'TIMEOUT';
  }

  // If the message has "HTTP 404: SOME_CODE - Message", try to extract them
  const detailMatch = msg.match(/HTTP \d{3}: (.*?) — (.*)/);
  if (detailMatch) {
    code = detailMatch[1];
    cleanMessage = detailMatch[2];
  }

  const error: CliError = {
    code,
    message: cleanMessage,
  };

  if (httpStatus) {
    error.httpStatus = httpStatus;
  }

  // Add hints for common errors
  if (code === 'UNAUTHORIZED') {
    error.hint = 'Try running "hydrooj-cli login" to refresh your session.';
  } else if (code === 'NETWORK_ERROR' || (httpStatus && httpStatus >= 500)) {
    error.hint = 'Verify your base URL and that the hydrooj-rest-api addon is installed and active.';
  }

  return error;
}
