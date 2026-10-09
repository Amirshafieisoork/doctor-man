// Provider messages can echo credentials or private input. Log only metadata.
export function safeErrorMetadata(error){
  const status=Number(error?.status);
  const names=new Set(['Error','APIError','APIConnectionError','APIConnectionTimeoutError','AuthenticationError','PermissionDeniedError','NotFoundError','RateLimitError','InternalServerError','BadRequestError','AbortError']);
  return {type:names.has(error?.name)?error.name:'Error',...(Number.isInteger(status)&&status>=400&&status<=599?{status}:{})};
}
