// Provider messages can echo credentials or private input. Log only metadata.
export function safeErrorMetadata(error){
  const status=Number(error?.status);
  const names=new Set(['Error','APIError','APIConnectionError','APIConnectionTimeoutError','AuthenticationError','PermissionDeniedError','NotFoundError','RateLimitError','InternalServerError','BadRequestError','AbortError']);
  const moduleCodes=new Set(['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_REQUIRE_ESM','ERR_PACKAGE_PATH_NOT_EXPORTED','ERR_PACKAGE_IMPORT_NOT_DEFINED']);
  return {type:names.has(error?.name)?error.name:'Error',...(Number.isInteger(status)&&status>=400&&status<=599?{status}:{}),...(moduleCodes.has(error?.code)?{code:error.code}:{})};
}
